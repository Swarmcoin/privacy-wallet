@echo off
rem swarm-wallet-host launcher.
rem
rem Chromium starts a native-messaging host by running the path in the host
rem manifest with stdin and stdout wired to two named pipes. On Windows it does
rem that through cmd.exe unless the path ends in .exe, so a .cmd here is
rem launched the same way in Chrome, Edge and Chromium
rem (chrome/browser/extensions/api/messaging/launch_context_win.cc, read
rem 2026-09-26: LaunchNativeExeDirectly is used only for ".exe", everything else
rem goes through LaunchNativeHostViaCmd).
rem
rem NOTHING in this file may print. Whatever reaches stdout is read by the
rem browser as a 32-bit message length, and one stray character closes the port.
setlocal
set "SWARM_HOST_BIN=%~dp0"
set "SWARM_NODE=node.exe"
if exist "%SWARM_HOST_BIN%node.path" (
  for /f "usebackq tokens=* delims=" %%N in ("%SWARM_HOST_BIN%node.path") do set "SWARM_NODE=%%N"
)
"%SWARM_NODE%" "%SWARM_HOST_BIN%..\src\main.js"
exit /b %ERRORLEVEL%
