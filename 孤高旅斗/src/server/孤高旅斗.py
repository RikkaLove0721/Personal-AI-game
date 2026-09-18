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
import hashlib
import http.server
import json
import os
import random
import socket
import socketserver
import struct
import sys
import threading
import time
import webbrowser

APP_NAME = "孤高旅斗"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
BASE_PORT = 8123
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
    dev = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       os.pardir, os.pardir, "dist", name)   # ③ 开发态：源码运行时找仓库 dist/
    return dev if os.path.exists(dev) else packaged


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
        if path == "/api/profile":
            self.handle_profile_get()
            return
        if path == "/status":
            body = json.dumps({"rooms": len(HUB.rooms), "ok": True}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
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

    def serve_file(self, filename, ctype):
        try:
            with open(filename, "rb") as f:
                data = f.read()
        except OSError:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_profile_get(self):
        # 存档文件放在 exe 旁边（开发态放在 py 脚本旁边），端口漂移也不丢档
        self.serve_file(profile_path(), "application/json; charset=utf-8")

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
        # 目前唯一的 POST 用途：本机窗口模式保存玩家存档（?app=1 页面会调用）
        path = self.path.split("?")[0]
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


def start_server(port):
    for attempt in range(12):
        try:
            httpd = ThreadingServer(("0.0.0.0", port), Handler)
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            return httpd, port
        except OSError:
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


def open_native_window(url):
    """优先用原生窗口；不行就退回浏览器。"""
    try:
        import webview  # noqa

        window = webview.create_window(APP_NAME, url, width=1010, height=670,
                                       min_size=(760, 520), background_color="#05070f")
        webview.start()
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


def main():
    args = sys.argv[1:]
    port = BASE_PORT
    if "--port" in args:
        try:
            port = int(args[args.index("--port") + 1])
        except (IndexError, ValueError):
            port = BASE_PORT
    server_only = "--server" in args

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

    httpd, port = start_server(port)
    print_banner(port)
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
