# -*- coding: utf-8 -*-
"""
孤高旅斗 · 图标与主菜单立绘处理
--------------------------------------------------------------
源图（人工替换后重跑本脚本即可）：
    assets/art/icon-src.jpg      角色头像（正方形，白底圆形构图）
    assets/art/menu-bg-src.jpg   主菜单立绘（横图，左中为角色，右侧为云海与山谷）

产物：
    assets/icon.png       512 圆形透明（关于框 / 文档用）
    assets/icon-sm.png    128 圆形透明（主菜单徽章 + 网页 favicon）
    assets/icon.ico       16/24/32/48/64/128/256 多尺寸（exe 图标）
    assets/menu-bg.jpg    3840 宽 4K（单文件内嵌用；两段 LANCZOS + 轻锐化上采样）

用法：
    python scripts/proc_art.py          # 源图更新过才重新生成
    python scripts/proc_art.py --force  # 强制重新生成
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "assets", "art")
OUT = os.path.join(ROOT, "assets")

# 头像取景：以脸为中心裁一个正方形（比例写死，换图时不用改代码）
ICON_FOCUS = (0.4583, 0.4583)   # 圆心（占原图宽/高的比例）
ICON_ZOOM = 0.75                # 正方形边长 / 原图短边
ICON_SIZES = (16, 24, 32, 48, 64, 128, 256)

MENU_W = 3840                   # 主菜单立绘输出宽度（4K）
MENU_Q = 86                     # 4K 下 86 已经看不出块，再高只是白送体积
MENU_STEP = 1.45                # 分两段放大：一次放到 4K 会糊，两段接得上细节


def upscale(im, target_w):
    """两段 LANCZOS 放大 + 每段后轻锐化。

    直接 1920 -> 3840 一次性 LANCZOS，线条会发软（尤其是发丝和远山轮廓）；
    拆成两段、中间补一次 UnsharpMask，边缘能挺起来又不至于出白边。
    """
    w0 = im.width
    if w0 >= target_w:
        return im
    ratio = im.height / float(w0)          # 先记住长宽比，两段放大都用它，不能中途重新算
    mid = int(round(w0 * min(2.0, (float(target_w) / w0) ** 0.5)))
    if mid > w0:
        im = im.resize((mid, int(round(mid * ratio))), Image.LANCZOS)
        im = im.filter(ImageFilter.UnsharpMask(radius=1.1, percent=32, threshold=2))
    im = im.resize((target_w, int(round(target_w * ratio))), Image.LANCZOS)
    return im.filter(ImageFilter.UnsharpMask(radius=1.7, percent=44, threshold=3))


def newer(src, dst):
    return os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src)


def circle(img, size, feather=1.6, rim=True):
    """正方形图 -> 圆形 RGBA（超采样后缩小，边缘不出锯齿）"""
    ss = 4
    big = img.resize((size * ss, size * ss), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * ss - 1, size * ss - 1), fill=255)
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather * ss / 2))
    big.putalpha(mask)
    big = big.resize((size, size), Image.LANCZOS)
    if rim:
        # 极淡的一圈内描边：深色底上不至于糊成一团，浅色底上也不会消失
        ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse((0, 0, size - 1, size - 1),
                                     outline=(255, 255, 255, 46), width=max(1, size // 180))
        big = Image.alpha_composite(big, ring)
    return big


def do_icon(force):
    src = os.path.join(ART, "icon-src.jpg")
    dst_png = os.path.join(OUT, "icon.png")
    dst_sm = os.path.join(OUT, "icon-sm.png")
    dst_ico = os.path.join(OUT, "icon.ico")
    if not os.path.exists(src):
        print("  ! 缺少 %s，跳过图标" % src)
        return
    if not force and all(newer(src, p) for p in (dst_png, dst_sm, dst_ico)):
        print("  图标  已是最新")
        return
    im = Image.open(src).convert("RGB")
    w, h = im.size
    side = int(min(w, h) * ICON_ZOOM)
    cx, cy = int(w * ICON_FOCUS[0]), int(h * ICON_FOCUS[1])
    box = (max(0, cx - side // 2), max(0, cy - side // 2),
           min(w, cx + side // 2), min(h, cy + side // 2))
    crop = im.crop(box)
    master = circle(crop, 512)
    master.save(dst_png, optimize=True)
    circle(crop, 128).save(dst_sm, optimize=True)
    # ico：PIL 会为每个尺寸单独缩放（16/24/32 用最近邻更好认，这里统一 LANCZOS）
    master.save(dst_ico, sizes=[(s, s) for s in ICON_SIZES])
    print("  图标  icon.png %.0f KB / icon-sm.png %.0f KB / icon.ico %.0f KB"
          % (os.path.getsize(dst_png) / 1024.0, os.path.getsize(dst_sm) / 1024.0,
             os.path.getsize(dst_ico) / 1024.0))


def do_menu(force):
    """输出两张：
        assets/char/frame.jpg  4K 母版（proc_char.py 抠图 / 切层用）
        assets/menu-bg.jpg     1440 合成图（只给 CSS 里的其它覆盖层当背景，别内嵌大图）
    人物已经从背景里摘出来了，主菜单画布用的是分层素材，这里的两张都不参与动画。
    """
    src = os.path.join(ART, "menu-bg-src.jpg")
    dst = os.path.join(OUT, "menu-bg.jpg")
    master = os.path.join(OUT, "char", "frame.jpg")
    if not os.path.exists(src):
        print("  ! 缺少 %s，跳过主菜单立绘" % src)
        return
    if not force and newer(src, dst) and newer(src, master):
        print("  立绘  已是最新")
        return
    im = Image.open(src).convert("RGB")
    im = upscale(im, MENU_W)
    os.makedirs(os.path.dirname(master), exist_ok=True)
    im.save(master, quality=MENU_Q, optimize=True, progressive=True)
    print("  立绘母版 char/frame.jpg %dx%d %.0f KB"
          % (im.width, im.height, os.path.getsize(master) / 1024.0))
    small = im.resize((1440, int(round(im.height * 1440.0 / im.width))), Image.LANCZOS)
    small.save(dst, quality=80, optimize=True, progressive=True)
    print("  立绘CSS  menu-bg.jpg %dx%d %.0f KB"
          % (small.width, small.height, os.path.getsize(dst) / 1024.0))


def main():
    force = "--force" in sys.argv[1:]
    print("孤高旅斗 · 美术资源处理")
    do_icon(force)
    do_menu(force)


if __name__ == "__main__":
    main()
