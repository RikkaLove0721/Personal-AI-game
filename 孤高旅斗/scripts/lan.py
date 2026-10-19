# -*- coding: utf-8 -*-
"""一键把《孤高旅斗》开放给同一局域网的手机 / 平板 / 其它电脑游玩。

做的事情：
  1. 复用 src/server/孤高旅斗.py 里的局域网服务器（HTTP 提供单文件页面 + WebSocket 对战）
  2. 打印所有局域网地址和手机侧操作步骤
  3. 生成一张二维码图片并自动打开，手机 Safari 扫码即可进入

用法（在项目根目录）：
    python scripts/lan.py            # 默认 8123
    python scripts/lan.py 9000       # 指定端口

手机访问的是 http://<电脑局域网IP>:<端口>，页面里的 WebSocket 地址由
location.host 自动推导，不需要任何额外配置。页面本身双端自适应：
手机/平板打开是触屏摇杆，电脑打开是键鼠。
"""
import importlib.util
import os
import sys
import time
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_PY = os.path.join(ROOT, "src", "server", "孤高旅斗.py")

LINE = "═" * 60


def load_server_module():
    spec = importlib.util.spec_from_file_location("ggld_server", SERVER_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def route_ip():
    """本机实际出网用的那个 IP（手机最可能同网段的那个）。"""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def order_urls(ips, port):
    """二维码只放最可能正确的 1~2 个地址：出网 IP 优先，其次 192.168 段。"""
    r = route_ip()
    picked = []
    if r and r in ips:
        picked.append(r)
    for ip in ips:
        if ip not in picked:
            picked.append(ip)
        if len(picked) >= 2:
            break
    return ["http://%s:%d" % (ip, port) for ip in picked]


def build_qr_sheet(urls):
    """把若干网址排成一张横向二维码图，返回保存路径；缺库时返回 None。"""
    try:
        import qrcode
        from PIL import Image, ImageDraw, ImageFont
    except Exception:
        return None

    cell = 300
    pad = 24
    label_h = 46
    n = len(urls)
    sheet = Image.new("RGB", (cell * n + pad * (n + 1), cell + label_h + pad * 2), (12, 18, 34))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 20)
    except Exception:
        font = ImageFont.load_default()

    for i, u in enumerate(urls):
        qr = qrcode.make(u).convert("RGB").resize((cell, cell))
        x = pad + i * (cell + pad)
        sheet.paste(qr, (x, pad))
        tw = draw.textlength(u, font=font)
        draw.text((x + (cell - tw) / 2, pad + cell + 10), u, fill=(180, 220, 255), font=font)

    out = os.path.join(ROOT, "dist", "lan_qr.png")
    try:
        sheet.save(out)
    except Exception:
        out = os.path.join(os.path.expanduser("~"), "孤高旅斗_局域网二维码.png")
        sheet.save(out)
    return out


def main():
    port = mod.BASE_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    html = mod.resource_path(mod.GAME_FILE)
    if not os.path.exists(html):
        print("[错误] 找不到游戏文件：%s" % html)
        print("       请先执行构建：python scripts/build.py --version 2.7.0")
        try:
            input("按回车键退出…")
        except (EOFError, KeyboardInterrupt):
            pass
        return 1

    mod.log("  🎮  游戏文件：%s" % os.path.basename(html))

    httpd, port = mod.start_server(port)          # noqa: F841 端口被占用会自动顺延
    mod.print_banner(port)

    ips = mod.lan_ips()
    urls = ["http://%s:%d" % (ip, port) for ip in ips]
    if not urls:
        mod.log("  ⚠️  没检测到局域网 IP，请确认电脑已连上 Wi-Fi / 网线")
        urls = ["http://localhost:%d" % port]
    qr_urls = order_urls(ips, port) or urls[:1]

    mod.log(LINE)
    mod.log("  📱  手机 / 平板 / 别的电脑这样进：")
    mod.log("     1) 和这台电脑连同一个 Wi-Fi / 局域网（不要用访客网络）")
    mod.log("     2) 浏览器打开下面任一地址，或扫二维码（家/公司一般选 192.168.x.x 那个）")
    for u in urls:
        mod.log("        %s" % u)
    mod.log("     3) 手机先横屏（竖屏会弹出旋转提示），点「多人游戏 → 创建/加入房间」")
    mod.log("     4) 手机上 Safari 分享 → 添加到主屏幕，之后可全屏一键进入")
    mod.log("     　  （页面双端自适应：手机出摇杆按钮，电脑出键鼠操作，可混着一起联机）")
    mod.log(LINE)
    mod.log("  ⚠️  打不开？多半是 Windows 防火墙拦了。用管理员 PowerShell 跑一次：")
    mod.log('       netsh advfirewall firewall add rule name="孤高旅斗" dir=in action=allow protocol=TCP localport=%d' % port)
    mod.log("  ⚠️  手机切后台 / 锁屏会断开连接（暂未做断线重连），回前台请刷新页面重进房间")
    mod.log("  ⏹  关闭本窗口即停止服务器")
    mod.log(LINE)

    qr = build_qr_sheet(qr_urls)
    if qr:
        try:
            os.startfile(qr)
        except Exception:
            mod.log("  （二维码已保存：%s）" % qr)

    def keepalive():
        while True:
            time.sleep(60)
            try:
                mod.HUB.gc()
            except Exception:
                pass
    threading.Thread(target=keepalive, daemon=True).start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    mod = load_server_module()
    sys.exit(main())
