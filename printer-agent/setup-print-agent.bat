@echo off
rem ============================================================
rem  Zentro Print Agent - one-click setup for a POS terminal.
rem
rem  Installer options (pick ONE):
rem   1. Put zentro-print-agent.exe in the same folder as this file,
rem      then double-click this file. OR
rem   2. Set AGENT_URL below to where the exe is hosted (GitHub
rem      Release, Google Drive, your site, shared drive), then share
rem      / download only this one .bat - it fetches the exe itself.
rem
rem  No admin rights needed. It installs a silent Startup-folder
rem  launcher, so the agent starts at every login and prints from
rem  the POS with no internet.
rem ============================================================

setlocal
set "AGENT_URL="
set "APP_DATA=%LOCALAPPDATA%\ZentroPrintAgent"
set "EXE=%APP_DATA%\zentro-print-agent.exe"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP%\ZentroPrintAgent.vbs"

echo.
echo Doing Zentro Print Agent setup...
if not exist "%APP_DATA%" mkdir "%APP_DATA%"

rem --- 1. Find the agent exe ------------------------------------
if exist "%EXE%" goto :have_exe
if exist "%~dp0zentro-print-agent.exe" (
    copy /Y "%~dp0zentro-print-agent.exe" "%EXE%" >nul
    goto :have_exe
)
if "%AGENT_URL%"=="" (
    echo [error] zentro-print-agent.exe was not found next to this file,
    echo and AGENT_URL is empty. Either drop the exe here or set AGENT_URL.
    echo.
    pause
    exit /b 1
)
echo Downloading the agent...
curl -fSL -o "%EXE%" "%AGENT_URL%"
if errorlevel 1 (
    echo [error] Download failed. Check AGENT_URL and your internet.
    echo.
    pause
    exit /b 1
)

:have_exe
rem --- 2. Auto-start at every login (Startup folder, no admin) ----
echo Installing start-at-login launcher...
if not exist "%STARTUP%" mkdir "%STARTUP%"
if not exist "%~dp0launch-agent.vbs" (
    echo [error] launch-agent.vbs is missing - copy it next to this file.
    echo.
    pause
    exit /b 1
)
copy /Y "%~dp0launch-agent.vbs" "%LAUNCHER%" >nul

rem --- 3. Start it now (silently, no window) ----------------------
taskkill /IM zentro-print-agent.exe /F >nul 2>nul
cscript //nologo //B "%LAUNCHER%"

rem --- 4. Confirm it is alive --------------------------------------
ping -n 3 127.0.0.1 >nul
curl -fsS http://127.0.0.1:8950/health >nul
if errorlevel 1 (
    echo [error] Agent is not answering yet. Re-run this file after a few seconds.
    echo.
    pause
    exit /b 1
)

echo.
echo Done! Zentro Print Agent is installed and running.
echo  - Starts automatically at every login: yes
echo  - Prints from the POS with no internet needed: yes
echo.
pause
exit /b 0