# -*- coding: utf-8 -*-
"""孤高旅斗 · 模块依赖与层级检查

本项目的分层不是靠 import，而是靠**文件名数字前缀**（build.py 用 sorted() 拼接，
所以文件名序就是加载序、也就是依赖层级）。没有编译器把关，写错层只能运行时炸，
所以加一个静态检查兜底。

检查项：
  1. 模块是否都包在 IIFE 里（`(function (LD) {...})(window.LD = window.LD || {})`）
     —— 漏包会直接污染 window，是本架构最常见的失守方式
  2. 是否有未被 IIFE 包裹的顶层声明
  3. 文件体积：超过 1200 行提示、超过 2000 行警告（拆分候选）
  4. 同一全局符号被两个以上模块赋值（潜在互相覆盖）
  5. 逆向引用统计：小序号模块用了大序号模块定义的符号（信息性，运行时调用通常合法）

用法：
    python scripts/depcheck.py            # 检查并报告
    python scripts/depcheck.py --strict   # 把「警告」也当作失败（供 CI 用）
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(ROOT, "src", "js")

WARN_LINES = 1200
BIG_LINES = 2000

IIFE_HEAD = re.compile(r"^\s*\(?\s*function\s*\(")
IIFE_TAIL = re.compile(r"\}\s*\)\s*\(\s*window\.")

DEF_RE = re.compile(r"\b(LD|B)\.([A-Za-z_$][\w$]*)\s*=(?!=)")
USE_RE = re.compile(r"\b(LD|B)\.([A-Za-z_$][\w$]*)")
TOP_DECL = re.compile(r"^(var|let|const|function)\s+([A-Za-z_$][\w$]*)", re.M)


def strip_comments(s):
    s = re.sub(r"/\*[\s\S]*?\*/", "", s)
    s = re.sub(r"^\s*//.*$", "", s, flags=re.M)
    return s


def seq(fname):
    """文件名前缀序号，用于比较层级（00 < 10 < 15 < 40 < 90）"""
    m = re.match(r"^(\d+)", fname)
    return int(m.group(1)) if m else 999


def main():
    strict = "--strict" in sys.argv
    files = sorted(f for f in os.listdir(JS_DIR) if f.endswith(".js"))
    mods, errors, warns, infos = [], [], [], []

    for f in files:
        raw = io.open(os.path.join(JS_DIR, f), encoding="utf-8").read()
        code = strip_comments(raw)
        lines = raw.count("\n") + 1
        head_ok = bool(IIFE_HEAD.match(code.lstrip().split("\n")[0] if code.strip() else ""))
        tail_ok = bool(IIFE_TAIL.search(code.rstrip()[-160:] if code.strip() else ""))

        # IIFE 之外的顶层声明（把首尾两行剔除后，剩余内容里的行首声明都算「模块内」，
        # 所以这里只在「没有 IIFE 包裹」时才判为污染）
        bare = []
        if not (head_ok and tail_ok):
            bare = [m.group(2) for m in TOP_DECL.finditer(code)]

        defs = set(m.group(2) for m in DEF_RE.finditer(code))
        uses = set(m.group(2) for m in USE_RE.finditer(code))
        mods.append({"f": f, "n": lines, "seq": seq(f), "iife": head_ok and tail_ok,
                     "defs": defs, "uses": uses, "bare": bare})

        if not (head_ok and tail_ok):
            errors.append("%s 未包在 IIFE 里，会污染 window（顶层声明：%s）"
                          % (f, ", ".join(bare[:6]) or "无"))
        if lines > BIG_LINES:
            warns.append("%s %d 行，超过 %d 行——建议按职责拆分" % (f, lines, BIG_LINES))
        elif lines > WARN_LINES:
            infos.append("%s %d 行，超过 %d 行——留意体积增长" % (f, lines, WARN_LINES))

    # 同一符号被多个模块赋值。这是本项目**既有**的扩展方式：
    # 玩法模块（42_tower 等）通过重新赋值 B.damage / B.kill 来注入自己的规则，
    # 属于「开放类」的土法实现，所以只提示不报错，但值得定期看一眼有没有互相踩。
    owner = {}
    for m in mods:
        for d in m["defs"]:
            owner.setdefault(d, []).append(m["f"])
    for d, fs in sorted(owner.items()):
        if len(fs) > 1:
            infos.append("符号 %s 在 %s 中都被赋值（玩法扩展核心函数的常见写法，注意别互相覆盖）"
                         % (d, " / ".join(fs)))

    # 逆向引用：小序号模块用了大序号模块定义的符号
    for m in mods:
        later = sorted(d for d in (m["uses"] & set(owner))
                       if seq(owner[d][0]) > m["seq"])
        if later:
            infos.append("%s 引用了更晚加载的模块定义的符号：%s"
                         % (m["f"], ", ".join(later[:8]) + ("…" if len(later) > 8 else "")))

    total = sum(m["n"] for m in mods)
    print("== 模块依赖与层级检查 ==")
    print("  模块 %d 个，共 %d 行\n" % (len(mods), total))
    print("  序号  文件                      行数   IIFE   定义符号")
    for m in mods:
        print("  %-5d %-24s %6d  %-5s  %d" %
              (m["seq"], m["f"], m["n"], "OK" if m["iife"] else "!!", len(m["defs"])))

    print("\n-- 错误 %d 条 --" % len(errors))
    for e in errors:
        print("  [E] " + e)
    print("-- 警告 %d 条 --" % len(warns))
    for w in warns:
        print("  [W] " + w)
    print("-- 提示 %d 条（体积增长 / 符号重复赋值 / 逆向引用，均不阻断）--" % len(infos))
    for i in infos:
        print("  [i] " + i)

    if errors:
        print("\n结论：有结构性错误，请修复")
        sys.exit(1)
    if strict and warns:
        print("\n结论：strict 模式下不接受警告")
        sys.exit(1)
    print("\n结论：结构正常")
    sys.exit(0)


if __name__ == "__main__":
    main()
