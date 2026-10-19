# -*- coding: utf-8 -*-
"""奶蛙套装贴图处理：去背 → 裁剪 → 头部放大羽化 → 按「颈面锚点」切三件。

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
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "assets", "skins", "naiwa")
SRC = os.path.join(SRC_DIR, "raw_full.png")
OUT_DIR = os.path.join(SRC_DIR, "parts")
os.makedirs(OUT_DIR, exist_ok=True)

K = 3                        # 3x 贴图，游戏内按 1/3 绘制
TOTAL_H = 71                 # 游戏像素：头顶 -71 → 脚底 0
NECK_GAME_Y = -40            # 统一颈面（锚点）
HIP_GAME_Y = -17             # 胯线目标：游戏几何的腿顶线（保证老式裤装在 -17 以下能露出来）
NECK_FRAC = 0.20             # 源图里头部/肩身分界（目视网格定位）
K_HEAD = 1.45                # 头部放大倍率（Q 版大头）

im = Image.open(SRC).convert("RGBA")
W, H = im.size
print("源图:", W, "x", H)

# ---- 1. 去背：从边缘 floodfill，把连成片的近白背景变透明 ----
ff = im.copy()
for seed in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1), (W // 2, 0), (W // 2, H - 1)]:
    ImageDraw.floodfill(ff, seed, (0, 0, 0, 0), thresh=38)
px = ff.load()
n = sum(1 for y in range(H) for x in range(W) if px[x, y][3] == 0)
print("去背像素占比 %.1f%%" % (100.0 * n / (W * H)))

# ---- 2. 裁剪到主体包围盒 ----
body = ff.crop(ff.getbbox())
bw, bh = body.size
print("主体:", bw, "x", bh, " 宽高比 %.2f" % (bw / bh))

# ---- 3. 按目视网格切：头 / 身（胯线由「游戏腿顶线 -17」反解，保证混搭时裤子露出来） ----
neck_y = int(bh * NECK_FRAC)
fh0 = int(neck_y * K_HEAD)
overlap0 = max(6, int(fh0 * 0.10))
s0 = (TOTAL_H * K) / float(fh0 - overlap0 + bh - neck_y)          # 拼合后总高固定，与胯线无关
hip_y = int(round(neck_y + (HIP_GAME_Y + TOTAL_H) * K / s0 - (fh0 - overlap0)))
head_part = body.crop((0, 0, bw, neck_y))
torso_part = body.crop((0, neck_y, bw, hip_y))
legs_part = body.crop((0, hip_y, bw, bh))
print("切点：颈 %d 行 / 胯 %d 行（%.0f%%，头 %d / 身 %d / 脚 %d）" %
      (neck_y, hip_y, 100.0 * hip_y / bh, neck_y, hip_y - neck_y, bh - hip_y))

# ---- 4. 头部放大 + 底缘羽化（羽化段会叠在脖子上融合，消除 1.45x 的宽度台阶） ----
head_big = head_part.resize((int(bw * K_HEAD), int(neck_y * K_HEAD)), Image.LANCZOS)
fw, fh = head_big.size
hp = head_big.load()
fade_rows = max(6, int(fh * 0.10))
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
print("大头全身:", mw, "x", mh, " 头占高 %.0f%%" % (100.0 * fh / mh))

scale = (TOTAL_H * K) / float(mh)
target_w = int(round(mw * scale))
full = merged.resize((target_w, TOTAL_H * K), Image.LANCZOS)     # 3x 全身，行 r ↔ 游戏 y = -71 + r/3
print("缩放 x%.3f → %d x %d（3x），游戏内宽 %.1f" % (scale, target_w, TOTAL_H * K, target_w / K))
full.save(os.path.join(SRC_DIR, "preview_full.png"))

def game_row(y):
    return int(round((y + TOTAL_H) * K))

# 关键行（在 3x 全身图坐标里）
row_neck = game_row(NECK_GAME_Y)                      # 颈面：93
row_hip = int(round((fh - overlap + (hip_y - neck_y)) * scale))  # 胯线（源图切点换算过来）
y_hip = -TOTAL_H + row_hip / float(K)
print("颈面行 %d（y=%d）｜胯线行 %d（y=%.1f）" % (row_neck, NECK_GAME_Y, row_hip, y_hip))

# ---- 6. 切三件：x 方向保留全身宽度（保证中轴一致），只在 y 方向裁 ----
def save_part(name, y_from, y_to):
    a, b = game_row(y_from), game_row(y_to)
    part = full.crop((0, max(0, a), target_w, min(TOTAL_H * K, b)))
    part.save(os.path.join(OUT_DIR, name))
    print("  %-16s %dx%d  游戏 y %.1f..%.1f  宽 %.1f" %
          (name, part.width, part.height, y_from, y_to, part.width / K))
    return part

head_png = save_part("naiwa_head.png", -TOTAL_H, NECK_GAME_Y + 2)   # 底边多做 2px，压住上衣顶边
upper_png = save_part("naiwa_upper.png", NECK_GAME_Y, y_hip)
lower_png = save_part("naiwa_lower.png", y_hip, 0)

# ---- 7. 合成校验图：按「颈面锚点」叠加，应与 preview_full 完全一致 ----
pad = 24
check = Image.new("RGBA", (target_w + pad * 2, TOTAL_H * K + pad * 2 + 40), (24, 30, 48, 255))
ox = pad
ground = pad + TOTAL_H * K          # 校验画布里游戏 y=0（脚底）所在行；y<0 在其上方
# 下身：底边中点 → (0,0)
check.paste(lower_png, (ox, ground - lower_png.height), lower_png)
# 上身：顶边中点 → (0,-40)
check.paste(upper_png, (ox, ground + NECK_GAME_Y * K), upper_png)
# 头部：底边中点 → (0,-40)
check.paste(head_png, (ox, ground + NECK_GAME_Y * K - head_png.height), head_png)
check.save(os.path.join(SRC_DIR, "check_assemble.png"))
print("校验图 check_assemble.png / 预览 preview_full.png 已输出")
