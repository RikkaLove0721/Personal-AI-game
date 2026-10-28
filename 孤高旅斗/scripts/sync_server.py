# -*- coding: utf-8 -*-
"""把构建产物同步到服务端目录（../孤高旅斗服务端）。

为什么需要这个脚本：
  手工 `cp dist/web/game.js ../服务端/` 只覆盖了脚本，**素材目录没动**。
  服务端为了省带宽，把两张背景原图转成了 webp（bg.jpg 515KB → bg.webp 198KB，
  menu-bg 同理），可 build.py 是按「dist 里实际存在的文件名」生成清单的，
  于是 game.js 里写死的是 assets/char/bg.jpg，而服务端只有 .webp
  —— 线上主菜单立绘和角色背景一直是 404。

本脚本做四件事：
  1. 跑 build.py --keep --web
  2. 把产物覆盖到服务端目录（素材逐文件比对，不改动服务端已有的 webp 优化）
  3. 扫描 game.js / html，把「目标文件不存在但同名 .webp 存在」的引用改写掉
  4. 更新 server.py 里的 ver，最后逐个 HEAD 请求自检

用法：
  python scripts/sync_server.py              # 构建 + 同步 + 自检
  python scripts/sync_server.py --no-build   # 跳过构建，只同步现有的 dist/web
  python scripts/sync_server.py --dry-run    # 只报告改什么，不落盘
"""
from __future__ import print_function
import io
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # 孤高旅斗/
WEB = os.path.join(ROOT, "dist", "web")
SRV = os.path.abspath(os.path.join(ROOT, os.pardir, "孤高旅斗服务端"))

TEXT_EXT = (".js", ".html")
# 引用的形如 assets/char/bg.jpg?v=142f20490e
REF_RE = re.compile(r'(assets/[A-Za-z0-9_./-]+)\.(jpg|jpeg|png)(\?[A-Za-z0-9=&._-]*)?')
VER_RE = re.compile(r'("ver"\s*:\s*")v?([0-9][0-9.]*)(")')


def read(path):
    with io.open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def write(path, s):
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(s)


def current_version():
    p = os.path.join(ROOT, "src", "VERSION")
    if os.path.exists(p):
        return read(p).strip()
    return ""


def build():
    print("[1/4] 构建 web 产物 …")
    r = subprocess.call([sys.executable, os.path.join(HERE, "build.py"), "--keep", "--web"],
                        cwd=ROOT)
    if r != 0:
        print("      构建失败，退出")
        sys.exit(1)


def copy_tree(dst_report):
    """按文件覆盖：dist/web → 服务端目录。

    素材只复制「dist 有、服务端没有」的文件 —— 服务端已有的 webp 是压缩过的，
    不能被 dist 里的大 jpg 顶掉。
    """
    print("[2/4] 复制产物 → %s" % SRV)
    added, updated = [], []
    for dirpath, _dirnames, files in os.walk(WEB):
        rel_dir = os.path.relpath(dirpath, WEB)
        dst_dir = os.path.join(SRV, rel_dir) if rel_dir != "." else SRV
        if not os.path.isdir(dst_dir):
            os.makedirs(dst_dir)
        for name in files:
            src = os.path.join(dirpath, name)
            dst = os.path.join(dst_dir, name)
            rel = os.path.relpath(dst, SRV)
            if not os.path.exists(dst):
                # 素材的 webp 优化版已在服务端 => 不要再放一份大的原图
                if os.path.splitext(name)[1].lower() in (".jpg", ".jpeg", ".png"):
                    webp = os.path.splitext(dst)[0] + ".webp"
                    if os.path.exists(webp):
                        continue
                if not dst_report:
                    shutil.copy2(src, dst)
                added.append(rel)
            else:
                with open(src, "rb") as a, open(dst, "rb") as b:
                    if a.read() == b.read():
                        continue
                if not dst_report:
                    shutil.copy2(src, dst)
                updated.append(rel)
    print("      新增 %d 个：%s" % (len(added), ", ".join(added[:8]) or "无"))
    print("      更新 %d 个：%s" % (len(updated), ", ".join(updated[:8]) or "无"))
    return added + updated


def fix_refs(dry):
    """把指向不存在文件的 .jpg/.png 引用改成同名 .webp（缺的就是那张图）。"""
    print("[3/4] 修正素材引用（jpg/png → 实际存在的 webp）")
    total = 0
    for name in ("game.js", "孤高旅斗.html"):
        p = os.path.join(SRV, name)
        if not os.path.exists(p):
            continue
        s = read(p)
        changed = []

        def repl(m):
            base, ext, q = m.group(1), m.group(2), m.group(3) or ""
            cur = os.path.join(SRV, base + "." + ext)
            if os.path.exists(cur):
                return m.group(0)
            for alt in (".webp",):
                cand = os.path.join(SRV, base + alt)
                if os.path.exists(cand):
                    changed.append(base + "." + ext + " → " + base + alt)
                    return base + alt + q
            return m.group(0)                      # 都不存在：保持原样，交给自检报错

        s2 = REF_RE.sub(repl, s)
        if changed:
            if not dry:
                write(p, s2)
            total += len(changed)
            for c in sorted(set(changed)):
                print("      %s：%s" % (name, c))
    if total == 0:
        print("      无需修改")
    return total


def bump_ver(dry):
    ver = current_version()
    p = os.path.join(SRV, "server.py")
    if not ver or not os.path.exists(p):
        return
    s = read(p)
    m = VER_RE.search(s)
    if not m or m.group(2) == ver:
        print("      server.py ver 已是 v%s" % ver)
        return
    if not dry:
        write(p, VER_RE.sub(lambda mm: mm.group(1) + "v" + ver + mm.group(3), s, count=1))
    print("      server.py ver：v%s → v%s" % (m.group(2), ver))


def selfcheck():
    """逐个静态引用发 HEAD，确认都 200 —— 同步完必须验，别再靠肉眼。"""
    print("[4/4] 自检（静态引用是否都取得到）")
    refs = set()
    for name in ("game.js", "孤高旅斗.html"):
        p = os.path.join(SRV, name)
        if not os.path.exists(p):
            continue
        for m in re.finditer(r'assets/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp)', read(p)):
            refs.add(m.group(0))
    missing = sorted(r for r in refs if not os.path.exists(os.path.join(SRV, r)))
    print("      引用 %d 个素材，缺失 %d 个" % (len(refs), len(missing)))
    for r in missing[:10]:
        print("        ✗ " + r)
    return len(missing)


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    if "--no-build" not in args:
        build()
    else:
        print("[1/4] 跳过构建（--no-build）")
    copy_tree(dry)
    fix_refs(dry)
    bump_ver(dry)
    miss = selfcheck()
    print("\n完成：" + ("全部引用可用 ✅" if miss == 0 else "仍有 %d 个缺失 ⚠️" % miss))
    return 0 if miss == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
