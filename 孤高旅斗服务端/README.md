# 孤高旅斗 · Linux 服务端部署包

一个文件夹 = 一台服务器。不需要 Node、不需要数据库、不需要编译，
只需要系统里有 **Python 3**（纯标准库，零第三方依赖）。

## 包里有什么

| 文件 | 作用 |
|---|---|
| `server.py` | 游戏服务器：HTTP 页面 + WebSocket 房间转发（一台机器一个进程全搞定） |
| `孤高旅斗.html` | 游戏页面（单文件，**触屏 + 键盘通用**：手机/平板打开出摇杆，电脑打开出键鼠） |
| `balance.js` | 平衡数值配置（可选手改文件，改完重启生效；删掉也能跑，走内置默认值） |
| `start.sh` / `stop.sh` | 一键启动 / 停止 |
| `gugaolvdou.service` | systemd 开机自启模板 |
| `music/` | BGM 存放处（可选，放 .ogg 即可） |
| `profile.json` | 首次运行后自动生成：全局存档（金币/皮肤等） |

## 快速开始（3 条命令）

```bash
# 1. 上传整个文件夹到服务器（scp / sftp / 面板都行），比如放到 /opt/gugaolvdou
scp -r 孤高旅斗服务端 user@你的服务器IP:/opt/gugaolvdou

# 2. 给启动脚本执行权限并启动
cd /opt/gugaolvdou && chmod +x start.sh stop.sh
./start.sh                # 前台运行，先试跑；确认没问题后 Ctrl+C 换下面的方式

# 3. 后台常驻（推荐）
./start.sh -d             # 日志在 server.log，停止用 ./stop.sh
```

启动后控制台/日志会打印本机所有可用地址，朋友浏览器打开
`http://服务器IP:8123`（横屏）即可，创建房间 → 把「网址 + 房号」发给朋友。

## 开机自启（systemd）

见 `gugaolvdou.service` 文件头部注释，照抄即可。要点：
把 `WorkingDirectory` / `ExecStart` 里的路径改成实际目录，
并保证运行用户对包目录有**写权限**（存档要落盘）：

```bash
sudo chown -R www-data:www-data /opt/gugaolvdou
```

## 必须放行的端口

| 位置 | 端口 | 说明 |
|---|---|---|
| 云控制台「安全组 / 防火墙」 | TCP 8123 | 很多新手卡在这一步：系统防火墙开了，云厂商的安全组没开 |
| 系统防火墙 | TCP 8123 | `sudo ufw allow 8123/tcp`（Ubuntu）或 `firewall-cmd --add-port=8123/tcp --permanent && sudo firewall-cmd --reload`（CentOS） |

端口被占用时服务器会自动顺延（8124、8125…），实际端口以启动日志为准。

## 更新游戏版本

只替换 `孤高旅斗.html` 一个文件即可（页面是热加载的，重启服务进程更稳妥）：
本地 `dist/孤高旅斗.html` → 覆盖服务器同名文件 → `./stop.sh && ./start.sh -d`。
改过本地 `balance.js` 的话也要一起覆盖。

## 上 HTTPS（可选，推荐配域名后做）

页面本身走 HTTP 就能玩；但如果你想用域名 + HTTPS，WebSocket 也必须走
`wss`——好在客户端会自动判断（页面是 https 就自动用 wss），服务器无需改代码，
只要在 Nginx 反代时把 Upgrade 头透传给后端：

```nginx
server {
    listen 443 ssl;
    server_name game.example.com;                 # 换成你的域名
    # ssl_certificate / ssl_certificate_key 按你的证书填

    location / {
        proxy_pass http://127.0.0.1:8123;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;    # WebSocket 升级头，缺了联机不通
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;                  # 别让长连接几分钟就断
    }
}
```

配好后朋友一律用 `https://game.example.com` 访问，8123 端口可以不再对外开放。

## 已知边界

- **服务器无鉴权**：知道地址的任何人都能进房间，请勿部署在存放重要数据的机器上
- **断线重连未做**：手机切后台 / 网络抖动掉线后需刷新页面重进房间
- **帧率取决于玩家设备的浏览器**，服务器只做消息转发，压力很小（1 核 1G 的最低配云主机足够几个房间）

## 回家玩（不上公网）的替代

服务器在你自己电脑/宿舍设备上跑时，朋友不在同一网络可用 Tailscale：
所有人装 Tailscale 登录同一账号，互相用分配的 `100.x.x.x` 地址访问，零公网配置。
