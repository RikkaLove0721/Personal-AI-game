# -*- coding: utf-8 -*-
"""快速预览部位蒙版（不跑抠图，只画多边形/椭圆）。

用途：调 PART_DEF 坐标时，每改一次就能看见覆盖范围，不用等 45 秒的整套流程。
输出 temp/mask_prev.png：原图上叠 32% 色的半透明填充 + 亮边线。
"""
import importlib
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import proc_char as pc  # noqa: E402
importlib.reload(pc)

FRAME = os.path.join(ROOT, "assets", "char", "frame.jpg")
OUT = os.path.join(ROOT, "temp", "mask_prev.png")

PW = 1500
COL = {
    "hair": (255, 52, 52),
    "skirt": (40, 140, 255),
    "armA": (40, 255, 120),
    "armB": (255, 220, 40),
}
ORDER = ["armA", "armB", "hair", "skirt"]


def main():
    base = Image.open(FRAME).convert("RGB")
    ph = int(round(base.height * PW / float(base.width)))
    base = base.resize((PW, ph), Image.LANCZOS)

    acc = Image.new("RGB", (PW, ph), (0, 0, 0))
    alpha = Image.new("L", (PW, ph), 0)

    for name in ORDER:
        dfn = pc.PART_DEF[name]
        m = Image.new("L", (PW, ph), 0)
        d = ImageDraw.Draw(m)
        if "poly" in dfn:
            d.polygon([(u * PW, v * ph) for (u, v) in dfn["poly"]], fill=255)
        if "ell" in dfn:
            for (u, v, rx, ry) in dfn["ell"]:
                d.ellipse([(u - rx) * PW, (v - ry) * ph, (u + rx) * PW, (v + ry) * ph], fill=255)

        layer = Image.new("RGB", (PW, ph), COL[name])
        acc = Image.composite(layer, acc, m)
        alpha = Image.fromarray(np.maximum(np.array(alpha), (np.array(m) * 0.34).astype(np.uint8)))

        # 亮边线
        edge = m.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(3))
        edge = Image.fromarray((np.array(edge) * 1.0).clip(0, 255).astype(np.uint8))
        base = Image.composite(Image.new("RGB", (PW, ph), COL[name]), base, edge)

    out = Image.composite(acc, base, alpha)
    out.save(OUT, quality=88)
    print("wrote", OUT, out.size)


if __name__ == "__main__":
    main()
