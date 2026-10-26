# -*- coding: utf-8 -*-
"""在立绘上叠 UV 网格，用来肉眼读坐标（调 PART_DEF 时用）。

输出 temp/grid_<name>.png：
  左半 = 干净网格图，右半 = 网格 + 当前蒙版叠加，
  方便一边读坐标一边核对覆盖。
"""
import importlib
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import proc_char as pc  # noqa: E402
importlib.reload(pc)

FRAME = os.path.join(ROOT, "assets", "char", "frame.jpg")
COL = {"hair": (255, 52, 52), "skirt": (40, 140, 255),
       "armA": (40, 255, 120), "armB": (255, 220, 40)}


def grid(img, cw, ch, step=0.02, major=0.1):
    d = ImageDraw.Draw(img, "RGBA")
    n = int(1 / step)
    for i in range(n + 1):
        u = i * step
        x = u * cw
        m = abs(u / major - round(u / major)) < 1e-6
        d.line([(x, 0), (x, ch)], fill=(255, 255, 255, 150 if m else 70), width=2 if m else 1)
        if m:
            d.text((x + 3, 2), "%.2f" % u, fill=(255, 255, 0, 255))
    for i in range(n + 1):
        v = i * step
        y = v * ch
        m = abs(v / major - round(v / major)) < 1e-6
        d.line([(0, y), (cw, y)], fill=(255, 255, 255, 150 if m else 70), width=2 if m else 1)
        if m:
            d.text((3, y + 1), "%.2f" % v, fill=(255, 255, 0, 255))
    return img


def mask_of(name, W, H):
    dfn = pc.PART_DEF[name]
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    if "poly" in dfn:
        d.polygon([(u * W, v * H) for (u, v) in dfn["poly"]], fill=255)
    if "ell" in dfn:
        for (u, v, rx, ry) in dfn["ell"]:
            d.ellipse([(u - rx) * W, (v - ry) * H, (u + rx) * W, (v + ry) * H], fill=255)
    return m


def run(name, u0, v0, u1, v1, out_w=760, who=("hair", "armA", "armB")):
    base = Image.open(FRAME).convert("RGB")
    W, H = base.size
    cw, ch = int(u1 * W) - int(u0 * W), int(v1 * H) - int(v0 * H)
    box = (int(u0 * W), int(v0 * H), int(u1 * W), int(v1 * H))
    cw2 = out_w
    ch2 = int(round(ch * out_w / float(cw)))
    # 先在整帧尺度上算蒙版，再和裁剪图一起缩放，保证坐标不走样
    tint = Image.new("RGB", (cw, ch), (0, 0, 0))
    alpha = np.zeros((ch, cw), np.uint8)
    for n in who:
        m = mask_of(n, W, H).crop(box)
        tint = Image.composite(Image.new("RGB", (cw, ch), COL[n]), tint, m)
        alpha = np.maximum(alpha, (np.array(m) * 0.34).astype(np.uint8))
    alpha = Image.fromarray(alpha)
    over = Image.composite(tint, base.crop(box), alpha)

    left = base.crop(box).resize((cw2, ch2), Image.LANCZOS)
    right = over.resize((cw2, ch2), Image.LANCZOS)
    # 网格按裁剪窗口的 UV 比例画
    grid(left, cw2, ch2)
    grid(right, cw2, ch2)
    canvas = Image.new("RGB", (cw2 * 2 + 8, ch2), (20, 20, 20))
    canvas.paste(left, (0, 0))
    canvas.paste(right, (cw2 + 8, 0))
    canvas.save(os.path.join(ROOT, "temp", "grid_%s.png" % name), quality=90)
    print("wrote temp/grid_%s.png %s (u %.2f..%.2f  v %.2f..%.2f)" % (name, canvas.size, u0, u1, v0, v1))


if __name__ == "__main__":
    run("torso", 0.09, 0.04, 0.47, 0.62, 700)
