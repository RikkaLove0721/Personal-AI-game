# -*- coding: utf-8 -*-
"""抠图探路：跑一次 u2netp，输出人物包围盒 + 带 UV 网格的预览，用来标定各部位蒙版。

产物（都进 temp/）：
    cut.png        1920 宽的 RGBA 人物
    grid.png       叠了 0.05 UV 网格的预览
    mask.png       纯 alpha
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "art", "menu-bg-src.jpg")
TMP = os.path.join(ROOT, "temp")


def main():
    from rembg import remove, new_session
    s = new_session("u2netp")
    im = Image.open(SRC).convert("RGB")
    out = remove(im, session=s, alpha_matting=False)
    out.save(os.path.join(TMP, "cut.png"))

    a = np.array(out)[:, :, 3]
    H, W = a.shape
    ys, xs = np.where(a > 40)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    print("bbox px  %d..%d  %d..%d" % (x0, x1, y0, y1))
    print("bbox UV  u %.4f..%.4f  v %.4f..%.4f" % (x0 / W, x1 / W, y0 / H, y1 / H))

    # 网格预览：铺在深绿底上，每 0.05 一条线
    prev = Image.new("RGB", out.size, (0, 110, 58))
    prev.paste(out, (0, 0), out)
    d = ImageDraw.Draw(prev)
    f = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 18)
    for k in range(0, 21):
        u = k * 0.05
        x = u * W - 0.5
        d.line([(x, 0), (x, H)], fill=(255, 40, 40), width=1)
        if k % 2 == 0:
            d.text((x + 2, 2), "%.2f" % u, fill=(255, 255, 0), font=f)
    for k in range(0, 21):
        v = k * 0.05
        y = v * H - 0.5
        d.line([(0, y), (W, y)], fill=(40, 170, 255), width=1)
        if k % 2 == 0:
            d.text((2, y + 1), "%.2f" % v, fill=(0, 255, 255), font=f)
    prev.save(os.path.join(TMP, "grid.png"))
    print("已输出 temp/grid.png")


if __name__ == "__main__":
    sys.exit(main())
