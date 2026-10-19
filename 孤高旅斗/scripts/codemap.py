# -*- coding: utf-8 -*-
"""生成 .agents/CODEMAP.md —— 全源码的功能分区地图，供快速定位改动点。

用法:
    python scripts/codemap.py            # 生成 .agents/CODEMAP.md
    python scripts/codemap.py --stdout   # 只打印不写文件

规则:
- 模块按文件名排序合并（build.py 的顺序），行号即 src/js/*.js 内的真实行号。
- 函数识别: function xxx / X.prototype.y = function / X.y = function / xxx: function。
- 「功能索引」按 KEYWORDS 里的关键词逐文件 grep，命中即列出 文件:行号。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "js"
OUT = ROOT / ".agents" / "CODEMAP.md"

# 每个模块的一句话职责（人工维护，新增模块时补一行）
FILE_DESC = {
    "00_version.js": "版本号常量（构建脚本自动生成，勿手改）",
    "10_data.js": "全部数据表：技能/普攻/大招商店、皮肤、规则描述、平衡常量(LD.CONF)、霸主皇冠(LD.CROWN)、蓄力(LD.CHARGE)、交互(LD.INTERACT)、塔防(LD.TOWER)",
    "13_terrain_data.js": "地形预设数据：各地图的设施布点与计数",
    "15_terrain.js": "地形逻辑：设施生成/碰撞/推动/破坏 (LD.Terrain)",
    "20_profile.js": "存档：金币、解锁、成就、称号、配装 (LD.Profile)",
    "30_view.js": "角色渲染：Q版部件小人、皮肤图片部件、技能特效绘制",
    "32_terrain_view.js": "地形绘制：地面/设施/房间（整块铺+按行合并，防拼缝）",
    "33_tower_view.js": "塔防绘制：兵线小兵、防御塔、水晶、血条",
    "40_battle.js": "战斗引擎核心（最大文件）：主循环/伤害/击杀/能量/大招演出(Cine)/霸主皇冠/商店/缩圈/丧尸/末日/车轮等全部模式逻辑",
    "42_tower.js": "塔防对战逻辑：兵线/金币/等级/复活/防御塔攻击",
    "45_interact.js": "交互系统：P 键目标扫描与执行（上车/躲藏/泥土/蓄力开包/加冕/吹风机）",
    "50_ai.js": "人机 AI：索敌/走位/绕障(AI.steer)/放技能时机/抢皇冠/用车",
    "60_net.js": "联机：WebSocket 客户端、状态同步、房间协议",
    "70_ui.js": "全部界面：主菜单/HUD血条能量条/商店/成就/帮助/结算",
    "75_room.js": "房间界面：模式选择、玩家/人机配置、开局组队",
    "85_bgm.js": "背景音乐：随机播放、开关",
    "90_boot.js": "启动引导：画布初始化、主循环驱动、双端尺寸",
    "95_touch.js": "触屏：虚拟摇杆与技能按钮（含平板放大）",
}

# 功能关键词 -> 定位用。改动前先来这里查。
KEYWORDS = [
    "霸主", "皇冠", "crown", "能量包", "蓄力", "chg", "上车", "enterCar", "exitCar", "noCarT",
    "塔防", "水晶", "防御塔", "小兵", "laneMinion", "商店", "技能", "大招", "Cine",
    "缩圈", "毒圈", "丧尸", "末日", "车轮", "追猎", "hunter", "热身", "天外来物", "gift",
    "能量", "energy", "击杀", "金币", "成就", "称号", "皮肤", "套装",
    "躲藏", "泥土", "吹风机", "BLOWER", "柜子",
    "伤害", "damage", "眩晕", "击退", "暴击", "无敌",
    "摇杆", "触屏", "联机", "WebSocket", "房间", "存档", "profile",
    "地形", "terrain", "摄像机", "camera", " hud", "HUD",
]

RE_FUNC = re.compile(
    r"^\s*(?:"
    r"function\s+([A-Za-z_$][\w$]*)\s*\("                                   # function foo(
    r"|([A-Za-z_$][\w$.]*)\s*=\s*function\s*\*?\s*\(?([\w$,\s]*)\)"          # X.y = function(a,b)
    r"|([A-Za-z_$][\w$]*)\s*:\s*function\s*\("                               # foo: function(
    r"|class\s+([A-Za-z_$][\w$]*)"                                           # class Foo
    r"|([A-Za-z_$][\w$.]*)\s*=\s*\(\s*([^)]*)\)\s*=>"                        # X.y = (a) =>
    r")"
)
RE_BANNER = re.compile(r"^\s*/\*\s*=+\s*(.+?)\s*=+\s*\*/\s*$")
RE_CONST = re.compile(r"^\s*((?:LD|B|AI|T|C)\.[A-Z][\w.]*)\s*=\s*[{[]")


def short_sig(line: str) -> str:
    m = RE_FUNC.match(line)
    if m:
        if m.group(1):
            return "function " + m.group(1) + "(...)"
        if m.group(2):
            args = (m.group(3) or "").replace(" ", "")
            return m.group(2) + "(" + args + ")"
        if m.group(4):
            return m.group(4) + "(...)"
        if m.group(5):
            return "class " + m.group(5)
        if m.group(6):
            args = (m.group(7) or "").replace(" ", "")
            return m.group(6) + " = (" + args + ") =>"
    m = RE_CONST.match(line)
    if m:
        return m.group(1) + " = {...}"
    return ""


def main() -> None:
    files = sorted(SRC.glob("*.js"))
    lines_out = ["# 孤高旅斗 · 代码分区地图", "",
                 "> 由 `python scripts/codemap.py` 自动生成，行号对应 src/js/ 内各文件。",
                 "> 改动前先看「模块职责」和「功能索引」定位文件，再按行号跳。",
                 ""]
    keyword_hits = {k: [] for k in KEYWORDS}

    for path in files:
        rel = path.name
        text = path.read_text(encoding="utf-8")
        entries = []
        for i, line in enumerate(text.splitlines(), 1):
            b = RE_BANNER.match(line)
            if b:
                entries.append((i, "§ " + b.group(1).strip()))
                continue
            s = short_sig(line)
            if s:
                entries.append((i, s))
            for k in keyword_hits:
                if k in line:
                    keyword_hits[k].append(f"{rel}:{i}")

        lines_out.append("## " + rel + " — " + FILE_DESC.get(rel, "(未写职责描述)"))
        lines_out.append("")
        if not entries:
            lines_out.append("_(未识别到函数)_")
        for i, s in entries:
            lines_out.append(f"- L{i}  {s}")
        lines_out.append("")

    lines_out.append("## 功能索引（关键词 → 位置，取前 12 处）")
    lines_out.append("")
    for k in KEYWORDS:
        hits = keyword_hits[k]
        if not hits:
            continue
        lines_out.append(f"- **{k.strip()}** ({len(hits)}): " + ", ".join(hits[:12]) + (" ..." if len(hits) > 12 else ""))
    lines_out.append("")

    doc = "\n".join(lines_out)
    if "--stdout" in sys.argv:
        print(doc)
    else:
        OUT.parent.mkdir(exist_ok=True)
        OUT.write_text(doc, encoding="utf-8")
        print(f"OK -> {OUT}  ({len(files)} 个模块, {doc.count(chr(10))} 行)")


if __name__ == "__main__":
    main()
