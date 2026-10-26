# -*- coding: utf-8 -*-
"""把主菜单立绘拆成「背景 + 人物 + 部位图层」。

为什么要拆：早先的做法是在**整张合成图**上横切竖切做位移，结果连天空和山一起被拖歪。
正确做法是先把人物从背景里摘出来，再在人物内部按头发 / 裙摆 / 手臂分层 ——
每一层都是独立的 RGBA 位图，位移只作用在自己身上，背景完全静止。

产物（assets/char/）：
    bg.jpg        背景（人物已被周边像素填掉），WebP 转不了 JPEG，用高质量 JPEG
    body.webp     人物静态底（各部位已被「同一个人物」的周边像素填掉）
    hair.webp     长发（马尾那条）
    skirt.webp    黑色袴裙
    armA.webp     垂下的那只手臂
    armB.webp     握刀的那只手臂
    eye.webp      近眼（刚体层，会微扫视）
    lid.webp      闭眼皮肤（与 eye 同框；运行时沿眼皮下缘裁切着画）
    mouth.webp    嘴（刚体层，随呼吸开合）
    meta.json     每层在整帧 UV 空间的矩形，运行时按 UV 贴回画布

抠图用 rembg 的 u2netp（4.5MB，720p 输入 0.7 秒出结果）。
刀是模型漏掉的：用两条粗线把刀柄和刀身并进蒙版，否则刀会留在背景里被裙子盖住。
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import distance_transform_edt, gaussian_filter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "assets", "art")
SRC = os.path.join(ART, "menu-bg-src.jpg")     # 1920x1078 原始图（抠图用）
FRAME = os.path.join(ROOT, "assets", "char", "frame.jpg")  # 3840x2156 超分母版（取像素用）
OUT = os.path.join(ROOT, "assets", "char")

WORK_W = 3840            # 工作分辨率（与 FRAME 一致）
BG_W = 2560              # 背景输出宽度
BODY_W = 1300            # 人物底输出宽度（人物包围盒宽度）
# 说明：画布 1600 宽、整帧 cover 之后人物包围盒约 1140 画布像素，
# 所以这里必须 >= 1140 才是 1:1，否则人物层会被放大后渲染 —— 发丝立刻发虚。
# 1300 相当于 1.14 倍超采样，兼顾清晰度与体积。
PART_BONUS = 1.18        # 部位图比包围盒多留一点边，变形时不出白边
Q_BG = 84
Q_PART = 90

# 刀：模型漏检，手工补两条粗线。第三个数是**该段刀身的真实直径（UV 单位）**。
#
# 早先两段都按 13px 画，问题不只是「细」——刀身中心线还压在刀背那一侧：
# 沿法向扫描发现 alpha 只覆盖到 v≈0.737，而刀身的高光带在 v 0.738~0.770，
# 等于把整条发亮的刀刃留在了 alpha 外面，被当成背景填进了 bg，
# body 上只剩一条刀背细线 —— 看着就像「刀错位/断了」。
# 量法：沿刀身做法向截面，数「从刀背暗线到刀腹高光」的整段。
SWORD = [
    ((0.2460, 0.5480), (0.3980, 0.5700), 0.0143),   # 刀柄（缠绳那段），约 55px
    ((0.3980, 0.5900), (0.7020, 0.9080), 0.0078),   # 刀身（刀背到刀腹高光），约 30px
]

# 刀是**独立图层**，压着裙摆、又被右手挡住。
#
# 之前把刀留在 body 里、让裙子「扣掉」它，看起来对，其实有个死结：
# 裙子扣刀只能扣成一条固定形状的缝，裙子一摆，那条缝跟着裙子走，
# 露出来的却是 body 上静止的刀 —— 于是刀像是被切成了两段、还错开几个像素。
#
# 正解和 psd2live 的做法一样：谁在最上层谁独占像素。刀单独一层放在裙摆之上，
# 裙子在刀的位置**不挖洞**，而是把布料「补」进刀身那块（竖向延伸）。
# 于是裙子怎么摆，露出来的都是布料，不是天空 —— 不会出现一条亮缝。
# 刀层比真实刀身宽一圈：既要盖住辉光，也要盖住裙子在刀身底下那点位移，
# 否则刀身边缘会浮出一层先前位置的淡影。
SWORD_GROW = 1.15        # 刀层蒙版比真实刀身宽这么多（盖住辉光 + 裙子的位移量）
SWORD_SLIDE = 15         # 裙子在刀底下的最大位移（工作像素），决定补布料的带宽

# 部位蒙版（UV）。poly = 多边形顶点；ell = 椭圆集合 (u, v, rx, ry)
#
# hair 一定要「包住整条马尾 + 全部散开的细发丝」。
# 早先用 7 个椭圆贴着马尾主轴放，只盖住主干、漏掉向左侧飘开的细发丝；
# 更糟的是椭圆边界会把马尾**切掉一条**，被切掉的地方在 body 里被周边像素填掉，
# 一放大就是一团糊。现在改成一个宽松的大多边形：
#   边界落在天空/山体上（人物 alpha=0，蒙版再大也不会多出东西），
#   右边贴着躯干与手臂内侧收边，避免把胸口和胳膊一起带走。
PART_DEF = {
    "hair": {
        "poly": [
            (0.3300, 0.2100),   # 发根上缘（贴着头/发绳）
            (0.2900, 0.1900),
            (0.2250, 0.2000),   # 顶部发丝往左飘
            (0.1600, 0.2350),
            (0.1150, 0.2900),
            (0.1000, 0.3700),   # 最左侧发梢
            (0.1120, 0.4600),
            (0.1300, 0.5450),
            (0.1480, 0.6350),
            (0.1650, 0.7150),
            (0.1950, 0.7600),   # 马尾末梢
            (0.2350, 0.7350),
            (0.2500, 0.6400),
            (0.2480, 0.5400),
            (0.2620, 0.4450),
            (0.2900, 0.3600),
            (0.3130, 0.2820),
        ],
        # 羽化必须几乎为零。这里有个容易踩的坑：蒙版是「软」的，
        # 而 body 挖洞是**二值**的，两者权重不一致，蒙版边缘就会出现一圈
        # 半透明的天空混到头发里（发丝边上发灰）。
        # 硬边反而没有这个问题：边界落在天空上时，软边由人物 alpha 提供；
        # 边界落在身体上时，body 里原像素与图层像素刚好接上。
        "feather": 0.6,
    },
    "skirt": {
        "poly": [
            (0.3060, 0.4100), (0.3990, 0.4230), (0.4260, 0.5200),
            (0.4470, 0.7000), (0.4430, 0.8700), (0.4330, 0.9620),
            (0.3300, 0.9760), (0.2560, 0.9320), (0.2280, 0.8480),
            (0.2360, 0.7560), (0.2520, 0.6360), (0.2740, 0.5150),
        ],
        "feather": 3.0,
    },
    "armA": {   # 垂下的那只（画面左侧）
        # 下界收到 v 0.47：手从 v≈0.54 才开始，切到 0.518 会把腕部一起带走。
        # psd2live 的规矩是「被遮挡的地方要留余量」：手臂层只负责能摆的皮肉，
        # 手掌 / 手掌握着的刀柄一律留在 body 与 sword 层里，不然一动就从手心里断开。
        "poly": [
            (0.2990, 0.2280), (0.3220, 0.2320), (0.3290, 0.4100),
            (0.3320, 0.4720), (0.3150, 0.4800), (0.3040, 0.4720),
            (0.2980, 0.4000),
        ],
        "feather": 2.5,
    },
    "armB": {   # 握刀的那只（画面右侧）
        "poly": [
            (0.3760, 0.2260), (0.4010, 0.2340), (0.4080, 0.4100),
            (0.4100, 0.4720), (0.3920, 0.4800), (0.3800, 0.4720),
            (0.3770, 0.4000),
        ],
        "feather": 2.5,
    },
}

# 面部区域（UV）：只在这里做清晰化
FACE = (0.3310, 0.0930, 0.4080, 0.2080)

# ---------------------------------------------------------------- 五官微动层
#
# 眼睛和嘴要做「活起来」的效果，就必须能相对脸皮挪动 1~2px。
# 但挪动意味着原来位置会空出来 —— 如果 body 在那里 alpha=0，空出来的是**天空**，
# 一眼就穿帮。所以这两个洞不能用「挖空」处理，而要**填一块皮肤垫底**：
#   · 下层 body 在眼窝/嘴窝处填成周边皮肤的平滑色（不保留原五官）
#   · 上层 eye / mouth 带着原图内容，做 1~2px 位移
# 露出来的那一条是皮肤，读作「眼球在眼窝里动」，而不是一个洞。
#
# 注意这和头发/裙摆的原则并不矛盾：那两层的位移有 20px，
# 底下必须彻底挖空（否则露出静止的同名像素 = 虚影）；
# 这里的位移只有 1~2px，露出的量级本来就在「看不见」的边缘，
# 填一层**不同内容**（模糊皮肤）不会产生重影。
#
# 坐标来源：对 4K 母版做暗像素行列剖面量出来的（不是目测）：
#   近眼  暗区 u 0.3499~0.3710，v 0.1700~0.1870
#   嘴    唇线 u 0.3625~0.3805，v 0.2135~0.2165
# 远眼 u 0.379~0.395 被一缕头发从中间劈开，切出来会带着头发一起动 —— 不做层，
# 只保留原来的「睫毛线 + 皮肤贴片」眨眼方案。
EYE = {
    "box": (0.3450, 0.1638, 0.3770, 0.1930),
    "ell": (0.3606, 0.1782, 0.0134, 0.0106),
    "feather": 1.7,
    "k_mul": 2.0,          # 眼是最费的细节，单独超采样
}
MOUTH = {
    "box": (0.3572, 0.2055, 0.3862, 0.2238),
    "ell": (0.3716, 0.2146, 0.0129, 0.0073),
    "feather": 1.7,
    "k_mul": 2.0,
}

# 远眼（画面右侧、鼻梁旁的那只）：3/4 侧脸，只剩一条 23x17px 的窄缝，
# 外侧紧贴一缕刘海。位置是拿 4x 面部放大 + UV 网格量出来的，不是估的。
# 它不做独立眼球层（太小，挪 1px 就会露出鼻梁），只做一张闭眼皮肤贴片：
# 眨眼时从上往下盖住这条缝，眼线跟着下缘走。
FAR_EYE = {
    "ell": (0.3832, 0.1820, 0.0036, 0.0070),
    "feather": 1.2,
    "k_mul": 2.0,
}


def log(msg):
    print("  " + msg)


# ---------------------------------------------------------------- 蒙版工具
def blank_mask(w, h):
    return Image.new("L", (w, h), 0)


def draw_poly(m, poly, w, h, feather):
    d = ImageDraw.Draw(m)
    pts = [(u * w, v * h) for (u, v) in poly]
    d.polygon(pts, fill=255)
    if feather > 0:
        m = m.filter(ImageFilter.GaussianBlur(feather))
    return m


def draw_ellipses(m, ell, w, h, feather):
    """椭圆集合：先各自画满，再整体羽化。椭圆的边本身就该是软的。"""
    amp = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(amp)
    for (u, v, rx, ry) in ell:
        d.ellipse([(u - rx) * w, (v - ry) * h, (u + rx) * w, (v + ry) * h], fill=255)
    if feather > 0:
        amp = amp.filter(ImageFilter.GaussianBlur(feather))
    return Image.fromarray(np.maximum(np.array(m), np.array(amp)))


def union(*masks):
    out = np.zeros_like(np.array(masks[0]))
    for m in masks:
        out = np.maximum(out, np.array(m))
    return Image.fromarray(out)


# ---------------------------------------------------------------- 周边像素填充
def fill_lr(rgb, hole):
    """把洞用「同一高度左右两侧的已知像素做线性过渡」填满。

    为什么不是最近邻：最近邻在又高又宽的洞上会摊出一大片放射状 Voronoi 色带
    （每个方向抢一块扇形），裙子一动，这些色带就露出来，像被涂抹过。
    为什么不是水平搬运：只取左侧，右侧真实颜色完全没用上 ——
    人物右边是山谷、左边是天空，搬过来就是一条横向错色的带子。

    左右插值天然连续：洞左边界一定等于真实颜色，右边界也一定等于真实颜色，
    中间只是平滑过渡，露出来最多是一条柔和的光影，不会错色。
    """
    h, w = hole.shape
    xs = np.arange(w, dtype=np.int32)[None, :].repeat(h, 0)
    # 左侧最近已知像素
    li = np.where(~hole, xs, -1)
    li = np.maximum.accumulate(li, axis=1)
    # 右侧最近已知像素
    ri = np.where(~hole, xs, w * 2)
    ri = np.minimum.accumulate(ri[:, ::-1], axis=1)[:, ::-1]
    rows = np.arange(h, dtype=np.int32)[:, None]

    hasL = li >= 0
    hasR = ri < w
    li_c = np.clip(li, 0, w - 1)
    ri_c = np.clip(ri, 0, w - 1)
    left = rgb[rows, li_c]
    right = rgb[rows, ri_c]
    dl = np.maximum(1, xs - li_c).astype(np.float32)
    dr = np.maximum(1, ri_c - xs).astype(np.float32)
    t = np.clip(dl / (dl + dr), 0, 1)[:, :, None]
    mix = left * (1.0 - t) + right * t
    m3 = (hasL & ~hasR)[:, :, None]
    mix = np.where(m3, left, mix)
    mix = np.where((~hasL & hasR)[:, :, None], right, mix)

    out = rgb.copy()
    out[hole] = mix[hole]
    # 洞内轻微模糊，把左右两侧的硬接缝磨掉；已知像素保持原样
    known = ~hole
    for _ in range(3):
        blur = gaussian_filter(out, sigma=(1.6, 5.0, 0), mode="nearest")
        out[hole] = blur[hole]
        out[known] = rgb[known]
    return out


def fill_ud(rgb, hole):
    """纵向插值：用同一列上下的已知像素过渡填满。

    布料褶皱是竖着的，竖向延伸能把褶皱「接」下去；横着拉会把条纹横断，
    一眼就看出是涂抹。刀身上的刀柄横穿腰带、刀身横穿裙摆，都要用它补。
    """
    out = fill_lr(np.ascontiguousarray(rgb.transpose(1, 0, 2)),
                  np.ascontiguousarray(hole.T))
    return np.ascontiguousarray(out.transpose(1, 0, 2))


def inpaint_flat(rgb, hole, ring_px=30, dilate_px=7, sigma=9.0):
    """把小块洞填成「周围皮肤的延续」。

    这里用**归一化卷积**（normalized convolution）而不是「按行取中位数」：

        out = Σ(Gσ * rgb·w) / Σ(Gσ * w)

    w 是「已知皮肤」的权重图。相当于让周围的皮肤按高斯权重往洞里扩散，
    **低频的明暗关系会被一起带进来** —— 眉骨的阴影会继续往下压、
    颧骨的高光会继续往上升。早先按行取中位数只在竖向有渐变、横向是平的，
    补出来是一块「被抹平的肉」，边界一眼就能看出来。

    w 的取法有三个讲究，少一条就补成补丁：
      1. 洞**外扩 dilate_px 再排除**。睫毛线紧贴眼型边界且是深色，
         不排除就等于把睫毛当成皮肤扩散进来 —— 亮度掉下去、色相变灰。
      2. 只留**暖色像素**（R 明显高于 B）才算皮肤。发丝、阴影、睫毛都是
         低饱和的，留着会继续污染结果。
      3. 只在本窗口内算。整幅图做高斯既慢，又会把远处的山和天空拉进来。

    ring_px 是窗口比洞大多少；sigma 是扩散半径（像素）。
    """
    h, w = hole.shape
    ys, xs = np.nonzero(hole)
    if len(ys) == 0:
        return rgb.copy()
    y0, y1 = max(0, ys.min() - ring_px), min(h - 1, ys.max() + ring_px)
    x0, x1 = max(0, xs.min() - ring_px), min(w - 1, xs.max() + ring_px)

    band = (distance_transform_edt(~hole) <= dilate_px) & (~hole)
    known = (~band) & (~hole)
    warm = rgb[:, :, 0] > rgb[:, :, 2] + 8
    wgt = (known & warm).astype(np.float32)

    sub = rgb[y0:y1 + 1, x0:x1 + 1]
    ws = wgt[y0:y1 + 1, x0:x1 + 1]
    num = gaussian_filter(sub * ws[:, :, None], sigma=(sigma, sigma, 0), mode="nearest")
    den = gaussian_filter(ws, sigma=(sigma, sigma), mode="nearest")
    if den.max() < 1e-4:
        return rgb.copy()
    ex = num / np.maximum(den, 1e-4)[:, :, None]

    # 软边混合：洞里整块换成外推值，洞外 4σ 内逐渐过渡回原图。
    # 硬边才是「补丁感」的来源 —— 颜色差得再小，一条轮廓也会被眼睛抓住。
    wt = np.clip(gaussian_filter(hole.astype(np.float32), 4.0), 0, 1)
    wt[hole] = 1.0
    wt_sub = wt[y0:y1 + 1, x0:x1 + 1][:, :, None]
    out = rgb.copy()
    out[y0:y1 + 1, x0:x1 + 1] = sub * (1 - wt_sub) + ex * wt_sub
    return out


def ellipse_mask(W, H, spec):
    """椭圆蒙版（UV 中心 + 两个半径）。五官层只能是自己那一块，绝不能多带皮肤。"""
    m = blank_mask(W, H)
    u, v, rx, ry = spec["ell"]
    ImageDraw.Draw(m).ellipse(
        [(u - rx) * W, (v - ry) * H, (u + rx) * W, (v + ry) * H], fill=255)
    f = spec.get("feather", 1.5)
    if f > 0:
        m = m.filter(ImageFilter.GaussianBlur(f))
    return m


def bbox_of(mask_arr, pad, w, h):
    ys, xs = np.where(mask_arr > 8)
    if len(xs) == 0:
        return (0, 0, w, h)
    return (max(0, xs.min() - pad), max(0, ys.min() - pad),
            min(w, xs.max() + 1 + pad), min(h, ys.max() + 1 + pad))


# ---------------------------------------------------------------- 面部清晰化
def face_sharpen(img, box_uv, frame_w, frame_h):
    """脸部单独提清晰度：多级锐化 + 局部对比，用羽化椭圆贴回。"""
    W, H = img.size
    u0, v0, u1, v1 = box_uv
    x0, y0, x1, y1 = int(u0 * W), int(v0 * H), int(u1 * W), int(v1 * H)
    pad = int((x1 - x0) * 0.22)
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(W, x1 + pad), min(H, y1 + pad)
    crop = img.crop((x0, y0, x1, y1)).convert("RGB")

    s = crop.filter(ImageFilter.UnsharpMask(radius=2.4, percent=115, threshold=2))
    s = s.filter(ImageFilter.UnsharpMask(radius=1.1, percent=60, threshold=1))
    a = np.asarray(s).astype(np.float32)
    # 局部对比（以自身模糊版为基准做 S 曲线，只推动中间调）
    base = np.asarray(crop.filter(ImageFilter.GaussianBlur(9))).astype(np.float32)
    lo = np.clip((a - base) * 0.35 + base, 0, 255)
    a = np.clip(a + (a - lo) * 0.55, 0, 255).astype(np.uint8)
    s = Image.fromarray(a)

    # 羽化椭圆遮罩
    m = Image.new("L", s.size, 0)
    d = ImageDraw.Draw(m)
    d.ellipse([(x1 - x0) * 0.06, (y1 - y0) * 0.06, (x1 - x0) * 0.94, (y1 - y0) * 0.94], fill=255)
    m = m.filter(ImageFilter.GaussianBlur((x1 - x0) * 0.09))
    out = img.copy()
    out.paste(s, (x0, y0), m)
    return out


# ---- 抠图
# ALPHA_RAW 是「只抠图、没补刀」的干净母版，ALPHA_CACHE 是补刀后的成品。
# 分开存是为了刀宽能反复调：max 只会让刀变宽，如果拿成品当输入，
# 一旦画宽了就再也收不回来。
ALPHA_RAW = os.path.join(ROOT, "temp", "alpha_raw.png")
ALPHA_CACHE = os.path.join(ROOT, "temp", "alpha_4k.png")
CUT_CACHE = os.path.join(ROOT, "temp", "cut.png")


def _run_rembg(w, h):
    """跑 u2netp 拿人物 alpha。环境里没有 rembg 时退回 temp/cut.png。"""
    try:
        from rembg import remove, new_session
    except ImportError:
        if not os.path.exists(CUT_CACHE):
            raise
        log("没有 rembg，直接用 temp/cut.png 的 alpha")
        return Image.open(CUT_CACHE).split()[3].resize((w, h), Image.LANCZOS)
    sess = new_session("u2netp")
    src = Image.open(SRC).convert("RGB")
    cut = remove(src, session=sess, alpha_matting=False)
    cut.save(CUT_CACHE)          # 顺手缓存，下次环境没了也不怕
    return cut.split()[3].resize((w, h), Image.LANCZOS)


def sword_band(W, H, grow=0.0, extra=0):
    """刀的形状（UV 折线 + 各自的真实直径），返回 L 蒙版。

    grow 是「比真实刀身再宽多少」（比例），extra 是再额外加宽的像素：
    刀层用 grow 盖住辉光，裙子补布料那块再往两边各多 extra，
    让裙子摆动时从刀身边缘挪出来的只是布料。
    """
    m = blank_mask(W, H)
    d = ImageDraw.Draw(m)
    for (p, q, wd) in SWORD:
        wpx = max(2, int(round(wd * W * (1.0 + grow))) + extra)
        d.line([(p[0] * W, p[1] * H), (q[0] * W, q[1] * H)], fill=255, width=wpx)
        # 线段两端是平头，补两个圆头，避免接口处留缺口
        for pt in (p, q):
            r = wpx * 0.5
            d.ellipse([pt[0] * W - r, pt[1] * H - r, pt[0] * W + r, pt[1] * H + r], fill=255)
    return m.filter(ImageFilter.GaussianBlur(0.8))


def _paint_sword(alpha, W, H):
    """把刀并进人物 alpha。max 是幂等的，反复跑不会让刀越来越粗。"""
    sw = np.array(sword_band(W, H)).astype(np.float32) / 255.0
    a = np.array(alpha).astype(np.float32) / 255.0
    return Image.fromarray((np.clip(np.maximum(a, sw), 0, 1) * 255).astype(np.uint8))


def load_alpha(W, H, force=False):
    """人物 alpha（含补刀与外扩）。结果缓存在 temp/alpha_4k.png。

    缓存的意义不只是省时间：rembg + onnxruntime 不是每个环境都装得上，
    有缓存就能在没有 rembg 的机器上重跑整个切层流程。
    """
    raw = None
    for path in (ALPHA_RAW, ALPHA_CACHE):
        if not force and os.path.exists(path):
            c = Image.open(path)
            if c.size == (W, H):
                raw = c.convert("L")
                log("复用 alpha 母版 %s" % os.path.basename(path))
                break

    if raw is None:
        raw = _run_rembg(W, H)
        # 轮廓外扩 1px：背景是填充出来的，颜色和人物边缘总有细微差别，
        # 往外扩一点才能把这圈色差盖住（不然会看到一圈灰边）
        raw = raw.filter(ImageFilter.MaxFilter(3))
        os.makedirs(os.path.dirname(ALPHA_RAW), exist_ok=True)
        raw.save(ALPHA_RAW)

    # 补刀放在这里（而不是抠图分支里）：刀宽是标定出来的，随时可能要调，
    # 每次从母版重新 max 一遍就能生效，且可重复执行不会累积变粗。
    alpha = _paint_sword(raw, W, H)

    os.makedirs(os.path.dirname(ALPHA_CACHE), exist_ok=True)
    alpha.save(ALPHA_CACHE)
    return alpha


# ---------------------------------------------------------------- 主流程
def build_lid(sharp, em, bb, px):
    """闭眼贴图（皮肤层）：用眼周真实肤色 + 真实皮肤微纹理合成一块「上眼皮」。

    为什么要单独生成，而不是继续用 body 的垫底皮肤：
      body 在眼窝处是归一化卷积外推出来的，只有低频明暗、没有细节，
      闭眼时整块看起来像被橡皮擦糊过（用户说的「闭眼后眼部模糊」）。
      这里取眼周皮肤的均值色 + 同一张脸上别处的皮肤高频纹理，再补一条很浅的
      上睑褶皱，1:1 下就是一块正常的眼皮。

    只生成**皮肤**，睫毛线由运行时沿眼皮下缘画（线要跟着 k 移动，不能烤死）。
    """
    arr = np.asarray(sharp).astype(np.float32)
    H, W = arr.shape[:2]
    alpha = np.asarray(em).astype(np.float32) / 255.0
    a8 = (alpha * 255).astype(np.uint8)

    # 眼周皮肤参考色：环形、只取暖色像素（睫毛/头发/阴影都被排除）。
    # 上睑与下睑分开取：上睑本来就比颊暗一档，只用颊色会把闭眼贴成一块亮斑。
    outer = np.asarray(Image.fromarray(a8).filter(ImageFilter.MaxFilter(25))
                       .filter(ImageFilter.GaussianBlur(7)), np.float32) / 255.0
    inner = np.asarray(Image.fromarray(a8).filter(ImageFilter.MaxFilter(11))
                       .filter(ImageFilter.GaussianBlur(3)), np.float32) / 255.0
    ring = np.clip(outer - inner, 0, 1)
    warm = (arr[:, :, 0] > arr[:, :, 2] + 8) & (arr[:, :, 0] > 120)

    ys_all, _ = np.nonzero(np.asarray(em) > 8)
    top_y, bot_y = int(ys_all.min()), int(ys_all.max())
    yy_grid = np.arange(H)[:, None]
    band_top = ring * warm * ((yy_grid > top_y - 1.1 * (bot_y - top_y)) &
                              (yy_grid < top_y - 0.15 * (bot_y - top_y)))
    band_bot = ring * warm * ((yy_grid > bot_y + 0.25 * (bot_y - top_y)) &
                              (yy_grid < bot_y + 1.30 * (bot_y - top_y)))
    if band_top.sum() < 50:
        band_top = ring * warm
    if band_bot.sum() < 50:
        band_bot = ring * warm
    ref_top = (arr * band_top[:, :, None]).sum(axis=(0, 1)) / max(1e-3, band_top.sum())
    ref_bot = (arr * band_bot[:, :, None]).sum(axis=(0, 1)) / max(1e-3, band_bot.sum())
    ref = ref_bot

    # 皮肤微纹理：在脸部找一块最平（标准差最小）的暖色皮肤当高频来源
    best = None
    for cy in range(int(0.14 * H), int(0.26 * H), 4):
        for cx in range(int(0.32 * W), int(0.46 * W), 4):
            p = arr[cy:cy + 36, cx:cx + 36]
            if p.shape[:2] != (36, 36):
                continue
            m = p.reshape(-1, 3).mean(0)
            sd = float(p.reshape(-1, 3).std(0).mean())
            if 150 < m[0] < 232 and m[0] > m[2] + 10 and sd < 7.0:
                if best is None or sd < best[0]:
                    best = (sd, cx, cy)
    hp = None
    if best:
        noise = arr[best[2]:best[2] + 36, best[1]:best[1] + 36]
        low = np.asarray(Image.fromarray(noise.astype(np.uint8))
                         .filter(ImageFilter.GaussianBlur(2.2)), np.float32)
        hp = noise - low
        hp -= hp.mean(axis=(0, 1), keepdims=True)

    x0, y0, x1, y1 = [int(round(v)) for v in bb]
    bw, bh = max(4, x1 - x0), max(4, y1 - y0)
    yy = np.linspace(0, 1, bh, dtype=np.float32)[:, None, None]
    pat = ref_top[None, None, :] * (1.0 - yy) + ref_bot[None, None, :] * yy
    pat = pat * (0.985 + 0.030 * yy)
    if hp is not None:
        pat = pat + np.resize(hp, (bh, bw, 3)) * 0.55

    # 上睑褶皱：一条很浅的弧，边界落在眼皮上，不画成直杠
    cre = Image.new("L", (bw, bh), 0)
    d = ImageDraw.Draw(cre)
    pts = []
    for s in range(33):
        t = s / 32.0
        pts.append((bw * (0.06 + 0.88 * t), bh * (0.42 + 0.055 * np.sin(np.pi * t))))
    for i in range(1, len(pts)):
        d.line([pts[i - 1], pts[i]], fill=64, width=max(2, int(round(bh * 0.045))))
    cre = cre.filter(ImageFilter.GaussianBlur(max(1.0, bh * 0.028)))
    ca = np.asarray(cre, np.float32)[:, :, None] / 255.0
    pat = pat * (1.0 - 0.38 * ca)

    img = Image.fromarray(np.clip(pat, 0, 255).astype(np.uint8)).convert("RGBA")
    if img.size != (px[0], px[1]):
        img = img.resize((px[0], px[1]), Image.LANCZOS)

    # 边缘羽化放大到 ~4px：上睑与脸颊的肤色差一个色阶，硬边会看出一条横线。
    # 另外把贴图**上缘**渐变到透明：上睑本来就有自己的明暗，硬接一块皮肤会在
    # 眉毛下面留一条水平分界；渐隐之后是同一张脸的两个色阶自然过渡。
    # 渐隐范围必须按**眼型 bbox**算，不能按贴图高度：远眼贴片只有 43px 高，
    # 按 34% 算会把整只眼都变成半透明，闭眼时眼珠从眼皮底下透出来。
    am = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)) \
        .filter(ImageFilter.GaussianBlur(3.6)).crop((x0, y0, x1, y1))
    am = am.resize((px[0], px[1]), Image.LANCZOS)
    aa = np.asarray(am, np.float32) / 255.0
    rows = np.nonzero((aa > 0.03).any(axis=1))[0]
    if len(rows):
        mt, mb2 = int(rows.min()), int(rows.max())
        mh = max(1.0, float(mb2 - mt))
        yy = np.arange(px[1], dtype=np.float32)
        ramp = np.clip((yy - (mt - 0.55 * mh)) / max(1.0, 0.55 * mh), 0, 1)
    else:
        ramp = np.ones(px[1], dtype=np.float32)
    aa = aa * ramp[:, None]
    img.putalpha(Image.fromarray((np.clip(aa, 0, 1) * 255).astype(np.uint8)))
    log("lid 闭眼皮肤 %dx%d（上睑 %.0f,%.0f,%.0f / 下睑 %.0f,%.0f,%.0f%s）"
        % (px[0], px[1], ref_top[0], ref_top[1], ref_top[2],
           ref_bot[0], ref_bot[1], ref_bot[2], "" if hp is not None else "，无纹理源"))
    return img


def main():
    os.makedirs(OUT, exist_ok=True)

    log("读出超分立绘 %s" % os.path.basename(FRAME))
    frame = Image.open(FRAME).convert("RGB")
    W, H = frame.size
    if W != WORK_W:
        frame = frame.resize((WORK_W, int(round(H * WORK_W / float(W)))), Image.LANCZOS)
        W, H = frame.size
    log("工作尺寸 %dx%d" % (W, H))

    log("抠图（u2netp）...")
    alpha = load_alpha(W, H)
    # 面部先提清晰度，**在切层之前**做：五官层要从这张图上取像素，
    # 否则眼睛/嘴是糊的，而脸皮是锐的，一眼看出是贴上去的补丁。
    log("面部清晰化...")
    sharp = face_sharpen(frame, FACE, W, H)
    char = sharp.copy()
    char.putalpha(alpha)

    # ---- 背景：把人物区域填掉 ----
    #
    # 背景只在**部位移动后露出的那条窄带**里被看到（最宽十几个像素），
    # 所以它不需要「猜出复杂的结构」，只需要「左右两侧都对得上」。
    # 左右插值正好满足：洞左边界一定等于真实颜色、右边界也一定等于真实颜色，
    # 中间平滑过渡。之前用的最近邻会摊出放射状 Voronoi 色带，
    # 水平搬运则只取左侧、右边真实颜色完全没用上 —— 都会露错色。
    log("生成背景（人物区域左右插值填充）...")
    bw_ = BG_W
    bh_ = int(round(H * BG_W / float(W)))
    bg_rgb = np.asarray(frame.resize((bw_, bh_), Image.LANCZOS)).astype(np.float32)
    a_small = np.asarray(alpha.resize((bw_, bh_), Image.LANCZOS)).astype(np.float32) / 255.0
    hole_small = a_small > 0.5
    filled = fill_lr(bg_rgb, hole_small)
    wgt = np.clip((a_small - 0.30) / 0.45, 0.0, 1.0)[:, :, None]
    bg_rgb = bg_rgb * (1.0 - wgt) + filled * wgt
    bg_small = Image.fromarray(np.clip(bg_rgb, 0, 255).astype(np.uint8))
    bg_small.save(os.path.join(OUT, "bg.jpg"), quality=Q_BG, optimize=True, progressive=True)
    log("bg.jpg %dx%d %.0f KB" % (bg_small.width, bg_small.height,
                                 os.path.getsize(os.path.join(OUT, "bg.jpg")) / 1024.0))

    # ---- 部位蒙版 ----
    masks = {}
    for name, dfn in PART_DEF.items():
        m = blank_mask(W, H)
        if "poly" in dfn:
            m = draw_poly(m, dfn["poly"], W, H, dfn.get("feather", 3))
        if "ell" in dfn:
            m = draw_ellipses(m, dfn["ell"], W, H, dfn.get("feather", 3))
        masks[name] = np.array(m) > 128
        log("蒙版 %-6s 覆盖 %.1f%%" % (name, masks[name].mean() * 100))

    # 刀：独立一层。它比真刀胖一圈（盖住辉光，也盖住裙子在它底下的位移），
    # 裙子在刀的位置**不挖洞**，而是把布料补进去 —— 见下面 skirt_rgb。
    sword_layer = np.array(sword_band(W, H, SWORD_GROW)) > 128
    log("刀层覆盖 %.2f%%（比真刀宽 %d%%）" % (sword_layer.mean() * 100, SWORD_GROW * 100))

    # 裙子在刀底下那块「补布料」：竖直方向把褶皱接下去。
    # 目的不是好看（平时被刀层完全盖住），而是裙子摆起来时，
    # 从刀身边缘挪出来的那一小条是布料而不是天空或刀身的残影。
    sw_band = np.array(sword_band(W, H, SWORD_GROW, SWORD_SLIDE * 2)) > 128
    skirt_rgb = np.asarray(frame).astype(np.float32).copy()
    sx0, sy0, sx1, sy1 = bbox_of((sw_band * 255).astype(np.uint8), 56, W, H)
    skirt_rgb[sy0:sy1, sx0:sx1] = fill_ud(
        skirt_rgb[sy0:sy1, sx0:sx1], sw_band[sy0:sy1, sx0:sx1])
    skirt_img = Image.fromarray(np.clip(skirt_rgb, 0, 255).astype(np.uint8))
    log("裙子补布料区域 %dx%d" % (sx1 - sx0, sy1 - sy0))

    # ---- 严格图层归属 ----
    #
    # 这一条是整个管线的地基，也是 psd2live / Cubism 的模型：
    # **每个像素只能属于一个图层**，绘制顺序决定谁盖谁。
    #
    # 之前是「body 保留满 alpha，只在部位位置把颜色填成模糊版」，
    # 于是部位层半透明的边缘会透出 body 上那份**静止的同名像素** ——
    # 头发一动就出现两条错开的轮廓（用户说的「严重虚影」），
    # 刀在裙摆上留下一条暗色重影（「剑错位」）。
    # 现在被上层吃掉的像素，在 body 里直接 alpha=0：颜色填什么都不重要，
    # 因为根本画不出来。露出来的是后面的 bg —— 那才是头发背后本来就有的东西。
    # 手臂**不从 body 里挖洞**：body 保留手臂与手掌的像素，手臂层整层压在上面。
    # 这是 psd2live 的「被遮挡区域留余量」：手臂摆 4~6px 时，让位露出来的是
    # body 上同一块肤色，而不是天空；早先挖洞的版本会沿手臂内侧撕出一条亮缝
    # （看起来就像手被切断）。手 / 刀柄始终留在 body 与 sword 层，永远不会跟着手臂走。
    order = ["armA", "armB", "hair", "skirt"]      # 图层输出顺序
    own = ["hair", "skirt"]                        # 只有大件才吃 body 像素
    taken = np.zeros((H, W), bool)
    for name in own:
        masks[name] = masks[name] & ~taken
        taken |= masks[name]

    # 手臂层底边留 12px 透明过渡：底下是 body 上同一块肤色，软边把「手臂层边界」
    # 和 body 那份静止手臂融在一起，动起来不会出现一条横折线。
    soft = {}
    for name in ("armA", "armB"):
        ys_, _ = np.nonzero(masks[name])
        y1_ = int(ys_.max())
        ramp = np.clip((y1_ - np.arange(H, dtype=np.float32)[:, None]) / 12.0, 0, 1)
        soft[name] = masks[name].astype(np.float32) * ramp

    union = taken | sword_layer
    a_f = np.asarray(alpha).astype(np.float32) / 255.0
    body_a = a_f * (~union)
    body = sharp.copy()
    body.putalpha(Image.fromarray((np.clip(body_a, 0, 1) * 255).astype(np.uint8)))
    log("人物底覆盖 %.1f%%（已让出全部部位）" % ((body_a > 0.02).mean() * 100))

    # ---- 眼窝 / 嘴窝：填皮肤垫底 ----
    #
    # 五官层会相对脸皮挪 1~2px，挪开的那条缝必须落在**皮肤**上而不是天空上。
    # 所以先把这两个洞从 body 里抹平成周边肤色，再把原五官单独存一层盖回去。
    # 垫底用的是「按行取中位色」，不是模糊 —— 模糊会带进睫毛的深色。
    eye_m = ellipse_mask(W, H, EYE)
    mouth_m = ellipse_mask(W, H, MOUTH)
    eye_hole = np.array(eye_m) > 127
    mouth_hole = np.array(mouth_m) > 127
    body_rgb = np.asarray(body.convert("RGB")).astype(np.float32)
    for hh in (eye_hole, mouth_hole):
        body_rgb = inpaint_flat(body_rgb, hh)
    body = Image.fromarray(np.clip(body_rgb, 0, 255).astype(np.uint8)).convert("RGBA")
    body.putalpha(Image.fromarray((np.clip(body_a, 0, 1) * 255).astype(np.uint8)))
    log("眼窝/嘴窝已填皮肤垫底（眼 %.2f%% 嘴 %.2f%%）" % (
        eye_hole.mean() * 100, mouth_hole.mean() * 100))

    # ---- 输出各层 ----
    meta = {"frame": [W, H], "layers": {}}
    a0 = np.array(alpha)
    bb0 = bbox_of(a0, 0, W, H)
    K = BODY_W / float(max(1, bb0[2] - bb0[0]))     # 所有层同一个缩放，避免分辨率不一致

    def save_layer(name, img, k_mul=1.0):
        # 注意 bbox_of 里比较的是 >8，所以这里必须给 0/255 而不是 0/1
        solid = ((np.array(img.split()[3]) > 6).astype(np.uint8)) * 255
        bb = bbox_of(solid, 6, W, H)
        sub = img.crop(bb)
        nw = max(8, int(round(sub.width * K * k_mul)))
        nh = max(8, int(round(sub.height * K * k_mul)))
        sub = sub.resize((nw, nh), Image.LANCZOS)
        fn = "%s.webp" % name
        sub.save(os.path.join(OUT, fn), quality=Q_PART, method=6)
        meta["layers"][name] = {
            "file": fn,
            "uv": [bb[0] / float(W), bb[1] / float(H), bb[2] / float(W), bb[3] / float(H)],
            "px": [nw, nh],
        }
        log("%-9s %4dx%-4d %6.0f KB   uv %.3f,%.3f -> %.3f,%.3f" % (
            fn, nw, nh, os.path.getsize(os.path.join(OUT, fn)) / 1024.0,
            bb[0] / float(W), bb[1] / float(H), bb[2] / float(W), bb[3] / float(H)))

    save_layer("body", body)
    for name in order:
        lay = (skirt_img if name == "skirt" else char).copy()
        a = a_f * (soft[name] if name in soft else masks[name])
        lay.putalpha(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)))
        save_layer(name, lay)

    # 刀：颜色取原图，alpha 取刀层蒙版（不乘人物 alpha —— 刀身是细高光，
    # u2netp 本来就检测不到，乘上去等于把刀抹掉）
    sword_img = frame.copy()
    sword_img.putalpha(Image.fromarray((sword_layer * 255).astype(np.uint8)))
    save_layer("sword", sword_img)

    # 五官：内容取**锐化后**的脸，alpha 取自己的椭圆。
    # 眼/嘴单独 2 倍超采样：它们是全图最费的细节，1:1 渲染下会糊。
    for nm, mk, kk in (("eye", eye_m, EYE["k_mul"]), ("mouth", mouth_m, MOUTH["k_mul"])):
        lay = sharp.copy().convert("RGBA")
        lay.putalpha(mk)
        save_layer(nm, lay, kk)

    # 闭眼皮肤层：与 eye 层**同 bbox 同像素尺寸**，运行时按同一个 rect 贴回，
    # 这样眼皮下缘的裁切与眼线几何完全对齐，不会出现半像素错位。
    e_uv = meta["layers"]["eye"]["uv"]
    e_px = meta["layers"]["eye"]["px"]
    lid = build_lid(sharp, eye_m, (e_uv[0] * W, e_uv[1] * H, e_uv[2] * W, e_uv[3] * H), e_px)
    lid.save(os.path.join(OUT, "lid.webp"), quality=Q_PART, method=6)
    meta["layers"]["lid"] = {"file": "lid.webp", "uv": list(e_uv), "px": list(e_px)}
    log("lid.webp  %4dx%-4d %6.0f KB   uv %.3f,%.3f -> %.3f,%.3f" % (
        e_px[0], e_px[1], os.path.getsize(os.path.join(OUT, "lid.webp")) / 1024.0,
        e_uv[0], e_uv[1], e_uv[2], e_uv[3]))
    # 眼睑下缘的几何基准：真实眼型 bbox（不含 save_layer 的 6px padding）。
    # 运行时拿它算 k=0/1，否则闭眼线会落到眼睛下方十几像素的颊上。
    ys_, xs_ = np.nonzero(np.array(eye_m) > 8)
    meta["layers"]["eye"]["content"] = [
        xs_.min() / float(W), ys_.min() / float(H),
        (xs_.max() + 1) / float(W), (ys_.max() + 1) / float(H)]

    # 远眼：同一套合成皮肤，贴片小得多（23x17px 的窄缝）。
    # 不做独立眼球层，只做一张盖住这条缝的闭眼皮肤；内容框给运行时算下缘。
    far_m = ellipse_mask(W, H, FAR_EYE)
    fys, fxs = np.nonzero(np.array(far_m) > 8)
    fpad = 8
    fb = (max(0, int(fxs.min()) - fpad), max(0, int(fys.min()) - fpad),
          min(W, int(fxs.max()) + 1 + fpad), min(H, int(fys.max()) + 1 + fpad))
    fpx = (max(8, int(round((fb[2] - fb[0]) * K * FAR_EYE["k_mul"]))),
           max(8, int(round((fb[3] - fb[1]) * K * FAR_EYE["k_mul"]))))
    lid_far = build_lid(sharp, far_m, fb, fpx)
    lid_far.save(os.path.join(OUT, "lidFar.webp"), quality=Q_PART, method=6)
    meta["layers"]["lidFar"] = {
        "file": "lidFar.webp",
        "uv": [fb[0] / float(W), fb[1] / float(H), fb[2] / float(W), fb[3] / float(H)],
        "px": [fpx[0], fpx[1]],
        "content": [fxs.min() / float(W), fys.min() / float(H),
                    (fxs.max() + 1) / float(W), (fys.max() + 1) / float(H)],
    }
    log("lidFar.webp %3dx%-3d %5.0f KB   uv %.3f,%.3f -> %.3f,%.3f" % (
        fpx[0], fpx[1], os.path.getsize(os.path.join(OUT, "lidFar.webp")) / 1024.0,
        fb[0] / float(W), fb[1] / float(H), fb[2] / float(W), fb[3] / float(H)))

    # 绘制顺序（从后到前）。运行时按这个顺序画，别在 JS 里再硬编码一遍。
    # 五官压在脸皮之上；它们只可能和 body 重叠，放在最后不影响其它层。
    meta["order"] = ["body", "skirt", "sword", "armA", "armB", "hair", "eye", "mouth"]
    meta["face"] = list(FACE)
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    log("meta.json 已写")

    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    log("合计 %.0f KB" % (total / 1024.0))


if __name__ == "__main__":
    sys.exit(main())
