@echo off
setlocal
title Install SWARM Browser Wallet (developer)
cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this computer.
  echo   The SWARM wallet host runs on Node; install Node 20 or newer and run this again.
  echo.
  pause
  exit /b 1
)

node "%~dp0install.js" %*
echo.
pause
