#!/usr/bin/env bash
# ============================================================
# 孤高旅斗 · Linux 服务器一键启动
# ------------------------------------------------------------
# 用法：
#   ./start.sh                 前台运行（Ctrl+C 停止，日志直接打印）
#   ./start.sh -d              后台运行（日志写 server.log，用 ./stop.sh 停止）
#   ./start.sh --port 9000     指定端口（默认 8123，被占用会自动顺延）
# ============================================================
set -e
cd "$(dirname "$0")"

PORT=8123
DAEMON=0
while [ $# -gt 0 ]; do
  case "$1" in
    -p|--port) PORT="$2"; shift 2 ;;
    -d|--daemon) DAEMON=1; shift ;;
    *) PORT="$1"; shift ;;          # 兼容直接写端口号
  esac
done

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "[错误] 找不到 python3，请先安装：sudo apt install python3（或 yum install python3）" >&2
  exit 1
fi

if [ "$DAEMON" = "1" ]; then
  nohup "$PY" server.py --server --port "$PORT" >> server.log 2>&1 &
  echo $! > server.pid
  sleep 1
  if kill -0 "$(cat server.pid)" 2>/dev/null; then
    echo "已后台启动（PID $(cat server.pid)）"
    echo "  日志：tail -f server.log"
    echo "  停止：./stop.sh"
    echo "  游戏：http://<本机IP或域名>:$PORT/"
  else
    echo "[错误] 启动失败，最近日志：" >&2
    tail -20 server.log >&2
    exit 1
  fi
else
  exec "$PY" server.py --server --port "$PORT"
fi
