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
"""
import base64
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 仓库根目录
SRC = os.path.join(ROOT, "src")
JS_DIR = os.path.join(SRC, "js")
DIST = os.path.join(ROOT, "dist")
OUT = os.path.join(DIST, "孤高旅斗.html")
AUTHOR = "RikkaLove0721"
BALANCE = os.path.join(SRC, "config", "balance.js")


def bump(v):
    major, _, minor = v.partition(".")
    return "%s.%d" % (major, int(minor or 0) + 1)


def main():
    args = sys.argv[1:]
    keep = "--keep" in args
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
                with open(os.path.join(pdir, fn), "rb") as f:
                    uri = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")
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
            with open(os.path.join(prop_dir, fn), "rb") as f:
                uri = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")
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
            with open(os.path.join(music_dir, fn), "rb") as f:
                raw = f.read()
            uri = "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode("ascii"))
            music_bytes += len(uri)
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
        with open(bg_path, "rb") as f:
            bg_uri = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("ascii")
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
            with open(p, "rb") as f:
                uri = "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))
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
            with open(bg_p, "rb") as f:
                uri = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("ascii")
            layers["bg"] = {"uv": [0, 0, 1, 1], "px": [0, 0], "src": uri}
            char_kb += len(uri) / 1024.0
            print("  人物图层 %-6s %6.1f KB" % ("bg", len(uri) / 1024.0))
        pack = {"frame": meta["frame"], "layers": layers,
                "order": meta.get("order") or ["body", "skirt", "sword", "armA", "armB", "hair"]}
        char_js = ("/* 主菜单分层素材由 build.py 自动内嵌，请勿手改 */\nwindow.LD_CHAR=%s;\n"
                   % json.dumps(pack, ensure_ascii=False))
        print("  人物合计 %.1f KB" % char_kb)

    html = shell.replace("__SCRIPTS__", menu_js + char_js + "\n".join(blocks)).replace("__VERSION__", ver)
    html = html.replace("__MENU_BG__", bg_uri)      # 兼容旧占位符

    # 图标：assets/icon-sm.png -> __ICON__（网页 favicon + 主菜单徽章）
    icon_path = os.path.join(ROOT, "assets", "icon-sm.png")
    icon_uri = ""
    if os.path.exists(icon_path):
        with open(icon_path, "rb") as f:
            icon_uri = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")
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
