# -*- coding: utf-8 -*-
"""孤高旅斗 · 背景音乐素材压缩

把用户提供的音乐库（默认 Desktop/Personal-AI-game/music）转成
适合内置分发的小体积 OGG(Vorbis)，输出到仓库 dist/music/。

- 编码: libvorbis -q:a 2 (约 64~70 kbps 立体声, BGM 场景足够)
- 采样率保持源文件; 已处理且源文件未更新的会跳过(幂等, 可反复跑)
- 依赖 ffmpeg: 优先用 venv 里的 imageio-ffmpeg 自带二进制
"""
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 仓库根
SRC_DIR = os.path.join(os.path.dirname(REPO), "music")               # Desktop/Personal-AI-game/music
OUT_DIR = os.path.join(REPO, "dist", "music")


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:                                # noqa: BLE001
        return "ffmpeg"                              # 退回 PATH 里的 ffmpeg


def main():
    if not os.path.isdir(SRC_DIR):
        print("找不到音乐素材目录: " + SRC_DIR)
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)
    ff = ffmpeg_exe()
    done, skip = 0, 0
    for name in sorted(os.listdir(SRC_DIR)):
        if not name.lower().endswith((".mp3", ".flac", ".wav", ".m4a")):
            continue
        src = os.path.join(SRC_DIR, name)
        out = os.path.join(OUT_DIR, os.path.splitext(name)[0] + ".ogg")
        if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src):
            skip += 1
            continue
        cmd = [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", src,
               "-vn", "-map_metadata", "-1",                       # 去掉封面/元数据进一步瘦身
               "-codec:a", "libvorbis", "-qscale:a", "2", out]
        print("处理: " + name)
        subprocess.run(cmd, check=True)
        done += 1
    total = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR))
    print("完成: 新处理 %d 首, 跳过 %d 首, dist/music 共 %.1f MB"
          % (done, skip, total / 1024 / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
