@echo off
setlocal
title Uninstall SWARM Browser Wallet (developer)
cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js was not found, so the registry entries cannot be removed from here.
  echo   Remove them by hand under:
  echo     HKCU\Software\Google\Chrome\NativeMessagingHosts\green.swarm.wallet_host
  echo     HKCU\Software\Microsoft\Edge\NativeMessagingHosts\green.swarm.wallet_host
  echo     HKCU\Software\Chromium\NativeMessagingHosts\green.swarm.wallet_host
  echo.
  pause
  exit /b 1
)

node "%~dp0uninstall.js"
echo.
pause
