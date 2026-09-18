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

    html = shell.replace("__SCRIPTS__", "\n".join(blocks)).replace("__VERSION__", ver)

    # 菜单背景图：assets/menu-bg.jpg -> data URI（单文件内嵌）
    bg_path = os.path.join(ROOT, "assets", "menu-bg.jpg")
    if os.path.exists(bg_path):
        with open(bg_path, "rb") as f:
            data_uri = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("ascii")
        html = html.replace("__MENU_BG__", data_uri)
    else:
        html = html.replace("__MENU_BG__", "")   # 没有背景图时退回纯色

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
    print("  输出  ->  %s  (%.1f KB)" % (OUT, os.path.getsize(OUT) / 1024.0))
    print("  版本  ->  v%s" % ver)


if __name__ == "__main__":
    main()
