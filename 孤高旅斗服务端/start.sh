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
  # --strict-port：端口被占就报错退出，不顺延到 8124。
  # 公网部署下顺延等于「换了地址但没人知道」，外面打到的还是旧进程。
  nohup "$PY" server.py --server --port "$PORT" --strict-port >> server.log 2>&1 &
  echo $! > server.pid
  sleep 1
  if kill -0 "$(cat server.pid)" 2>/dev/null; then
    echo "已后台启动（PID $(cat server.pid)）"
    echo "  日志：tail -f server.log"
    echo "  停止：./stop.sh"
    # 端口被占时 server.py 会自动顺延到 8124/8125…，而这里以前只打印请求的端口，
    # 于是「日志说 8123，实际在 8124」，外面访问 8123 打到的还是旧进程 ——
    # 这个坑排查了很久。从日志里把真实端口读出来。
    REAL=$(grep -o 'localhost:[0-9]*' server.log 2>/dev/null | tail -1 | cut -d: -f2)
    [ -z "$REAL" ] && REAL="$PORT"
    if [ "$REAL" != "$PORT" ]; then
      echo ""
      echo "  ⚠️  端口 $PORT 已被占用，实际监听的是 $REAL"
      echo "     对外地址要改成 :$REAL，否则访问 $PORT 打到的还是旧进程。"
      echo "     多半是上一个实例没被杀干净：pkill -f 'server.py --server' 再重启。"
      echo ""
    fi
    echo "  游戏：http://<本机IP或域名>:$REAL/"
  else
    echo "[错误] 启动失败，最近日志：" >&2
    tail -20 server.log >&2
    exit 1
  fi
else
  exec "$PY" server.py --server --port "$PORT"
fi
