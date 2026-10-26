#!/usr/bin/env bash
# ============================================================
# 孤高旅斗 · 一键更新（拉代码 + 重启服务）
# ------------------------------------------------------------
# 用法：
#   ./update.sh                     更新并重启（默认端口 8123）
#   ./update.sh --port 9000         指定端口
#   ./update.sh --pull-only         只拉代码，不重启
#
# 为什么要这个脚本：
#   只 `git pull` 是**不够**的。HTML 是每次请求现读磁盘的，所以换了页面
#   不重启也「看着像更新成功」；但路由（/game.js /assets/ 这些）是进程
#   启动时定死的，老进程没有新路由 → 全 404 → 页面永远转圈。
#   所以更新 = 拉代码 + 重启，两件事必须一起做。
#
#   v4.25 起 server.py 自己也会盯源文件自动重启，跑这个脚本是更稳妥的做法
#   （能立刻看到启动日志，语法错误也会直接报出来）。
#
# 想全自动：把这行加到 crontab（每 5 分钟拉一次，没更新就秒退）
#   */5 * * * * cd /opt/gugaolvdou && ./update.sh >> update.log 2>&1
# ============================================================
set -e
cd "$(dirname "$0")"

PORT=8123
PULL_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    -p|--port)  PORT="$2"; shift 2 ;;
    --pull-only) PULL_ONLY=1; shift ;;
    *) shift ;;
  esac
done

echo "== 1/3 拉取代码 =="
BEFORE=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
git pull --ff-only
AFTER=$(git rev-parse --short HEAD 2>/dev/null || echo "?")

if [ "$BEFORE" = "$AFTER" ]; then
  echo "   已经是最新（$AFTER），无需重启"
  exit 0
fi
echo "   更新：$BEFORE -> $AFTER"

if [ "$PULL_ONLY" = "1" ]; then
  echo "== 只拉代码，跳过重启（--pull-only）=="
  exit 0
fi

echo "== 2/3 停止旧进程 =="
./stop.sh || true

echo "== 3/3 启动新进程 =="
./start.sh -d --port "$PORT"

sleep 1
echo ""
echo "== 自检 =="
# game.js / assets 是拆分版必需的；缺了页面就是白屏
for f in "孤高旅斗.html" "game.js" "assets"; do
  if [ -e "$f" ]; then echo "   ✓ $f"; else echo "   ✗ 缺少 $f  —— 用 dist/web/ 里的整套覆盖"; fi
done
echo "   日志：tail -f server.log"
echo "   状态：curl http://127.0.0.1:$PORT/status"
