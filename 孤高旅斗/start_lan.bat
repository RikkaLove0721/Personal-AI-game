@echo off
cd /d "%~dp0"
title 孤高旅斗 - 局域网服务器
echo.
echo   ==========================================================
echo     孤高旅斗 - 局域网服务器（手机 / 平板 / 电脑都能连）
echo   ==========================================================
echo.
set "PY=C:\Users\one\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PY%" set "PY=C:\Users\one\AppData\Local\Programs\Python\Python310\python.exe"
if not exist "%PY%" set "PY=python"
echo   正在启动，请稍候...
echo   把窗口里显示的地址输进手机浏览器，或扫自动弹出的二维码。
echo   （页面双端自适应：手机出摇杆按钮，电脑出键鼠，可一起联机）
echo.
"%PY%" scripts\lan.py %1
echo.
echo   服务器已停止。
pause
