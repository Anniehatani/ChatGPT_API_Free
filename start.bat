@echo off
title ChatGPT Auto API & Scraper Tool
echo ===================================================
echo     ChatGPT Auto-Scraper & Free API Server
echo     Che do: Khong can dang nhap (Guest Mode)
echo     Tu dong dong popup [X] va Clear chat khi het han
echo ===================================================
echo.
echo Dang khoi dong server tai http://localhost:3000 ...
timeout /t 2 >nul
start http://localhost:3000
node server.js
pause
