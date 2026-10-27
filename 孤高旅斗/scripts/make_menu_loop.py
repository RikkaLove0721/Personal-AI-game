# -*- coding: utf-8 -*-
"""把一段视频做成「首尾相接」的主菜单循环底片。

原理（ping-pong loop）：取一段正放，再接一段倒放，两段拼成一个文件。
倒放的首帧 == 正放的末帧，所以接缝处必须剪掉 1 帧，否则会「顿」一下；
循环回到开头的那一帧也重复了一次，尾巴同样要剪掉。剪完的序列是
    0, 1, ..., N-1, N-2, ..., 2, 1, (回到 0)
整段循环写进一个 mp4，浏览器用 <video loop> 播即可 —— 不用 JS 控制
playbackRate=-1（Chrome 根本不支持负速率），接缝也就绝对不会有抖动。

    python scripts/make_menu_loop.py "D:/视频/AI/图片转动态视频.mp4"
    python scripts/make_menu_loop.py in.mp4 --start 0 --dur 8 --fps 15 --crf 32

产物：
    assets/menu-loop.mp4     正放+倒放，无音轨，faststart（边下边播）
    assets/menu-poster.webp  首帧，视频没到之前先垫着（菜单不会空一拍）

为什么不用一条 filter_complex 搞定：
    试过 `[0:v]trim,split[a][b];[b]reverse,trim=start_frame=1...;concat`，
    在 24fps 源 + 输出 -r 15 的情况下帧索引完全对不准（循环点跳变 4.5，
    普通帧间只有 1.3），改成先把帧率钉死、在已知帧数上剪，concat 又莫名少一帧。
    与其跟滤镜链的帧账纠缠，不如自己按帧读、按帧写：238 帧就是 238 帧。

ffmpeg 来源：优先 PATH，其次 imageio-ffmpeg 自带的静态版
（`pip install imageio-ffmpeg`，约 30MB，不污染系统）。
"""
import argparse
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")


def find_ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    raise SystemExit("找不到 ffmpeg：请先 `pip install imageio-ffmpeg`，或把 ffmpeg 放进 PATH")


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-2000:])
        raise SystemExit("ffmpeg 失败（退出码 %d）" % r.returncode)
    return r


def count_frames(path):
    """数这段视频有多少帧。优先 OpenCV（快且准），没有就退回 ffmpeg 的日志。"""
    try:
        import cv2
        cap = cv2.VideoCapture(path)
        n = 0
        while cap.read()[0]:
            n += 1
        cap.release()
        if n:
            return n
    except Exception:
        pass
    r = subprocess.run([find_ffmpeg(), "-i", path, "-map", "0:v:0", "-f", "null", "-"],
                       capture_output=True, text=True)
    hits = re.findall(r"frame=\s*(\d+)", r.stderr or "")
    return int(hits[-1]) if hits else 0


def seam_check(path):
    """自检：循环点（末帧 -> 首帧）的跳变，不该比「隔三帧」的普通差分还大。

    比的是什么：循环点是一次「跨了整段」的比较，两帧的压缩噪声是**不相关**的
    （开头是 I 帧，结尾是跑了 200 多帧的 P 帧），所以哪怕内容完全吻合，
    差值也会明显高于相邻帧。拿相邻帧当基准会误报 —— 实测 CRF 32 时
    相邻帧差 0.7、循环点 2.3，可同一份内容用 CRF 12 编码，循环点只有 0.83，
    比相邻帧还小，说明几何上是接得住的，多出来的全是码率噪声。
    所以基准取「隔三帧」的差分，量级才对得上一次跨段比较。
    """
    try:
        import cv2
        import numpy as np
        import statistics
    except Exception:
        return None

    def blur(f):
        return cv2.resize(cv2.GaussianBlur(f, (15, 15), 0).astype("float32"), (240, 135))

    cap = cv2.VideoCapture(path)
    fr = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        fr.append(blur(f))
    cap.release()
    if len(fr) < 12:
        return None
    d1 = statistics.median([float(np.abs(fr[i] - fr[i - 1]).mean()) for i in range(1, len(fr))])
    d3 = statistics.median([float(np.abs(fr[i] - fr[i - 3]).mean()) for i in range(3, len(fr))])
    wrap = float(np.abs(fr[0] - fr[-1]).mean())
    ok = wrap <= max(d3 * 2.0, d3 + 1.0)      # 只负责抓「剪错帧」这种量级的错，不是画质评分
    print("  自检   %s 循环点跳变 %.2f / 隔 3 帧基准 %.2f（相邻帧基准 %.2f）"
          % ("✔" if ok else "✘", wrap, d3, d1))
    return ok


def encode_pingpong(ff, seg_f, seg_r, out_mp4, w, h, fps, crf, n, drop):
    """按帧读、按帧写。

    drop：片段开头扔掉几帧。素材第 0 帧往往比第 1 帧暗一点（生成时的淡入），
    留着它，循环回到开头就会有一下可测的亮度跳变 —— 所以默认扔 1 帧，
    让「接缝处」和「循环点」都落在真正平滑的帧上。
    扔完之后：正放 s[drop..n-1]，倒放 s[n-2 .. drop+1]，循环回 s[drop]。
    """
    import cv2

    written = [0]
    cmd = [ff, "-y", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", "%dx%d" % (w, h),
           "-r", str(fps), "-i", "-",
           "-an",                                   # 没音轨，iOS 才肯自动播
           "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
           "-crf", str(crf), "-preset", "slow",
           # 关键帧越少越省：慢速推移的画面，每个 I 帧都值几十 KB。
           # 循环背景不会被拖进度条，整段只在开头放一个关键帧就够。
           "-g", "250", "-movflags", "+faststart", out_mp4]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    def put(frame):
        p.stdin.write(frame.tobytes())
        written[0] += 1

    limit = n - drop - 2          # 倒放段最后一个要写的下标（rev 的下标）
    try:
        cap = cv2.VideoCapture(seg_f)
        k = 0
        while True:
            ok, f = cap.read()
            if not ok:
                break
            if k >= drop:
                put(f)
            k += 1
        cap.release()

        cap = cv2.VideoCapture(seg_r)       # 已经倒放好了；这里只负责掐头去尾
        prev, k = None, 0
        while True:
            ok, f = cap.read()
            if not ok:
                break
            if prev is not None and 2 <= k <= limit + 1:
                put(prev)
            prev = f
            k += 1
        cap.release()
    finally:
        p.stdin.close()
        p.wait()
    if p.returncode != 0:
        raise SystemExit("ffmpeg 编码失败（退出码 %d）" % p.returncode)
    want = 2 * (n - drop) - 2
    if written[0] != want:
        raise SystemExit("帧数不对：写了 %d 帧，应该是 %d 帧" % (written[0], want))
    return written[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--start", type=float, default=0.0, help="从第几秒开始截")
    ap.add_argument("--dur", type=float, default=8.0, help="正放段时长（总时长 ≈ 2×dur）")
    ap.add_argument("--w", type=int, default=960)
    ap.add_argument("--h", type=int, default=540)
    ap.add_argument("--fps", type=int, default=15, help="慢镜头素材 15 帧足够，体积少一半")
    ap.add_argument("--crf", type=int, default=32)
    ap.add_argument("--drop", type=int, default=1, help="片段开头扔掉几帧（素材第 0 帧常带淡入）")
    args = ap.parse_args()

    ff = find_ffmpeg()
    src = args.src
    if not os.path.exists(src):
        raise SystemExit("源视频不存在：%s" % src)

    out_mp4 = os.path.join(ASSETS, "menu-loop.mp4")
    out_poster = os.path.join(ASSETS, "menu-poster.webp")
    seg_f = os.path.join(ASSETS, "_menu_fwd.mp4")
    seg_r = os.path.join(ASSETS, "_menu_rev.mp4")

    # 第一步：按目标帧率切出正放段。帧率必须先钉死，后面「第几帧」才说得清。
    print("  切段   %s  %.1fs -> %dx%d @%dfps"
          % (os.path.basename(src), args.dur, args.w, args.h, args.fps))
    run([ff, "-y", "-hide_banner", "-loglevel", "error",
         "-ss", str(args.start), "-t", str(args.dur), "-i", src,
         "-vf", "fps=%d,scale=%d:%d:flags=lanczos" % (args.fps, args.w, args.h),
         "-an", "-c:v", "libx264", "-crf", "12", "-preset", "veryfast", "-pix_fmt", "yuv420p",
         seg_f])
    n = count_frames(seg_f)
    if n < 6:
        raise SystemExit("切出来的片段只有 %d 帧，--dur 太短了" % n)

    # 第二步：整段倒放（帧数不变），第三步按帧拼起来时再掐头去尾
    run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", seg_f,
         "-vf", "reverse", "-an", "-c:v", "libx264", "-crf", "12", "-preset", "veryfast",
         "-pix_fmt", "yuv420p", seg_r])

    print("  编码   正放 %d 帧 + 倒放 %d 帧 = %d 帧（%.2f 秒循环）"
          % (n - args.drop, n - args.drop - 2, 2 * (n - args.drop) - 2,
             (2 * (n - args.drop) - 2) / float(args.fps)))
    encode_pingpong(ff, seg_f, seg_r, out_mp4, args.w, args.h, args.fps, args.crf, n, args.drop)
    for p in (seg_f, seg_r):
        try:
            os.remove(p)
        except OSError:
            pass

    # 封面：正放段第 0 帧（用切段前的源帧，少一层压缩）
    run([ff, "-y", "-hide_banner", "-loglevel", "error",
         "-ss", str(args.start + args.drop / float(args.fps)), "-i", src,
         "-frames:v", "1", "-vf", "scale=%d:%d:flags=lanczos" % (args.w, args.h),
         "-c:v", "libwebp", "-quality", "82", out_poster])

    k1 = os.path.getsize(out_mp4) / 1024.0
    k2 = os.path.getsize(out_poster) / 1024.0
    print("  产物   menu-loop.mp4    %6.0f KB   (%.1f 秒循环)"
          % (k1, (2 * (n - args.drop) - 2) / float(args.fps)))
    print("         menu-poster.webp %6.0f KB" % k2)
    seam_check(out_mp4)
    # 140KB/s ≈ 朋友那台服务器的实测带宽
    print("  预估   首屏视频 %.1f 秒下完（按 140KB/s 估）；poster 先顶上，菜单不会空" % (k1 / 140.0))


if __name__ == "__main__":
    main()
