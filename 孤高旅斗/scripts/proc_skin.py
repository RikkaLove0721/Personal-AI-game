# -*- coding: utf-8 -*-
"""通用新皮肤贴图处理：去背 → 裁剪 → （可选）头部放大羽化 → 按「颈面锚点」切三件。

用法：
  python scripts/proc_skin.py <key> [--grid]     # key = assets/skins/<key>/ 下的角色
角色参数在下方 PARAMS 里维护；素材要求 assets/skins/<key>/raw_full.png（纯白/纯色背景全身立绘）。

============================ 新皮肤统一规格 v2 ============================
自由体型版：只统一「头 / 脖子的连接处」，胖瘦、翅膀、外饰都不受限制。

  统一基准：颈面 = 游戏 y -40（与角色几何的躯干顶 -41 对齐）｜中轴 x = 0
  头部贴图：底边中点锚在 (0, -40)   —— 底边就是脖子断面（可向上自由长角/头发）
  上身贴图：顶边中点锚在 (0, -40)   —— 向下 / 左右自由，建议至少盖到 y=-14 接住裤子
  下身贴图：底边中点锚在 (0, 0)     —— 脚踩地，向上自由（长裤 / 裙 / 绑腿）
  画布尺寸不固定；绘制顺序 下身 → 上身 → 头部，头部最后画，
  底边自然压住上衣顶端 2px，这条接缝就是唯一的混搭约定。

  （对照游戏几何：躯干 -41..-17、腿 17 高、脚底 0；总高 71）
============================================================================
"""
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---- 每个角色的切图参数（neck/khead 用 --grid 网格图目视校准） ----
# neck: 颈线在主体包围盒里的高度占比（0=头顶 1=脚底）
# khead: 头部放大倍率（源图本身已是 Q 版大头就填 1.0）
# fade: 头部底缘羽化占头高的比例
PARAMS = {
    "naiwa":  {"neck": 0.20, "khead": 1.45, "fade": 0.10, "thresh": 38},
    "gojo":   {"neck": 0.45, "khead": 1.00, "fade": 0.08, "thresh": 20, "pocket": False},
    "doubao": {"neck": 0.47, "khead": 1.00, "fade": 0.08, "thresh": 38},
    "kobe":   {"neck": 0.32, "khead": 1.00, "fade": 0.08, "thresh": 38},
    "kunkun": {"neck": 0.45, "khead": 1.00, "fade": 0.08, "thresh": 12, "pocket": False},
    "daishu": {"neck": 0.42, "khead": 1.00, "fade": 0.08, "thresh": 62, "hardband": 0.13},
    "gaosongdeng": {"neck": 0.44, "khead": 1.00, "fade": 0.03, "thresh": 30,
                    "src": "raw_matte.png", "alpha": True, "pocket": False},
    "gaoya": {"neck": 0.40, "khead": 1.00, "fade": 0.04, "thresh": 16,
              "src": "raw_matte.png", "alpha": True, "pocket": False},
    # 胖猫：云抠图出的透明底，先合成到纯白再走统一流程（src 指向预处理的图）
    "pangmao": {"neck": 0.52, "khead": 1.00, "fade": 0.03, "thresh": 30,
                "src": "raw_matte.png", "alpha": True, "pocket": False},
}

K = 3                        # 3x 贴图，游戏内按 1/3 绘制
TOTAL_H = 71                 # 游戏像素：头顶 -71 → 脚底 0
NECK_GAME_Y = -40            # 统一颈面（锚点）
HIP_GAME_Y = -17             # 胯线目标：游戏几何的腿顶线（保证老式裤装在 -17 以下能露出来）


def process(key, grid_only=False):
    p = PARAMS[key]
    src_dir = os.path.join(ROOT, "assets", "skins", key)
    out_dir = os.path.join(src_dir, "parts")
    os.makedirs(out_dir, exist_ok=True)
    im = Image.open(os.path.join(src_dir, p.get("src", "raw_full.png"))).convert("RGBA")
    W, H = im.size
    print("[%s] 源图: %d x %d" % (key, W, H))

    # ---- 1. 去背：从边缘 floodfill，把连成片的近白背景变透明 ----
    #      alpha:true 表示源图已经是抠好的透明底（云端抠图产物），直接跳过颜色去背，
    #      否则白色爪子/浅色主体会被当成背景吃掉
    ff = im.copy()
    if not p.get("alpha"):
        for seed in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1), (W // 2, 0), (W // 2, H - 1)]:
            ImageDraw.floodfill(ff, seed, (0, 0, 0, 0), thresh=p["thresh"])
    else:
        print("  源图已带 alpha，跳过去背")
    px = ff.load()
    n = sum(1 for y in range(H) for x in range(W) if px[x, y][3] == 0)
    print("  透明像素占比 %.1f%%" % (100.0 * n / (W * H)))

    # ---- 1b. 二次去背：被主体围住的近白口袋（如两脚夹住的地面残影），
    #      从「紧邻透明区的近白像素」再 floodfill 向内吃，直到收敛。
    #      注意：会沿平滑渐变逐像素爬进浅色主体（白发/浅肤），白发角色须设 pocket:false ----
    WHITE_MIN = 190
    for _ in range(8 if p.get("pocket", True) else 0):
        px = ff.load()
        seeds = []
        for y in range(H):
            for x in range(W):
                c = px[x, y]
                if c[3] == 0 or min(c[:3]) < WHITE_MIN:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H and px[nx, ny][3] == 0:
                        seeds.append((x, y))
                        break
        if not seeds:
            break
        for s in seeds:
            ImageDraw.floodfill(ff, s, (0, 0, 0, 0), thresh=p["thresh"])

    # ---- 1c. 透明洞回填：白发高光被 floodfill 误吃的洞。
    #      先对不透明掩码做形态学闭运算封住 1-2px 细缝，从图像边缘标定真实外背景，
    #      其余 alpha=0 连通块视为「洞」；边界像素平均亮度高（银白发/浅肤）的洞回填白色，
    #      深色描边围成的真实背景洞（腋下/腿间）不回填 ----
    if not p.get("alpha"):      # 云端抠好的透明底：内部空洞本来就是背景，不能回填
        from PIL import ImageFilter
        mask = ff.split()[3].point(lambda a: 255 if a > 0 else 0)
        closed = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
        cp = closed.load()
        px = ff.load()
        is_bg = [[False] * W for _ in range(H)]
        stack = []
        for x in range(W):
            for y in (0, H - 1):
                if cp[x, y] == 0 and not is_bg[y][x]:
                    is_bg[y][x] = True
                    stack.append((x, y))
        for y in range(H):
            for x in (0, W - 1):
                if cp[x, y] == 0 and not is_bg[y][x]:
                    is_bg[y][x] = True
                    stack.append((x, y))
        while stack:
            x, y = stack.pop()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and not is_bg[ny][nx] and cp[nx, ny] == 0:
                    is_bg[ny][nx] = True
                    stack.append((nx, ny))
        seen = [[False] * W for _ in range(H)]
        n_fill = 0
        for sy in range(H):
            for sx in range(W):
                if seen[sy][sx] or is_bg[sy][sx] or px[sx, sy][3] != 0:
                    continue
                comp = []
                stack = [(sx, sy)]
                seen[sy][sx] = True
                while stack:
                    x, y = stack.pop()
                    comp.append((x, y))
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx] and not is_bg[ny][nx] and px[nx, ny][3] == 0:
                            seen[ny][nx] = True
                            stack.append((nx, ny))
                mins = []
                for x, y in comp:
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < W and 0 <= ny < H and px[nx, ny][3] != 0:
                            mins.append(min(px[nx, ny][:3]))
                if mins and sum(mins) / len(mins) > 170:
                    for x, y in comp:
                        px[x, y] = (255, 255, 255, 255)
                    n_fill += len(comp)
        print("  洞回填 %d 像素" % n_fill)

    # ---- 1d. 手动擦除矩形（源图坐标）：用来干掉水印、平台角标等残留 ----
    for r in p.get("erase", []):
        ImageDraw.Draw(ff).rectangle([r[0], r[1], r[2], r[3]], fill=(0, 0, 0, 0))
    if p.get("erase"):
        print("  手动擦除 %d 处" % len(p["erase"]))

    # ---- 2. 裁剪到主体包围盒 ----
    body = ff.crop(ff.getbbox())
    bw, bh = body.size
    print("  主体: %d x %d  宽高比 %.2f" % (bw, bh, bw / bh))

    # ---- 2b. 底部白带硬清除（hardband 参数，如地面残影）：
    #      只清最底部一条带内的低饱和像素；彩色主体（黄脚掌 min 通道 <50）不受影响 ----
    hb = p.get("hardband", 0)
    if hb > 0:
        bp = body.load()
        y0 = int(bh * (1 - hb))
        for y in range(y0, bh):
            for x in range(bw):
                c = bp[x, y]
                if c[3] == 0:
                    continue
                lo, hi = min(c[:3]), max(c[:3])
                if lo >= 90 and (hi - lo) <= 90:
                    bp[x, y] = (0, 0, 0, 0)
        body = body.crop(body.getbbox())
        bw, bh = body.size
        print("  底部白带清除后主体: %d x %d" % (bw, bh))

    neck_frac = p["neck"]
    if grid_only:
        dbg = body.convert("RGB").resize((bw // 2, bh // 2))
        d = ImageDraw.Draw(dbg)
        for pct in range(0, 100, 2):
            y = int(bh / 2 * pct / 100)
            c = (255, 0, 0) if pct % 10 == 0 else (0, 160, 255)
            d.line([(0, y), (bw // 2, y)], fill=c, width=1)
            if pct % 10 == 0:
                d.text((4, y + 2), str(pct) + "%", fill=(255, 255, 0))
        dbg.save(os.path.join(src_dir, "dbg_grid.png"))
        print("  网格调试图 -> dbg_grid.png")
        return

    # ---- 3. 按目视网格切：头 / 身（胯线由「游戏腿顶线 -17」反解，保证混搭时裤子露出来） ----
    neck_y = int(bh * neck_frac)
    khead = p["khead"]
    fh0 = int(neck_y * khead)
    overlap0 = max(6, int(fh0 * p["fade"]))
    s0 = (TOTAL_H * K) / float(fh0 - overlap0 + bh - neck_y)          # 拼合后总高固定，与胯线无关
    hip_y = int(round(neck_y + (HIP_GAME_Y + TOTAL_H) * K / s0 - (fh0 - overlap0)))
    head_part = body.crop((0, 0, bw, neck_y))
    torso_part = body.crop((0, neck_y, bw, hip_y))
    legs_part = body.crop((0, hip_y, bw, bh))
    print("  切点：颈 %d 行 / 胯 %d 行（%.0f%%，头 %d / 身 %d / 脚 %d）" %
          (neck_y, hip_y, 100.0 * hip_y / bh, neck_y, hip_y - neck_y, bh - hip_y))

    # ---- 4. 头部放大 + 底缘羽化（羽化段会叠在脖子上融合，消除放大/原尺寸的宽度台阶） ----
    head_big = head_part.resize((int(bw * khead), int(neck_y * khead)), Image.LANCZOS)
    fw, fh = head_big.size
    hp = head_big.load()
    fade_rows = max(6, int(fh * p["fade"]))
    for y in range(fh - fade_rows, fh):
        k = (y - (fh - fade_rows)) / float(fade_rows)
        for x in range(fw):
            r, g, b, a = hp[x, y]
            hp[x, y] = (r, g, b, int(a * (1.0 - 0.9 * k)))

    # ---- 5. 大头全身拼合（头部羽化段与身体重叠）→ 整体缩放到总高 71（3x = 213 行） ----
    overlap = fade_rows
    merge_w = max(fw, bw)
    merged = Image.new("RGBA", (merge_w, fh - overlap + (bh - neck_y)), (0, 0, 0, 0))
    merged.paste(head_big, ((merge_w - fw) // 2, 0), head_big)
    merged.paste(torso_part, ((merge_w - bw) // 2, fh - overlap), torso_part)
    merged.paste(legs_part, ((merge_w - bw) // 2, fh - overlap + (hip_y - neck_y)), legs_part)
    merged = merged.crop(merged.getbbox())
    mw, mh = merged.size
    print("  拼合全身: %d x %d  头占高 %.0f%%" % (mw, mh, 100.0 * fh / mh))

    scale = (TOTAL_H * K) / float(mh)
    target_w = int(round(mw * scale))
    full = merged.resize((target_w, TOTAL_H * K), Image.LANCZOS)     # 3x 全身，行 r ↔ 游戏 y = -71 + r/3
    print("  缩放 x%.3f → %d x %d（3x），游戏内宽 %.1f" % (scale, target_w, TOTAL_H * K, target_w / K))
    full.save(os.path.join(src_dir, "preview_full.png"))

    def game_row(y):
        return int(round((y + TOTAL_H) * K))

    row_neck = game_row(NECK_GAME_Y)
    row_hip = int(round((fh - overlap + (hip_y - neck_y)) * scale))  # 胯线（源图切点换算过来）
    y_hip = -TOTAL_H + row_hip / float(K)
    print("  颈面行 %d（y=%d）｜胯线行 %d（y=%.1f）" % (row_neck, NECK_GAME_Y, row_hip, y_hip))

    # ---- 6. 切三件：x 方向保留全身宽度（保证中轴一致），只在 y 方向裁 ----
    def save_part(name, y_from, y_to):
        a, b = game_row(y_from), game_row(y_to)
        part = full.crop((0, max(0, a), target_w, min(TOTAL_H * K, b)))
        part.save(os.path.join(out_dir, name))
        print("    %-18s %dx%d  游戏 y %.1f..%.1f  宽 %.1f" %
              (name, part.width, part.height, y_from, y_to, part.width / K))
        return part

    head_png = save_part(key + "_head.png", -TOTAL_H, NECK_GAME_Y + 2)   # 底边多做 2px，压住上衣顶边
    upper_png = save_part(key + "_upper.png", NECK_GAME_Y, y_hip)
    lower_png = save_part(key + "_lower.png", y_hip, 0)

    # ---- 7. 合成校验图：按「颈面锚点」叠加，应与 preview_full 完全一致 ----
    pad = 24
    check = Image.new("RGBA", (target_w + pad * 2, TOTAL_H * K + pad * 2 + 40), (24, 30, 48, 255))
    ox = pad
    ground = pad + TOTAL_H * K          # 校验画布里游戏 y=0（脚底）所在行；y<0 在其上方
    check.paste(lower_png, (ox, ground - lower_png.height), lower_png)
    check.paste(upper_png, (ox, ground + NECK_GAME_Y * K), upper_png)
    check.paste(head_png, (ox, ground + NECK_GAME_Y * K - head_png.height), head_png)
    check.save(os.path.join(src_dir, "check_assemble.png"))
    print("  校验图 check_assemble.png / 预览 preview_full.png 已输出")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keys = args or list(PARAMS)
    for key in keys:
        if key not in PARAMS:
            raise SystemExit("未知角色: " + key + "（可选: " + ", ".join(PARAMS) + "）")
        process(key, grid_only="--grid" in sys.argv)
