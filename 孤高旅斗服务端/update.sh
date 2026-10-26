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
# 想全自动：把这行加到 crontab（每 5 分钟看一眼，没更新会秒退）
#   */5 * * * * cd /opt/gugaolvdou && ./update.sh >> update.log 2>&1
# ============================================================
set -e
cd "$(dirname "$0")"

PORT=8123
PULL_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    -p|--port)   PORT="$2"; shift 2 ;;
    --pull-only) PULL_ONLY=1; shift ;;
    *) shift ;;
  esac
done

echo "== 1/4 拉取代码 =="
BEFORE=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
git pull --ff-only
AFTER=$(git rev-parse --short HEAD 2>/dev/null || echo "?")

if [ "$BEFORE" = "$AFTER" ]; then
  echo "   已经是最新（$AFTER），不重启"
  exit 0
fi
echo "   更新：$BEFORE -> $AFTER"

if [ "$PULL_ONLY" = "1" ]; then
  echo "== 只拉代码，跳过重启（--pull-only）=="
  exit 0
fi

echo "== 2/4 停止旧进程 =="
if systemctl list-units --full -all 2>/dev/null | grep -q "gugaolvdou.service"; then
  # 用 systemd 托管的话必须走 systemctl，直接 pkill 会被自动拉起、两个进程抢端口
  echo "   检测到 systemd 服务 gugaolvdou.service"
  if systemctl restart gugaolvdou 2>/dev/null; then
    echo "   已重启（systemd）"
  else
    sudo systemctl restart gugaolvdou
    echo "   已重启（systemd + sudo）"
  fi
else
  ./stop.sh || true
  sleep 1
  # 兜底：手工前台启动 / 没有 server.pid 的情况，stop.sh 停不掉，
  # 不杀干净的话新进程会因端口被占而顺延到 8124，访问地址就变了。
  if command -v pkill >/dev/null 2>&1 && pkill -f 'server.py --server' 2>/dev/null; then
    echo "   已兜底停止残留进程"
    sleep 1
  fi
  echo "== 3/4 启动新进程 =="
  ./start.sh -d --port "$PORT"
fi

echo "== 4/4 自检 =="
sleep 1
MISSING=0
for f in "孤高旅斗.html" "game.js" "assets"; do
  if [ -e "$f" ]; then
    echo "   ✓ $f"
  else
    echo "   ✗ 缺少 $f —— 请用 dist/web/ 里的整套覆盖"
    MISSING=1
  fi
done
if command -v curl >/dev/null 2>&1; then
  echo -n "   /status -> "
  curl -s -m 5 "http://127.0.0.1:$PORT/status" || echo "（取不到，看 server.log）"
  echo
fi
[ "$MISSING" = "0" ] && echo "   ✅ 更新完成：http://<本机IP>:$PORT/" || echo "   ⚠️ 有文件缺失，页面会白屏"
echo "   日志：tail -f server.log"
