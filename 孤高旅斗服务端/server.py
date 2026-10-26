# -*- coding: utf-8 -*-
"""
孤高旅斗 · 桌面启动器（Python）
==============================================================
项目作者: RikkaLove0721 (https://github.com/RikkaLove0721)
一个 exe 干三件事：
  1) 把游戏页面用本机 HTTP 服务托管起来（同一局域网的其它电脑可以打开）；
  2) 内置一个零依赖的 WebSocket 房间服务器，负责两台电脑的消息转发；
  3) 用原生窗口（Edge WebView2）把游戏显示出来，看起来就是一个桌面游戏。

不需要 Node.js，不需要 npm install，不需要联网。

命令行参数：
  孤高旅斗.exe              正常启动（开窗口）
  孤高旅斗.exe --server     只开服务器，不开窗口（给不想要桌面窗口的场景）
  孤高旅斗.exe --port 9000  指定端口
"""
import base64
import gzip
import hashlib
import hmac
import http.server
import io
import json
import os
import random
import socket
import socketserver
import subprocess
import struct
import tempfile
import sys
import threading
import time
import webbrowser

APP_NAME = "孤高旅斗"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
BASE_PORT = 8123

# ---------------------------------------------------------------- 静态资源
# v4.22 服务器版：HTML 只留骨架，图片 / BGM / 脚本走独立文件。
# 这样首屏只要下几十 KB 的 HTML + 一份可缓存的 game.js，
# 而不是每次都拖一个 12.9MB（其中 91% 是 base64 素材）的单文件。
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".txt": "text/plain; charset=utf-8",
}
GZIP_EXT = (".html", ".js", ".css", ".json", ".svg", ".txt")
GZIP_MIN = 1024                 # 太小的没必要压，反而多花头
_GZ_CACHE = {}


def mime_of(name):
    return MIME.get(os.path.splitext(name)[1].lower(), "application/octet-stream")


def gzip_body(path, mtime, raw):
    """按 (路径, mtime, 大小) 缓存压缩结果。

    同一份 game.js 每次请求都重新压一遍是纯浪费 —— 1.3MB 压一次约 30ms，
    并发几个玩家就能把单线程服务器的响应时间拉长。
    """
    key = (path, mtime, len(raw))
    hit = _GZ_CACHE.get(key)
    if hit is None:
        hit = gzip.compress(raw, 6)
        if len(_GZ_CACHE) > 32:
            _GZ_CACHE.clear()           # 换了几个版本之后清一次，别一直涨
        _GZ_CACHE[key] = hit
    return hit
MAX_ROOM_AGE = 6 * 60 * 60      # 6 小时后回收空房间
GAME_FILE = "孤高旅斗.html"


def setup_console():
    """让 Windows 控制台能显示 emoji / 中文，且任何情况下都不会因为编码而崩溃。

    Windows 默认代码页是 936(GBK)，直接 print emoji 会抛 UnicodeEncodeError，
    打包成 exe 双击运行时就是「窗口一闪而过」。这里做两层保护：
      ① 把控制台代码页切成 65001(UTF-8)，让 ⚔️ 🎮 这类字符能正常显示；
      ② 把 stdout/stderr 的编码兜底成 utf-8 + errors=replace。
    """
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
            ctypes.windll.kernel32.SetConsoleCP(65001)
        except Exception:      # noqa: BLE001
            pass
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:      # noqa: BLE001
            pass


setup_console()


def app_dir():
    """exe（或 .py）所在的真实目录 —— 即用户看得到的那个文件夹。"""
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def resource_path(name):
    """查找资源文件。

    优先级：exe 同目录的同名文件 > 打包进 exe 的内置副本 > 脚本同目录。
    这样后续更新玩法时，只要把新的 孤高旅斗.html 放到 exe 旁边即可生效，
    不必重新打包 exe。
    """
    beside = os.path.join(app_dir(), name)          # ① exe 旁边（可热更新）
    if os.path.exists(beside):
        return beside
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    packaged = os.path.join(base, name)             # ② 打包进 exe 的内置副本
    if os.path.exists(packaged):
        return packaged
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    if os.path.exists(here):
        return here
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        os.pardir, os.pardir, "assets", os.path.basename(name))
    if os.path.basename(name) in ("icon.ico", "menu-bg.jpg") and os.path.exists(root):
        return root                                     # ③ 开发态：仓库根 assets/
    dev = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       os.pardir, os.pardir, "dist", name)   # ④ 开发态：源码运行时找仓库 dist/
    return dev if os.path.exists(dev) else packaged


def music_dir_path():
    """BGM 素材目录：exe/dist 旁边的 music/（开发态自动找到仓库 dist/music/）。"""
    beside = os.path.join(app_dir(), "music")
    if os.path.isdir(beside):
        return beside
    dev = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       os.pardir, os.pardir, "dist", "music")
    return dev


def deploy_token():
    """Webhook 令牌：环境变量 LD_DEPLOY_TOKEN 优先，其次 server.py 旁边的 deploy.token。

    两个都没有 = 关闭 /deploy（返回 404），不会意外开出一个公网可触发的部署口。
    """
    tok = (os.environ.get("LD_DEPLOY_TOKEN") or "").strip()
    if tok:
        return tok
    try:
        with io.open(os.path.join(app_dir(), "deploy.token"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def run_deploy(root):
    """后台执行 git pull。不重启进程 ——

    内容类文件（html / game.js / assets）每次请求都从磁盘现读，pull 完立刻生效；
    server.py 自己变了则由 watch_reload 自动 index 重启。所以这里只管拉代码。
    """
    log("  ⬇️  webhook 触发部署：git pull --ff-only")
    try:
        r = subprocess.run(["git", "-C", root, "pull", "--ff-only"],
                           capture_output=True, text=True, timeout=180)
        out = ((r.stdout or "") + (r.stderr or "")).strip()
        for line in out.splitlines()[:20]:
            log("     " + line)
        try:
            with io.open(os.path.join(root, "deploy.log"), "a", encoding="utf-8") as f:
                f.write("[%s] rc=%d\n%s\n\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), r.returncode, out))
        except OSError:
            pass
        log("  ✅  部署完成（rc=%d）" % r.returncode)
    except Exception as e:              # noqa: BLE001
        log("  ⚠️  部署失败：%s" % e)


def profile_path():
    """玩家存档文件路径：exe 旁边（开发态在 py 脚本旁边）的 profile.json"""
    return os.path.join(app_dir(), "profile.json")


# ---------------------------------------------------------------- 房间管理
class Room:
    __slots__ = ("code", "host", "guest", "guest2", "guest3", "created")

    def __init__(self, code):
        self.code = code
        self.host = None
        self.guest = None
        self.guest2 = None
        self.guest3 = None
        self.created = time.time()

    def members(self):
        return [m for m in (self.host, self.guest, self.guest2, self.guest3) if m is not None]


class Hub:
    """房间 + 连接管理，线程安全。"""

    def __init__(self):
        self.lock = threading.RLock()
        self.rooms = {}
        self.seq = 0

    def new_conn(self, ws):
        with self.lock:
            self.seq += 1
            return {"id": self.seq, "ws": ws, "room": None, "is_host": False, "name": ""}

    def create(self, conn):
        with self.lock:
            for _ in range(300):
                code = str(random.randint(1000, 9999))
                if code not in self.rooms:
                    break
            room = Room(code)
            room.host = conn
            self.rooms[code] = room
            conn["room"] = code
            conn["is_host"] = True
            return code

    def join(self, conn, code):
        """返回 (错误信息, 座位号)。座位：房主=0，挑战者依次 1/2/3（最多四人混战）。"""
        with self.lock:
            room = self.rooms.get(code)
            if not room:
                return "房间 %s 不存在，请确认房号" % (code or "????"), None
            if room.host is None or room.host["ws"].closed:
                self.rooms.pop(code, None)
                return "房主已离开，房间已关闭", None
            if room.host is conn:
                return "这是你自己的房间哦", None
            if room.guest is conn or room.guest2 is conn or room.guest3 is conn:
                return "你已经在房间里了", None
            for slot_name, seat in (("guest", 1), ("guest2", 2), ("guest3", 3)):
                m = getattr(room, slot_name)
                if m is None or m["ws"].closed:
                    setattr(room, slot_name, conn)
                    conn["room"] = code
                    conn["is_host"] = False
                    return None, seat
            return "房间已满（4/4）", None

    def room_members(self, code):
        with self.lock:
            room = self.rooms.get(code)
            return room.members() if room else []

    def peer_of(self, conn):
        """兼容 1v1：返回唯一对端。"""
        ps = self.peers_of(conn)
        return ps[0] if ps else None

    def peers_of(self, conn):
        """房主 → 所有挑战者；挑战者 → 房主。"""
        with self.lock:
            room = self.rooms.get(conn["room"])
            if not room:
                return []
            if conn["is_host"]:
                return [m for m in (room.guest, room.guest2, room.guest3)
                        if m is not None and not m["ws"].closed]
            p = room.host
            if p is None or p["ws"].closed:
                return []
            return [p]

    def leave(self, conn, notify=True):
        with self.lock:
            code = conn["room"]
            conn["room"] = None
            conn["is_host"] = False
            if not code:
                return
            room = self.rooms.get(code)
            if not room:
                return
            others = [m for m in room.members() if m is not conn]
            if notify:
                for other in others:
                    if not other["ws"].closed:
                        other["ws"].send_json({"t": "peer", "d": {"t": "peerLeft"}})
            for other in others:
                other["room"] = None
                other["is_host"] = False
            self.rooms.pop(code, None)

    def disconnect(self, conn):
        with self.lock:
            code = conn["room"]
            if not code:
                return
            room = self.rooms.get(code)
            if not room:
                return
            others = [m for m in room.members() if m is not conn]
            for other in others:
                if not other["ws"].closed:
                    other["ws"].send_json({"t": "peer", "d": {"t": "peerLeft"}})
            if conn["is_host"]:
                # 房主掉线：房间解散
                for other in others:
                    other["room"] = None
                    other["is_host"] = False
                self.rooms.pop(code, None)
            else:
                # 挑战者掉线：腾出座位，房间留给房主继续等人
                if room.guest is conn:
                    room.guest = None
                if room.guest2 is conn:
                    room.guest2 = None
                if room.guest3 is conn:
                    room.guest3 = None
            conn["room"] = None
            conn["is_host"] = False

    def gc(self):
        now = time.time()
        with self.lock:
            for code in list(self.rooms.keys()):
                room = self.rooms[code]
                ms = room.members()
                if (not ms) or now - room.created > MAX_ROOM_AGE:
                    for m in ms:
                        m["room"] = None
                        m["is_host"] = False
                    self.rooms.pop(code, None)


HUB = Hub()


# ---------------------------------------------------------------- WebSocket
class WsConn:
    """一层薄薄的 WebSocket 封装。"""

    def __init__(self, sock, rfile):
        self.sock = sock
        self.rfile = rfile
        self.closed = False
        self.lock = threading.Lock()

    def send_text(self, text):
        if self.closed:
            return
        payload = text.encode("utf-8")
        n = len(payload)
        head = bytearray([0x81])
        if n < 126:
            head.append(n)
        elif n < 65536:
            head.append(126)
            head += struct.pack(">H", n)
        else:
            head.append(127)
            head += struct.pack(">Q", n)
        try:
            with self.lock:
                self.sock.sendall(bytes(head) + payload)
        except OSError:
            self.closed = True

    def send_json(self, obj):
        self.send_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))

    def send_ctrl(self, opcode, payload=b""):
        if self.closed:
            return
        head = bytes([0x80 | opcode, min(len(payload), 125)])
        try:
            with self.lock:
                self.sock.sendall(head + payload[:125])
        except OSError:
            self.closed = True

    def _read(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.rfile.read(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        return buf

    def read_frame(self):
        """返回 (opcode, payload) 或 None（连接结束）。"""
        hdr = self._read(2)
        if not hdr:
            return None
        b0, b1 = hdr[0], hdr[1]
        opcode = b0 & 0x0F
        masked = (b1 & 0x80) != 0
        length = b1 & 0x7F
        if length == 126:
            ext = self._read(2)
            if not ext:
                return None
            length = struct.unpack(">H", ext)[0]
        elif length == 127:
            ext = self._read(8)
            if not ext:
                return None
            length = struct.unpack(">Q", ext)[0]
        if length > 4 * 1024 * 1024:
            return None
        mask = self._read(4) if masked else None
        if masked and mask is None:
            return None
        payload = self._read(length) if length else b""
        if payload is None:
            return None
        if mask:
            payload = bytes(payload[i] ^ mask[i & 3] for i in range(len(payload)))
        return opcode, payload

    def loop(self, conn):
        """跑消息循环，直到连接结束。"""
        frag = bytearray()
        frag_op = None
        last_ping = time.time()
        while not self.closed:
            frame = self.read_frame()
            if frame is None:
                break
            opcode, payload = frame
            if opcode == 0x0:                        # 续帧
                frag += payload
                if frag_op == 0x1:
                    self.handle(bytes(frag).decode("utf-8", "replace"), conn)
                frag = bytearray()
                frag_op = None
            elif opcode == 0x1:                      # 文本
                self.handle(payload.decode("utf-8", "replace"), conn)
            elif opcode == 0x8:                      # 关闭
                self.send_ctrl(0x8)
                break
            elif opcode == 0x9:                      # ping → pong
                self.send_ctrl(0xA, payload)
            elif opcode == 0xA:                      # pong
                pass
            if time.time() - last_ping > 20:
                last_ping = time.time()
                self.send_ctrl(0x9)
        self.closed = True
        HUB.disconnect(conn)

    # ---- 业务消息 ----
    def handle(self, text, conn):
        try:
            msg = json.loads(text)
        except ValueError:
            return
        if not isinstance(msg, dict):
            return
        t = msg.get("t")
        if t == "hi":
            conn["name"] = str(msg.get("name", ""))[:14]
        elif t == "create":
            if conn["room"]:
                HUB.leave(conn, False)
            code = HUB.create(conn)
            self.send_json({"t": "created", "code": code})
            log("[房间] %s 由 %s 创建" % (code, conn["name"] or ("玩家%d" % conn["id"])))
        elif t == "join":
            code = "".join(ch for ch in str(msg.get("code", "")) if ch.isdigit())[:4]
            err, seat = HUB.join(conn, code)   # join 返回 (错误信息, 座位号)
            if err:
                self.send_json({"t": "err", "msg": err})
                return
            self.send_json({"t": "joined", "code": code, "seat": seat})
            for peer in HUB.peers_of(conn):
                peer["ws"].send_json({"t": "peer", "d": {"t": "peerJoined", "peerName": conn["name"], "seat": seat}})
            log("[房间] %s 当前 %d/3 人" % (code, len(HUB.room_members(code))))
        elif t == "leave":
            HUB.leave(conn, True)
        elif t == "m":
            # 房主 → 广播给所有挑战者；挑战者 → 只发给房主（房主权威模拟）
            for peer in HUB.peers_of(conn):
                peer["ws"].send_json({"t": "m", "d": msg.get("d")})


# ---------------------------------------------------------------- HTTP
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LoneDuel/1.0"

    def log_message(self, fmt, *args):
        pass    # 静音常规访问日志

    def do_GET(self):
        path = self.path.split("?")[0].split("#")[0]
        upgrade = (self.headers.get("Upgrade") or "").lower()
        if path == "/ws" and upgrade == "websocket":
            self.do_ws()
            return
        if path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path in ("/", "/index.html", "/" + GAME_FILE):
            self.serve_file(resource_path(GAME_FILE), "text/html; charset=utf-8")
            return
        if path == "/balance.js":
            self.serve_file(resource_path("balance.js"), "application/javascript; charset=utf-8")
            return
        # v4.22 服务器版：脚本与素材拆成独立文件
        if path == "/game.js":
            self.serve_file(resource_path("game.js"), MIME[".js"], immutable=True)
            return
        if path.startswith("/assets/"):
            self.serve_asset(path[len("/assets/"):])
            return
        if path == "/music/list":
            self.handle_music_list()
            return
        if path.startswith("/music/"):
            from urllib.parse import unquote
            name = os.path.basename(unquote(path[len("/music/"):]))   # 解 URL 编码 + 只取文件名防目录穿越
            self.serve_file(resource_path(os.path.join("music", name)), mime_of(name), immutable=True)
            return
        if path == "/deploy":
            # 只做连通性自检：浏览器打开能返回 ready 就说明 GitHub 也能打进来
            tok = deploy_token()
            if not tok:
                self._json(404, {"ok": False, "msg": "deploy 未启用（没有配置 token）"})
            else:
                self._json(200, {"ok": True, "deploy": "ready"})
            return
        if path == "/api/profile":
            self.handle_profile_get()
            return
        if path == "/status":
            # 顺带体检：远程也能一眼看出「HTML 引用了 game.js 但文件没上传」这种状态
            body = json.dumps({
                "rooms": len(HUB.rooms), "ok": True, "ver": "v4.25",
                "game_js": os.path.exists(resource_path("game.js")),
                "assets": os.path.isdir(os.path.join(app_dir(), "assets")),
            }, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/lanip":
            # 给房主界面用：把「朋友该输入哪个网址」直接回给客户端，
            # 省得房主要翻后台控制台抄地址（localhost 那个地址发给朋友是连不上的）
            # 注意：Python 3.13 的 socketserver 不再有 server_port 属性，端口要从 server_address 取
            try:
                port = self.server.server_address[1]
            except Exception:      # noqa: BLE001
                port = getattr(self.server, "server_port", None)
            body = json.dumps({"ips": lan_ips(), "port": port, "ok": True}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        body = "404 找不到该路径".encode("utf-8")
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, filename, ctype, immutable=False):
        """发一个文件。

        immutable=True 用于「内容变了文件名/位置就会换」的静态资源（图片 / 音频）：
        让浏览器直接存一年，二次进入同一张图不再发请求。
        HTML 与 balance.js 保持 no-cache + ETag：改完玩法刷新就能拿到新的，
        但没改时只回一个 304，不用重下。

        文本类（html / js）在客户端支持时走 gzip —— 1.3MB 的 game.js 压完约 260KB，
        这才是「服务器上打不开」的正解：不是代码多，是没压缩 + 每次都重下。
        """
        try:
            st = os.stat(filename)
            with open(filename, "rb") as f:
                data = f.read()
        except OSError:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        ext = os.path.splitext(filename)[1].lower()
        accept = (self.headers.get("Accept-Encoding") or "").lower()
        use_gz = ext in GZIP_EXT and len(data) >= GZIP_MIN and "gzip" in accept
        body = gzip_body(filename, st.st_mtime_ns, data) if use_gz else data

        etag = '"%x-%x%s"' % (st.st_mtime_ns, st.st_size, "-gz" if use_gz else "")
        cc = "public, max-age=31536000, immutable" if immutable else "no-cache"
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cc)
            self.end_headers()
            return

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", cc)
        self.send_header("ETag", etag)
        if use_gz:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if getattr(self, "command", "GET") != "HEAD":
            self.wfile.write(body)

    def serve_asset(self, rel):
        """ /assets/<相对路径> —— 只允许取 app_dir/assets 底下的文件。"""
        from urllib.parse import unquote
        rel = unquote(rel).replace("\\", "/")
        parts = [p for p in rel.split("/") if p not in ("", ".")]
        if not parts or ".." in parts:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        fp = os.path.join(app_dir(), "assets", *parts)
        self.serve_file(fp, mime_of(fp), immutable=True)

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_deploy(self):
        """GitHub webhook 接收端。

        必须是「立刻回 202、后台再干活」：GitHub 只等 10 秒，
        而 git pull 遇到大文件可能磨蹭，超时会被记成 delivery failed。
        """
        tok = deploy_token()
        if not tok:
            self._json(404, {"ok": False, "msg": "deploy 未启用（没有配置 token）"})
            return
        from urllib.parse import parse_qs, urlparse
        q = parse_qs(urlparse(self.path).query)
        got = (q.get("token") or [""])[0] or self.headers.get("X-Deploy-Token") or ""
        # 先把 body 读干净，否则 keep-alive 连接上残留的数据会串到下一个请求
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if 0 < n:
                self.rfile.read(min(n, 4 * 1024 * 1024))
        except Exception:               # noqa: BLE001
            pass
        if not hmac.compare_digest(got, tok):
            self._json(403, {"ok": False, "msg": "token 不对"})
            return
        threading.Thread(target=run_deploy, args=(app_dir(),), daemon=True).start()
        self._json(202, {"ok": True, "msg": "已受理，后台执行 git pull"})

    def handle_profile_get(self):
        # 存档文件放在 exe 旁边（开发态放在 py 脚本旁边），端口漂移也不丢档
        self.serve_file(profile_path(), "application/json; charset=utf-8")

    def handle_music_list(self):
        """BGM 歌单：列出 music/ 目录下的音频文件（压缩过的 ogg 优先）。"""
        music_dir = music_dir_path()
        names = []
        if os.path.isdir(music_dir):
            names = sorted(f for f in os.listdir(music_dir)
                           if f.lower().endswith((".ogg", ".mp3")))
        body = json.dumps({"music": names}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_ws(self):
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self.send_response(400)
            self.end_headers()
            return
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode("ascii")).digest()).decode("ascii")
        self.wfile.write(
            ("HTTP/1.1 101 Switching Protocols\r\n"
             "Upgrade: websocket\r\n"
             "Connection: Upgrade\r\n"
             "Sec-WebSocket-Accept: " + accept + "\r\n\r\n").encode("ascii")
        )
        self.wfile.flush()
        try:
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass
        ws = WsConn(self.connection, self.rfile)
        conn = HUB.new_conn(ws)
        try:
            ws.loop(conn)
        except (OSError, ValueError):
            pass
        finally:
            HUB.disconnect(conn)
            self.close_connection = True

    def do_POST(self):
        path = self.path.split("?")[0]
        # GitHub webhook：/deploy?token=xxx
        if path == "/deploy":
            self.handle_deploy()
            return
        # 另一个 POST 用途：本机窗口模式保存玩家存档（?app=1 页面会调用）
        if path != "/api/profile":
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > 512 * 1024:
            self.send_response(400)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = self.rfile.read(n)
        tmp = profile_path() + ".tmp"
        try:
            json.loads(body.decode("utf-8"))        # 先验证是合法 JSON
            with open(tmp, "wb") as f:
                f.write(body)
            os.replace(tmp, profile_path())
            resp = b'{"ok":true}'
            self.send_response(200)
        except Exception:                           # noqa: BLE001
            resp = b'{"ok":false}'
            self.send_response(500)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)


class ThreadingServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64

    def handle_error(self, request, client_address):
        """客户端突然关闭连接（关窗口 / 拔网线）是常态，不要往控制台刷异常堆栈。"""
        import sys as _sys
        exc = _sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError)):
            return
        socketserver.ThreadingTCPServer.handle_error(self, request, client_address)


def lan_ips():
    out = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip not in out and not ip.startswith("127."):
                out.append(ip)
    except OSError:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and ip not in out:
            out.insert(0, ip)
    except OSError:
        pass
    if not out:
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                ip = info[4][0]
                if ip not in out:
                    out.append(ip)
        except OSError:
            pass

    def rank(a):
        if a.startswith("192.168."):
            return 0
        if a.startswith("10."):
            return 1
        parts = a.split(".")
        if len(parts) == 4 and parts[0] == "172" and 16 <= int(parts[1]) <= 31:
            return 2
        return 3
    return sorted(out, key=rank)


def log(msg):
    try:
        print(msg, flush=True)
    except (UnicodeEncodeError, ValueError):
        # 极老旧的终端可能连降级编码都写不出来，宁可少打印也不能崩
        try:
            print(msg.encode("ascii", "replace").decode("ascii"), flush=True)
        except Exception:      # noqa: BLE001
            pass


def start_server(port, strict=False):
    """绑定端口。

    strict=True 时不顺延：端口被占就直接报错退出。
    公网服务器必须这样 —— 对外地址是固定的 :8123，一旦静默顺延到 8124，
    外面访问 8123 打到的还是上一个没杀干净的旧进程（页面看着正常、代码是旧的），
    这种「假活」比直接报错难查一百倍。桌面启动器仍然允许顺延（开第二个实例用）。
    """
    for attempt in range(1 if strict else 12):
        try:
            httpd = ThreadingServer(("0.0.0.0", port), Handler)
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            return httpd, port
        except OSError:
            if strict:
                log("")
                log("  ✗ 端口 %d 已经被占用 —— 多半是上一个实例没杀干净。" % port)
                log("    旧进程还在对外服务旧代码，页面看着正常但功能是旧的。")
                log("    先清理再启动：pkill -f 'server.py --server'")
                log("")
                raise SystemExit(1)
            log("[提示] 端口 %d 被占用，改用 %d …" % (port, port + 1))
            port += 1
    raise SystemExit("[错误] 连续 12 个端口都被占用，无法启动服务器。")


def print_banner(port):
    line = "═" * 58
    ips = lan_ips()
    log("")
    log(line)
    log("  ⚔️  %s · 局域网对战服务器已启动" % APP_NAME)
    log(line)
    log("  🖥  本机打开：        http://localhost:%d" % port)
    if ips:
        log("  📡  另一台电脑打开：")
        for ip in ips:
            log("        http://%s:%d" % (ip, port))
    else:
        log("  ⚠️  没有检测到局域网 IP，请确认已连上 Wi-Fi / 网线")
    log("")
    log("  🔑 房主点「多人游戏 → 创建房间」，把地址和 4 位房号发给朋友")
    log("  ⚠️  首次运行如弹出防火墙提示，请勾选「专用网络」「公用网络」并允许")
    log("  ⏹  关闭本窗口（或游戏窗口）即停止服务器")
    log(line)
    log("")
    return ips


def _set_app_user_model_id():
    """给进程设置固定的 AppUserModelID。

    不设置的话，Windows 任务栏会把窗口当作临时的 python/WebView2 进程，
    显示系统默认图标——这就是「任务栏图标没有变成应用图标」的根因。
    设置后任务栏按钮与 exe 图标正确关联，窗口分组也稳定。
    """
    if os.name != "nt":
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("RikkaLove0721.GuGaoLvDou")
    except Exception:      # noqa: BLE001
        pass


def open_native_window(url):
    """优先用原生窗口；不行就退回浏览器。

    注意：不要给 webview.start 传 func 去手动改窗口图标——
    pywebview 的 func 线程在窗口创建完成前就会启动，冻结态下它与
    WinForms 初始化存在竞态，会把窗口卡在「已创建未显示」状态。
    图标由 start(icon=...) 在 UI 线程构造窗口时设置，任务栏分组由
    _set_app_user_model_id 保证。
    """
    try:
        import webview  # noqa

        window = webview.create_window(APP_NAME, url, width=1010, height=670,
                                       min_size=(760, 520), background_color="#05070f")
        _set_app_user_model_id()
        ico = resource_path(os.path.join("assets", "icon.ico"))
        kwargs = {}
        if os.path.exists(ico):
            kwargs["icon"] = ico     # pywebview >= 6.1 在窗口构造时（UI 线程）应用图标
        webview.start(**kwargs)
        return True
    except Exception as exc:      # noqa: BLE001
        log("[提示] 原生窗口不可用（%s），改用浏览器打开。" % exc)
        return False


def open_browser_app(url):
    """尝试用 Chromium 的 app 模式打开（无地址栏，像桌面应用）。"""
    candidates = [
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"),
                     r"Microsoft\Edge\Application\msedge.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
                     r"Microsoft\Edge\Application\msedge.exe"),
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"),
                     r"Google\Chrome\Application\chrome.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
                     r"Google\Chrome\Application\chrome.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"),
    ]
    import subprocess
    for exe in candidates:
        if os.path.exists(exe):
            try:
                subprocess.Popen([exe, "--app=" + url, "--window-size=1010,670"])
                return True
            except OSError:
                continue
    try:
        webbrowser.open(url)
        return True
    except Exception:      # noqa: BLE001
        return False


def watch_reload(script):
    """盯着 server.py，被换掉就原地重启自己。

    线上部署是「GitHub 自动 pull」：只更新文件，没人会记得去重启进程。
    而 HTML 是每次请求现读磁盘的，所以「换了页面不重启」看着完全像更新成功 ——
    但路由是进程启动时定死的，新页面要 /game.js /assets/，老进程没有，
    于是全 404、页面永远转圈（v4.24 就是这么翻的车）。

    这里每 2 秒比一次 mtime + 大小，变了就用 execv 原地换掉进程：
    PID 不变、nohup 的日志重定向不变，start.sh -d 那套不用改。
    换之前先编译一遍新文件，语法有错就宁可继续跑旧的 ——
    自动重启最怕把「能用的旧版」换成「起不来的新版」。
    """
    if not script or not os.path.isfile(script):
        return
    try:
        st = os.stat(script)
    except OSError:
        return
    sig = (st.st_mtime_ns, st.st_size)
    missed = 0
    while True:
        time.sleep(2.0)
        try:
            st = os.stat(script)
        except OSError:
            continue
        cur = (st.st_mtime_ns, st.st_size)
        if cur == sig:
            continue
        sig = cur
        if missed >= 3:                 # 连换三次都起不来就别再试了，省得反复重启
            log("  ⚠️  server.py 反复变化但重启无效，已停止自动重载（请手动重启）")
            return
        try:
            # 只在内存里编译一遍，不落 .pyc：
            # py_compile 写 cfile=os.devnull 在 Windows 上会报
            # "nul is a non-regular file"（这坑在真机上踩过）。
            with io.open(script, encoding="utf-8") as f:
                compile(f.read(), script, "exec")
        except Exception as e:          # noqa: BLE001
            missed += 1
            log("  ⚠️  server.py 有更新但语法没通过，继续跑旧版本：%s" % e)
            continue
        if os.name != "posix":
            # 只有 Linux/macOS 的 execv 是「原地换掉进程镜像」：PID 不变、端口不释放、
            # nohup 的日志重定向继续有效。Windows 上 execv 会把当前进程弄没，
            # 反而把能跑的旧版也搞挂 —— 所以那边只提示，不自动重启。
            log("  ℹ️  server.py 已更新；当前系统不支持原地重启，请手动 ./stop.sh && ./start.sh -d")
            continue
        log("  🔄  检测到 server.py 更新，正在原地重启…")
        try:
            sys.stdout.flush()
            os.execv(sys.executable, [sys.executable, script] + sys.argv[1:])
        except Exception as e:          # noqa: BLE001
            log("  ⚠️  自动重启失败：%s（请手动 ./stop.sh && ./start.sh -d）" % e)
            return


def main():
    args = sys.argv[1:]
    port = BASE_PORT
    if "--port" in args:
        try:
            port = int(args[args.index("--port") + 1])
        except (IndexError, ValueError):
            port = BASE_PORT
    server_only = "--server" in args
    strict_port = "--strict-port" in args
    if not server_only and os.name != "nt":
        # Linux / macOS 没有 pywebview 桌面壳（也不该开窗口），自动退化为纯服务器模式，
        # 免得在 VPS 上跑出「No module named webview」
        log("  ℹ️  非 Windows 环境：自动进入纯服务器模式（等价 --server）")
        server_only = True

    html = resource_path(GAME_FILE)
    if not os.path.exists(html):
        print("[错误] 找不到游戏文件：%s" % html, flush=True)
        print("       请把 %s 与启动器放在同一个文件夹里。" % GAME_FILE, flush=True)
        input("按回车键退出…")
        return 1

    try:
        _embed = getattr(sys, "_MEIPASS", None)
        _src = "外部更新版" if (not _embed or os.path.dirname(html) != _embed) else "EXE 内置版"
    except Exception:      # noqa: BLE001
        _src = "未知"
    log("  🎮  游戏文件：%s（%s）" % (os.path.basename(html), _src))

    # ---- 自带体检：这套文件到底能不能跑起来 ----
    # v4.24 之前只检查「HTML 在不在」。可 HTML 拆成骨架之后还必须有 game.js 和
    # assets/，少一样页面就是白屏 —— 而且 404 不会报错，只在浏览器里静默失败，
    # 表现成「一直加载」。启动时把结论打到日志里，免得再去翻浏览器控制台。
    try:
        with open(html, "r", encoding="utf-8", errors="ignore") as f:
            head = f.read(65536)
    except OSError:
        head = ""
    needs_js = "game.js" in head
    problems = []
    if needs_js:
        if not os.path.exists(resource_path("game.js")):
            problems.append("缺少 game.js")
        if not os.path.isdir(os.path.join(app_dir(), "assets")):
            problems.append("缺少 assets/ 目录")
        n_music = 0
        for d in (music_dir_path(), os.path.join(app_dir(), "music")):
            if os.path.isdir(d):
                n_music = max(n_music, len([x for x in os.listdir(d) if x.lower().endswith((".m4a", ".mp3", ".ogg", ".opus"))]))
        def has(word):
            return any(word in p for p in problems)
        log("  📦  网页版（拆分）  game.js %s · assets/ %s · BGM %d 首"
            % ("✗" if has("game.js") else "✓", "✗" if has("assets") else "✓", n_music))
    else:
        log("  📦  单文件版（素材已内嵌，无需 assets/）")
    if problems:
        log("")
        log("  ⚠️  这套文件跑不起来：%s" % "、".join(problems))
        log("      HTML 是新版（引用了 game.js），但配套文件没一起放上来。")
        log("      请用 dist/web/ 里的整套（孤高旅斗.html + game.js + assets/ + music/）覆盖。")
        log("")

    httpd, port = start_server(port, strict=strict_port)
    print_banner(port)
    # 自动 pull 的部署里没人会记得重启；这里自己盯着源文件（打包成 exe 时没有源文件，跳过）
    if server_only and not getattr(sys, "frozen", False):
        try:
            threading.Thread(target=watch_reload,
                             args=(os.path.abspath(__file__),), daemon=True).start()
            log("  👀  已开启自动重载：server.py 被更新（git pull）后会自动重启")
        except Exception:               # noqa: BLE001
            pass
    url = "http://localhost:%d/?app=1" % port    # app=1: 本机窗口模式，存档走服务器文件

    def keepalive():
        while True:
            time.sleep(60)
            HUB.gc()
    threading.Thread(target=keepalive, daemon=True).start()

    if server_only:
        log("  （--server 模式：没有开窗口，按 Ctrl+C 结束）")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        return 0

    if not open_native_window(url):
        open_browser_app(url)
        log("")
        log("  ℹ️  已用浏览器打开游戏。服务器会一直运行，关掉本窗口即停止。")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    return 0


def _run():
    """顶层包装：任何未预料的异常都打印出来并停住，避免「窗口一闪而过」。"""
    try:
        return main() or 0
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else 0
    except Exception:      # noqa: BLE001
        import traceback
        log("")
        log("=" * 58)
        log("  [启动失败] 发生了未预料的错误，请把下面的内容截图反馈：")
        log("=" * 58)
        log(traceback.format_exc())
        log("=" * 58)
        try:
            input("按回车键退出…")
        except (EOFError, KeyboardInterrupt):
            pass
        return 1


if __name__ == "__main__":
    sys.exit(_run())

#