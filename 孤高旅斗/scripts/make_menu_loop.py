# -*- coding: utf-8 -*-
"""把一段视频做成「首尾相接」的主菜单循环底片。

原理（ping-pong loop）：取一段正放，再接一段倒放，两段拼成一个文件。
倒放的首帧 == 正放的末帧，所以接缝处必须剪掉 1 帧，否则会「顿」一下。
整段循环写进一个 mp4，浏览器用 <video loop> 播即可 —— 不用 JS 控制
playbackRate=-1（Chrome 根本不支持负速率），接缝也就绝对不会有抖动。

    python scripts/make_menu_loop.py "D:/视频/AI/图片转动态视频.mp4"
    python scripts/make_menu_loop.py in.mp4 --start 0 --dur 8 --fps 18 --crf 32

产物：
    assets/menu-loop.mp4     正放+倒放，无音轨，faststart（边下边播）
    assets/menu-poster.webp  首帧，视频没到之前先垫着（菜单不会空一拍）

ffmpeg 来源：优先 PATH，其次 imageio-ffmpeg 自带的静态版
（`pip install imageio-ffmpeg`，约 30MB，不污染系统）。
"""
import argparse
import io
import os
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--start", type=float, default=0.0, help="从第几秒开始截")
    ap.add_argument("--dur", type=float, default=8.0, help="正放段时长（总时长 ≈ 2×dur）")
    ap.add_argument("--w", type=int, default=960)
    ap.add_argument("--h", type=int, default=540)
    ap.add_argument("--fps", type=int, default=15, help="慢镜头素材 15 帧足够，体积少一半")
    ap.add_argument("--crf", type=int, default=32)
    args = ap.parse_args()

    ff = find_ffmpeg()
    src = args.src
    if not os.path.exists(src):
        raise SystemExit("源视频不存在：%s" % src)

    out_mp4 = os.path.join(ASSETS, "menu-loop.mp4")
    out_poster = os.path.join(ASSETS, "menu-poster.webp")

    # input -ss 放在 -i 前面是「快速定位」，会跳到最近的关键帧；再 trim 到精确点。
    fc = (
        "[0:v]trim=%g:%g,setpts=PTS-STARTPTS," % (args.start, args.start + args.dur) +
        "scale=%d:%d:flags=lanczos,split[a][b];" % (args.w, args.h) +
        "[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];" +   # 剪掉与正放末帧重复的那帧
        "[a][r]concat=n=2:v=1[v]"
    )
    print("  编码   %s  %.1fs 正放 + 倒放 -> %dx%d @%dfps" %
          (os.path.basename(src), args.dur, args.w, args.h, args.fps))
    run([ff, "-y", "-hide_banner", "-loglevel", "error", "-ss", str(args.start), "-i", src,
         "-filter_complex", fc, "-map", "[v]", "-an",          # -an：没音轨，iOS 才肯自动播
         "-r", str(args.fps), "-c:v", "libx264", "-profile:v", "high",
         "-pix_fmt", "yuv420p", "-crf", str(args.crf), "-preset", "slow",
         # 关键帧越少越省：慢速推移的画面，每个 I 帧都值几十 KB。
         # 循环背景不会被拖进度条，整段只在开头放一个关键帧就够。
         "-g", "250", "-movflags", "+faststart",
         out_mp4])

    # 封面：正放段第 0 帧
    run([ff, "-y", "-hide_banner", "-loglevel", "error", "-ss", str(args.start), "-i", src,
         "-frames:v", "1", "-vf", "scale=%d:%d:flags=lanczos" % (args.w, args.h),
         "-c:v", "libwebp", "-quality", "82", out_poster])

    k1 = os.path.getsize(out_mp4) / 1024.0
    k2 = os.path.getsize(out_poster) / 1024.0
    print("  产物   menu-loop.mp4    %6.0f KB   (%.1f 秒循环)" % (k1, args.dur * 2 - 1.0 / args.fps))
    print("         menu-poster.webp %6.0f KB" % k2)
    # 140KB/s ≈ 朋友那台服务器的实测带宽
    print("  预估   首屏视频 %.1f 秒下完（按 140KB/s 估）；poster 先顶上，菜单不会空" % (k1 / 140.0))


if __name__ == "__main__":
    main()
