@echo off
title VyapaarSetu - Cloud Mobile Access Tunnel
cd /d "%~dp0"

echo ======================================================================
echo           VYAPAARSETU - ANYWHERE MOBILE ACCESS LAUNCHER
echo ======================================================================
echo.
echo 1. Starting License Portal Server on port 5001...
start "License Server" /b node tools\server.mjs

echo 2. Generating secure public HTTPS link for your mobile phone...
echo.
echo Please wait 5 seconds while Cloudflare creates your private link...
echo.
npx cloudflared tunnel --url http://localhost:5001
pause
