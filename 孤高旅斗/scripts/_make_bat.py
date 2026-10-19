# -*- coding: utf-8 -*-
"""生成双击启动用的 .bat。

关键坑：bat 必须是 CRLF + GBK。
用 LF 换行的话 cmd.exe 解析会出错，双击后窗口一闪而过 / 完全没反应；
用 UTF-8 存中文则 echo 出来是乱码。
所以这个文件存在的意义就是：想改 bat 内容请改这里，别手改 bat。
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LINES = [
    "@echo off",
    "cd /d \"%~dp0\"",
    "title 孤高旅斗 - 局域网服务器",
    "echo.",
    "echo   ==========================================================",
    "echo     孤高旅斗 - 局域网服务器（手机 / 平板 / 电脑都能连）",
    "echo   ==========================================================",
    "echo.",
    "set \"PY=C:\\Users\\one\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe\"",
    "if not exist \"%PY%\" set \"PY=C:\\Users\\one\\AppData\\Local\\Programs\\Python\\Python310\\python.exe\"",
    "if not exist \"%PY%\" set \"PY=python\"",
    "echo   正在启动，请稍候...",
    "echo   把窗口里显示的地址输进手机浏览器，或扫自动弹出的二维码。",
    "echo   （页面双端自适应：手机出摇杆按钮，电脑出键鼠，可一起联机）",
    "echo.",
    "\"%PY%\" scripts\\lan.py %1",
    "echo.",
    "echo   服务器已停止。",
    "pause",
]

BODY = "\r\n".join(LINES) + "\r\n"

targets = [
    os.path.join(ROOT, "启动局域网服务器.bat"),   # 中文名，双击友好
    os.path.join(ROOT, "start_lan.bat"),          # 英文名，防止中文路径/文件关联出问题
]
for out in targets:
    with open(out, "w", encoding="gbk", newline="\r\n") as f:
        f.write(BODY)
    d = open(out, "rb").read()
    print("%s  %d 字节  CRLF=%d 裸LF=%d"
          % (os.path.basename(out), len(d), d.count(b"\r\n"), d.count(b"\n") - d.count(b"\r\n")))
