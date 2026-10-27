# -*- coding: utf-8 -*-
"""
孤高旅斗 · 构建脚本
--------------------------------------------------------------
把 孤高旅斗-src/js/*.js 按文件名顺序合并，注入 shell.html，
输出单文件 孤高旅斗.html，并把版本号自动 +0.1。

用法：
    python build.py            # 正常构建（版本号自动提升）
    python build.py --keep     # 调试构建（版本号不变）
    python build.py --version 1.5   # 指定版本号
    python build.py --keep --web    # 服务器版：素材拆成独立文件，输出到 dist/web/

两种产物的区别（v4.22）：
    · 默认（单文件）：一切素材 base64 内嵌，双击即玩、exe 桌面壳用它。
    · --web（服务器版）：HTML 只剩代码（~1.1MB），图片 / BGM 是独立文件，
      靠浏览器缓存 + 服务端 gzip。12.9MB -> 首屏约 40KB + 按需加载。
      必须放在 HTTP 服务下（file:// 打开会因同源策略拿不到图层）。
"""
import base64
import io
import json
import os
import hashlib
import re
import shutil
import sys
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 仓库根目录
SRC = os.path.join(ROOT, "src")
JS_DIR = os.path.join(SRC, "js")
DIST = os.path.join(ROOT, "dist")
OUT = os.path.join(DIST, "孤高旅斗.html")
AUTHOR = "RikkaLove0721"

# --web：素材不内嵌，写成独立文件（HTML 里只留相对路径）
WEB = False
WEB_ASSETS = []          # [(相对路径, 源文件绝对路径)]，构建末尾统一拷到 dist/web/
WEB_GEN = []             # [(相对路径, 字节)]，--web 现场转码出来的文件（webp）


def asset(src_path, mime, rel, dst=None, opt=None):
    """返回「给浏览器用的素材地址」。

    单文件模式：base64 data URI（自包含，file:// 也能用）
    --web 模式：相对路径 + 登记待拷贝，由浏览器按需加载并长期缓存

    opt = {"maxw": 1600, "q": 86} —— 只在 --web 生效：超过 maxw 就先等比缩小，
    再重编码成 webp。单文件 / exe 那份保持原图不动。
    """
    if WEB:
        if opt:
            try:
                from PIL import Image
                im = Image.open(src_path)
                im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
                if opt.get("maxw") and im.width > opt["maxw"]:
                    h2 = max(1, round(im.height * opt["maxw"] / im.width))
                    im = im.resize((opt["maxw"], h2), Image.LANCZOS)
                buf = io.BytesIO()
                im.save(buf, "WEBP", quality=opt.get("q", 86), method=6)
                data = buf.getvalue()
                new_rel = rel.rsplit(".", 1)[0] + ".webp"
                WEB_GEN.append((new_rel, data))
                print("  压缩     %-26s %6.0f KB -> %5.0f KB  (%dx%d webp)"
                      % (os.path.basename(src_path), os.path.getsize(src_path) / 1024.0,
                         len(data) / 1024.0, im.width, im.height))
                return new_rel + "?v=__STAMP__"
            except Exception as e:      # noqa: BLE001  —— 没有 PIL 就退回原图
                print("  压缩失败 %s（%s），改用原图" % (os.path.basename(src_path), e))
        WEB_ASSETS.append((dst or rel, src_path))
        # 指纹占位：末尾统一换成这次构建的短哈希。
        # 服务器对静态资源回 immutable + 一年缓存，没有指纹的话
        # 「换了一张立绘 / 改了玩法」玩家会一直看到旧的。
        return rel + "?v=__STAMP__"
    with open(src_path, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))
BALANCE = os.path.join(SRC, "config", "balance.js")


def bump(v):
    major, _, minor = v.partition(".")
    return "%s.%d" % (major, int(minor or 0) + 1)


def main():
    args = sys.argv[1:]
    keep = "--keep" in args
    global WEB
    WEB = "--web" in args
    forced = None
    if "--version" in args:
        forced = args[args.index("--version") + 1]

    vpath = os.path.join(SRC, "VERSION")
    cur = io.open(vpath, encoding="utf-8").read().strip() or "1.0"
    ver = forced or (cur if keep else bump(cur))
    if ver != cur:
        io.open(vpath, "w", encoding="utf-8").write(ver)

    # 版本号模块（含作者常量，遵循 AGENTS.md 第 18 章）
    io.open(os.path.join(JS_DIR, "00_version.js"), "w", encoding="utf-8").write(
        '/* 由 build.py 自动生成，请勿手改 */\n'
        '(function (LD) { LD.VERSION = "%s"; LD.AUTHOR = "%s"; })'
        '(window.LD = window.LD || {});\n' % (ver, AUTHOR)
    )

    files = sorted(f for f in os.listdir(JS_DIR) if f.endswith(".js"))
    blocks = []
    total = 0
    for f in files:
        code = io.open(os.path.join(JS_DIR, f), encoding="utf-8").read()
        if "</script>" in code:
            raise SystemExit("!! %s 含有 </script>，会破坏 HTML" % f)
        total += len(code)
        blocks.append("/* ===== %s ===== */\n%s" % (f, code))
        print("  + %-18s %6d chars" % (f, len(code)))

    shell = io.open(os.path.join(SRC, "shell.html"), encoding="utf-8").read()
    if "__SCRIPTS__" not in shell or "__VERSION__" not in shell:
        raise SystemExit("!! shell.html 缺少占位符")

    # 皮肤贴图：assets/skins/<套装>/parts/*.png -> window.LD_SKIN_IMG（data URI，单文件内嵌）
    # key = png 文件名（不含扩展名），与部件数据里的 img 字段对应
    skin_dir = os.path.join(ROOT, "assets", "skins")
    img_lines = []
    if os.path.isdir(skin_dir):
        for suit in sorted(os.listdir(skin_dir)):
            pdir = os.path.join(skin_dir, suit, "parts")
            if not os.path.isdir(pdir):
                continue
            for fn in sorted(os.listdir(pdir)):
                if not fn.lower().endswith(".png"):
                    continue
                uri = asset(os.path.join(pdir, fn), "image/png",
                            "assets/skins/%s/parts/%s" % (suit, fn))
                img_lines.append('LD_SKIN_IMG[%s]=%s;' % (json.dumps(fn[:-4]), json.dumps(uri)))
                print("  皮肤贴图 %-24s %6.1f KB" % (fn, len(uri) / 1024.0))
    skin_js = "/* 皮肤贴图由 build.py 自动内嵌，请勿手改 */\nwindow.LD_SKIN_IMG={};" + "".join(img_lines)
    blocks.insert(0, skin_js)

    # v3.7 建筑贴图：assets/props/*.png -> window.LD_PROP_IMG（key = 文件名，如 tower / crystal）
    prop_dir = os.path.join(ROOT, "assets", "props")
    prop_lines = []
    if os.path.isdir(prop_dir):
        for fn in sorted(os.listdir(prop_dir)):
            if not fn.lower().endswith(".png"):
                continue
            uri = asset(os.path.join(prop_dir, fn), "image/png", "assets/props/" + fn)
            prop_lines.append('LD_PROP_IMG[%s]=%s;' % (json.dumps(fn[:-4]), json.dumps(uri)))
            print("  建筑贴图 %-24s %6.1f KB" % (fn, len(uri) / 1024.0))
    prop_js = "/* 建筑贴图由 build.py 自动内嵌，请勿手改 */\nwindow.LD_PROP_IMG={};" + "".join(prop_lines)
    blocks.insert(0, prop_js)

    # 背景音乐：dist/music_built/*.m4a （scripts/proc_music.py 压缩产物）-> window.LD_MUSIC
    # 直接内嵌成 data URI，保证「单文件双击即玩」也有 BGM；没有素材就留空数组。
    music_dir = os.path.join(DIST, "music_built")
    music_items = []
    music_bytes = 0
    if os.path.isdir(music_dir):
        for fn in sorted(os.listdir(music_dir)):
            low = fn.lower()
            if low.endswith(".m4a") or low.endswith(".aac") or low.endswith(".mp4"):
                mime = "audio/mp4"
            elif low.endswith(".mp3"):
                mime = "audio/mpeg"
            elif low.endswith(".ogg") or low.endswith(".opus"):
                mime = "audio/ogg"
            else:
                continue
            # 文件名里有空格和中文（"Feel You.m4a" / "遊園施設.m4a"）：
            # 写进 JS 前先做 URL 编码，否则 src 里带裸空格，个别浏览器解析会截断。
            # URL 里的名字要编码（空格 / 中文），磁盘上的文件名保持原样 ——
            # 两者混用会让 dist/web/music 里出现「Feel%20You.m4a」这种奇怪文件，
            # 服务器 unquote 之后反而找不到真正的文件。
            uri = asset(os.path.join(music_dir, fn), mime,
                        "music/" + quote(fn), "music/" + fn)
            music_bytes += (os.path.getsize(os.path.join(music_dir, fn)) if WEB else len(uri))
            music_items.append("{n:%s,d:%s}" % (json.dumps(fn.rsplit(".", 1)[0]), json.dumps(uri)))
            print("  背景音乐 %-26s %6.1f KB" % (fn, len(uri) / 1024.0))
    music_js = ("/* 背景音乐由 build.py 自动内嵌，请勿手改 */\nwindow.LD_MUSIC=[%s];"
                % ",".join(music_items))
    blocks.insert(0, music_js)

    # 主菜单立绘：assets/menu-bg.jpg -> window.LD_MENU_BG（data URI，单文件内嵌）
    # 只内嵌这一份：Live2D 背景直接从 JS 取图，其它覆盖层用 shell.html 里的
    # --menuBg 变量拿同一个串（同一个 base64 在产物里出现两次会让文件白白胖一倍）
    bg_path = os.path.join(ROOT, "assets", "menu-bg.jpg")
    bg_uri = ""
    if os.path.exists(bg_path):
        # 这张只当 CSS 底图用（上面压着 74%~94% 的暗色渐变，全屏环境底还要再糊 26px），
        # 720px 宽已经完全看不出差别 —— 原图 1440x808 / 211KB 纯属浪费流量。
        bg_uri = asset(bg_path, "image/jpeg", "assets/menu-bg.jpg",
                       opt={"maxw": 720, "q": 74})
    menu_js = ("/* 主菜单立绘由 build.py 自动内嵌，请勿手改 */\nwindow.LD_MENU_BG=%s;\n"
               % json.dumps(bg_uri))

    # 主菜单分层素材：assets/char/*.webp + meta.json -> window.LD_CHAR
    # meta 里的 uv 是「在整帧里的位置」，运行时按同一套 cover 换算贴回画布，
    # 所以缩放 / 裁切全都自动跟着走，换图不用改代码。
    char_dir = os.path.join(ROOT, "assets", "char")
    char_js = "/* 主菜单分层素材由 build.py 自动内嵌，请勿手改 */\nwindow.LD_CHAR=null;\n"
    meta_path = os.path.join(char_dir, "meta.json")
    if os.path.exists(meta_path):
        meta = json.loads(io.open(meta_path, encoding="utf-8").read())
        layers = {}
        char_kb = 0.0
        for name, info in meta.get("layers", {}).items():
            p = os.path.join(char_dir, info["file"])
            if not os.path.exists(p):
                continue
            ext = info["file"].rsplit(".", 1)[-1].lower()
            mime = "image/webp" if ext == "webp" else "image/png"
            uri = asset(p, mime, "assets/char/" + info["file"])
            char_kb += len(uri) / 1024.0
            layers[name] = {"uv": info["uv"], "px": info["px"], "src": uri}
            # 真实内容框（不含切层时留的 padding）：眨眼下缘几何要用它，
            # 否则 k=1 时闭眼线会落到眼睛下方十几像素的颊上。
            if info.get("content"):
                layers[name]["content"] = info["content"]
            print("  人物图层 %-6s %5dx%-5d %6.1f KB"
                  % (name, info["px"][0], info["px"][1], len(uri) / 1024.0))
        bg_p = os.path.join(char_dir, "bg.jpg")
        if os.path.exists(bg_p):
            # 这是菜单里真正画出来的场景底（canvas 逻辑尺寸 1600x1000），
            # 原图 2560 宽超过了画布，缩到 1600 无损可见 —— 503KB -> 约 200KB。
            uri = asset(bg_p, "image/jpeg", "assets/char/bg.jpg",
                        opt={"maxw": 1600, "q": 86})
            layers["bg"] = {"uv": [0, 0, 1, 1], "px": [0, 0], "src": uri}
            char_kb += len(uri) / 1024.0
            print("  人物图层 %-6s %6.1f KB" % ("bg", len(uri) / 1024.0))
        pack = {"frame": meta["frame"], "layers": layers,
                "order": meta.get("order") or ["body", "skirt", "sword", "armA", "armB", "hair"]}
        char_js = ("/* 主菜单分层素材由 build.py 自动内嵌，请勿手改 */\nwindow.LD_CHAR=%s;\n"
                   % json.dumps(pack, ensure_ascii=False))
        print("  人物合计 %.1f KB" % char_kb)

    # 主菜单循环视频（v4.29）：assets/menu-loop.mp4（正放+倒放，见 scripts/make_menu_loop.py）
    # 体积是抠过的：960x540 @15fps、8 秒正放 + 8 秒倒放 = 16 秒无缝循环，约 490KB。
    # --web 走独立文件（服务器支持 Range，可以边下边播 + 长期缓存）；
    # 单文件 / exe 内嵌成 data URI，离线也能放。
    vid_js = "/* 主菜单视频由 build.py 自动内嵌，请勿手改 */\nwindow.LD_MENU_LOOP=null;\nwindow.LD_MENU_POSTER=null;\n"
    loop_p = os.path.join(ROOT, "assets", "menu-loop.mp4")
    poster_p = os.path.join(ROOT, "assets", "menu-poster.webp")
    if os.path.exists(loop_p):
        loop_uri = asset(loop_p, "video/mp4", "assets/menu-loop.mp4")
        poster_uri = asset(poster_p, "image/webp", "assets/menu-poster.webp") \
            if os.path.exists(poster_p) else ""
        vid_js = ("/* 主菜单视频由 build.py 自动内嵌，请勿手改 */\n"
                  "window.LD_MENU_LOOP=%s;\nwindow.LD_MENU_POSTER=%s;\n"
                  % (json.dumps(loop_uri), json.dumps(poster_uri)))
        print("  视频   menu-loop.mp4  %.0f KB  (poster %.0f KB)"
              % (os.path.getsize(loop_p) / 1024.0,
                 os.path.getsize(poster_p) / 1024.0 if os.path.exists(poster_p) else 0))

    # 所有脚本按「素材 -> 模块」的顺序拼成一块
    bundle = menu_js + char_js + vid_js + "\n".join(blocks)

    if WEB:
        # 服务器版：脚本单独成文件，HTML 只剩骨架。
        # 好处有三个：① HTML 从 12.9MB 掉到几十 KB，首字节立刻到；
        # ② game.js 能被浏览器单独缓存，改玩法之外的东西不用重下；
        # ③ gzip 只压一份 JS，比压一整块 HTML（含 base64）压得动得多。
        html = shell.replace("<script>\n__SCRIPTS__\n</script>",
                             '<script src="game.js?v=__STAMP__"></script>')
        if "__SCRIPTS__" in html:
            raise SystemExit("!! shell.html 里的 __SCRIPTS__ 包裹形式变了，--web 无法拆分")
    else:
        html = shell.replace("__SCRIPTS__", bundle)
    html = html.replace("__VERSION__", ver)
    html = html.replace("__MENU_BG__", bg_uri)      # 兼容旧占位符

    # 图标：assets/icon-sm.png -> __ICON__（网页 favicon + 主菜单徽章）
    icon_path = os.path.join(ROOT, "assets", "icon-sm.png")
    icon_uri = ""
    if os.path.exists(icon_path):
        icon_uri = asset(icon_path, "image/png", "assets/icon-sm.png")
    html = html.replace("__ICON__", icon_uri)
    if icon_uri:
        print("  图标   icon-sm.png 内嵌 %.0f KB" % (len(icon_uri) / 1024.0))
    if bg_uri:
        print("  立绘   menu-bg.jpg 内嵌 %.0f KB" % (len(bg_uri) / 1024.0))

    # 自检：必须出现的标记
    for token in ["孤高旅斗", "皮肤商店", "技能商店", "游戏帮助", "多人游戏", "作弊：+10 金币"]:
        if token not in html:
            raise SystemExit("!! 产出缺少标记：%s" % token)

    os.makedirs(DIST, exist_ok=True)

    if WEB:
        # 构建指纹：脚本内容 + 每个素材的字节。任何一处变了，URL 就变了，
        # 浏览器才会去拿新的（否则 immutable 缓存会让更新永远到不了玩家）。
        h = hashlib.md5()
        h.update(bundle.encode("utf-8"))
        for rel, src in WEB_ASSETS:
            h.update(rel.encode("utf-8"))
            with open(src, "rb") as f:
                h.update(f.read())
        for rel, data in WEB_GEN:
            h.update(rel.encode("utf-8"))
            h.update(data)
        stamp = h.hexdigest()[:10]
        bundle = bundle.replace("__STAMP__", stamp)
        html = html.replace("__STAMP__", stamp)
        if "__STAMP__" in html or "__STAMP__" in bundle:
            raise SystemExit("!! 指纹占位没换干净")

        out_dir = os.path.join(DIST, "web")
        if os.path.isdir(out_dir):
            # 整目录重建，免得旧素材残留。
            # 不用 shutil.rmtree：某些环境把它接管成「移入回收站」，
            # 对刚生成过的目录会直接报错，构建就断在这儿。
            for root, dirs, fs in os.walk(out_dir, topdown=False):
                for fn in fs:
                    try:
                        os.remove(os.path.join(root, fn))
                    except OSError:
                        pass
                for dn in dirs:
                    try:
                        os.rmdir(os.path.join(root, dn))
                    except OSError:
                        pass
            try:
                os.rmdir(out_dir)
            except OSError:
                pass
        os.makedirs(out_dir, exist_ok=True)
        io.open(os.path.join(out_dir, "game.js"), "w", encoding="utf-8").write(bundle)
        io.open(os.path.join(out_dir, "孤高旅斗.html"), "w", encoding="utf-8").write(html)
        copied = 0
        for rel, src in WEB_ASSETS:
            dst = os.path.join(out_dir, *rel.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
            copied += os.path.getsize(dst)
        for rel, data in WEB_GEN:
            dst = os.path.join(out_dir, *rel.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "wb") as f:
                f.write(data)
            copied += len(data)
        # 平衡配置跟着一起放（网页版由 /balance.js 路由取）
        shutil.copyfile(BALANCE, os.path.join(out_dir, "balance.js"))
        js_kb = os.path.getsize(os.path.join(out_dir, "game.js")) / 1024.0
        html_kb = os.path.getsize(os.path.join(out_dir, "孤高旅斗.html")) / 1024.0
        print("\n  JS 合计 %d chars / %d 个模块" % (total, len(files)))
        print("  拆分   游戏脚本 %.0f KB  ->  web/game.js" % js_kb)
        print("         HTML 骨架 %.1f KB  ->  web/孤高旅斗.html" % html_kb)
        print("         独立素材 %d 个 / %.1f MB" % (len(WEB_ASSETS), copied / 1024.0 / 1024.0))
        print("  版本  ->  v%s" % ver)
        print("\n  服务器版输出 -> %s" % out_dir)
        return

    io.open(OUT, "w", encoding="utf-8").write(html)

    # 平衡配置：dist 里没有才复制（不覆盖用户已经调过的那份）
    out_balance = os.path.join(DIST, "balance.js")
    if not os.path.exists(out_balance):
        io.open(out_balance, "w", encoding="utf-8").write(io.open(BALANCE, encoding="utf-8").read())
        print("  配置  ->  dist/balance.js（首次生成，之后改平衡直接编辑它）")
    print("\n  JS 合计 %d chars / %d 个模块" % (total, len(files)))
    if music_items:
        print("  音乐   %d 首 / 内嵌 %.1f MB" % (len(music_items), music_bytes / 1024.0 / 1024.0))
    print("  输出  ->  %s  (%.1f KB)" % (OUT, os.path.getsize(OUT) / 1024.0))
    print("  版本  ->  v%s" % ver)


if __name__ == "__main__":
    main()
