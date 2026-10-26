#!/usr/bin/env bash
# 孤高旅斗 · 停止后台服务器（配合 ./start.sh -d 使用）
cd "$(dirname "$0")"
if [ -f server.pid ]; then
  PID="$(cat server.pid)"
  if kill "$PID" 2>/dev/null; then
    echo "已停止（PID $PID）"
  else
    echo "进程 $PID 已不存在"
  fi
  rm -f server.pid
else
  echo "没有 server.pid。如果是手动前台启动的，直接 Ctrl+C；"
  echo "实在找不到进程可用：pkill -f 'server.py --server'"
fi
