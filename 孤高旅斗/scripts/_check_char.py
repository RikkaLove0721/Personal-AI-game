# -*- coding: utf-8 -*-
"""把 assets/char 的分层按 meta.order 重拼一遍，和原图逐像素比对。

这是「静止姿势必须等于原图」这条硬约束的守门人：
只要合成结果和原图有肉眼可见差异，就说明分层 / 归属 / 顺序出了问题 ——
不用去调动画参数，动画再慢也救不回一张拼错的图。

用法：
    python scripts/_check_char.py            只报数字
    python scripts/_check_char.py 0.06 0.09 0.36 0.62    额外导出一块并排对照
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "char")
TEMP = os.path.join(ROOT, "temp")

CW, CH = 1600, 1000          # 渲染画布（与 86_live2d.js 的 CFG.w/h 一致）
FOCUS_X, FOCUS_Y = 0.19, 0.5


def main():
    meta = json.load(open(os.path.join(OUT, "meta.json"), encoding="utf-8"))
    fw, fh = meta["frame"]
    s = max(CW / float(fw), CH / float(fh))
    w, h = fw * s, fh * s
    ox, oy = -(w - CW) * FOCUS_X, -(h - CH) * FOCUS_Y

    def rect(uv):
        return (ox + uv[0] * w, oy + uv[1] * h,
                (uv[2] - uv[0]) * w, (uv[3] - uv[1]) * h)

    # 原图按同一套 cover 铺一遍，作为基准
    frame = Image.open(os.path.join(OUT, "frame.jpg"))
    ref = Image.new("RGB", (CW, CH), (0, 0, 0))
    ref.paste(frame.resize((round(w), round(h)), Image.LANCZOS), (round(ox), round(oy)))

    # 分层重拼
    comp = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    stage = {}
    order = meta.get("order") or ["body", "skirt", "sword", "armA", "armB", "hair"]
    bg = Image.open(os.path.join(OUT, "bg.jpg")).convert("RGBA")
    r0 = rect([0, 0, 1, 1])
    comp.alpha_composite(bg.resize((max(1, round(r0[2])), max(1, round(r0[3]))), Image.LANCZOS),
                         (round(r0[0]), round(r0[1])))
    stage["bg"] = comp.convert("RGB").copy()
    for name in order:
        info = meta["layers"].get(name)
        if not info:
            continue
        im = Image.open(os.path.join(OUT, info["file"])).convert("RGBA")
        r = rect(info["uv"])
        im = im.resize((max(1, round(r[2])), max(1, round(r[3]))), Image.LANCZOS)
        comp.alpha_composite(im, (round(r[0]), round(r[1])))
        stage[name] = comp.convert("RGB").copy()

    rec = comp.convert("RGB")
    a = np.asarray(ref).astype(np.float32)
    b = np.asarray(rec).astype(np.float32)
    d = np.abs(a - b).max(2)
    print("平均差 %.2f  中位 %.2f  p99 %.0f  >30 %.2f%%  >60 %.2f%%"
          % (d.mean(), np.median(d), np.percentile(d, 99),
             (d > 30).mean() * 100, (d > 60).mean() * 100))

    if len(sys.argv) >= 5:
        x0, y0, x1, y1 = [float(v) for v in sys.argv[1:5]]
        box = (int(CW * x0), int(CH * y0), int(CW * x1), int(CH * y1))
        A, B = ref.crop(box), rec.crop(box)
        cw, chh = A.size
        side = Image.new("RGB", (cw * 2 + 6, chh), (255, 0, 0))
        side.paste(A, (0, 0))
        side.paste(B, (cw + 6, 0))
        p = os.path.join(TEMP, "cmp_char.png")
        side.save(p)
        print("对照图 " + p)

    # 差异热力图 + 逐层落点，方便一眼看出是哪一层带进来的
    hm = np.zeros((CH, CW, 3), np.uint8)
    hm[..., 0] = np.clip(d * 3, 0, 255)
    hm[..., 1] = np.clip(255 - d * 3, 0, 255)
    Image.fromarray(hm).save(os.path.join(TEMP, "diff_char.png"))
    last = stage.get(order[-1]) or stage["bg"]
    last.save(os.path.join(TEMP, "recomp_char.png"))
    print("热力图 temp/diff_char.png  重拼 temp/recomp_char.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
