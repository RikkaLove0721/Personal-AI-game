# -*- coding: utf-8 -*-
"""孤高旅斗 · 背景音乐压缩（内置进单文件）

把音乐库转成适合内嵌到单个 HTML 里的小体积 AAC，输出到 dist/music_built/。
build.py 会把这些文件读成 base64 data URI 塞进 window.LD_MUSIC。

- 档位: AAC-LC / 单声道 / 32 kHz / 32 kbps（BGM 音量只有 15%，这个档位足够，
  24 分钟音乐约 5.8 MB；原库 57 MB → 压缩率 ~90%）
- 源目录: dist/music（用户直接丢进来的新音乐库）
          以及 ../music（旧默认目录，存在也一起收）
- 幂等: 输出比源文件新就跳过，可以反复跑
- 依赖 ffmpeg: 优先用 venv 里的 imageio-ffmpeg 自带二进制

用法:
    python scripts/proc_music.py           # 增量压缩
    python scripts/proc_music.py --force   # 全部重压
"""
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))    # 仓库根
SRC_DIRS = [
    os.path.join(REPO, "dist", "music"),                              # 用户放新库的地方
    os.path.join(os.path.dirname(REPO), "music"),                     # 旧默认目录
]
OUT_DIR = os.path.join(REPO, "dist", "music_built")

EXTS = (".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus")
BITRATE = "32k"
RATE = "32000"


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:                                # noqa: BLE001
        return "ffmpeg"                              # 退回 PATH 里的 ffmpeg


def pretty_name(fn):
    """文件名 → 显示名：「岡部啓一,MONACA - 1-14 曖昧ナ希望／氷雨」→「曖昧ナ希望／氷雨」"""
    base = os.path.splitext(fn)[0]
    if " - " in base:                                # 去掉「艺人 - 」前缀
        base = base.split(" - ", 1)[1]
    base = re.sub(r"^\s*\d+([-. ]\d+)?[. ]*", "", base)   # 去掉「1-14 」这种曲目号
    base = base.strip(" ._-")
    return base or os.path.splitext(fn)[0]


def collect():
    """返回 [(源路径, 输出名)]，同名冲突时后出现的加后缀"""
    seen = {}
    jobs = []
    for d in SRC_DIRS:
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.lower().endswith(EXTS):
                continue
            src = os.path.join(d, fn)
            if not os.path.isfile(src):
                continue
            name = pretty_name(fn)
            key = name
            n = 2
            while key in seen:                       # 重名就加序号，别互相覆盖
                key = "%s (%d)" % (name, n)
                n += 1
            seen[key] = src
            jobs.append((src, key))
    return jobs


def main():
    force = "--force" in sys.argv[1:]
    jobs = collect()
    if not jobs:
        print("找不到音乐素材（看了: %s）" % " | ".join(SRC_DIRS))
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)
    # 清掉已经不在歌单里的旧产物
    keep = set(n + ".m4a" for _, n in jobs)
    for fn in os.listdir(OUT_DIR):
        if fn not in keep:
            os.remove(os.path.join(OUT_DIR, fn))
            print("  移除过期: " + fn)

    ff = ffmpeg_exe()
    done = skip = 0
    for src, name in jobs:
        out = os.path.join(OUT_DIR, name + ".m4a")
        if (not force) and os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src):
            skip += 1
            continue
        cmd = [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", src,
               "-vn", "-map_metadata", "-1",               # 去掉封面 / 元数据继续瘦身
               "-ac", "1", "-ar", RATE,
               "-c:a", "aac", "-b:a", BITRATE,
               "-movflags", "+faststart", out]
        print("  压缩: %-34s %5.1f MB ->" % (name, os.path.getsize(src) / 1024.0 / 1024.0), end=" ")
        subprocess.run(cmd, check=True)
        print("%.2f MB" % (os.path.getsize(out) / 1024.0 / 1024.0))
        done += 1
    total = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR))
    print("完成: 新处理 %d 首, 跳过 %d 首, dist/music_built 共 %.2f MB（内嵌后 base64 约 %.1f MB）"
          % (done, skip, total / 1024.0 / 1024.0, total * 4 / 3 / 1024.0 / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
