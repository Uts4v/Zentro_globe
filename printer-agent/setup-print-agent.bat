@echo off
rem ============================================================
rem  Zentro Print Agent - one-click setup for this terminal.
rem  Windows only. No admin rights, no Python, no console window.
rem
rem  When this file is downloaded from the web app, the app fills
rem  AGENT_URL with its own address automatically. You can also
rem  drop zentro-print-agent.exe next to this file instead.
rem
rem  What it does:
rem    1. Saves the agent to %LOCALAPPDATA%\ZentroPrintAgent
rem    2. Adds a silent Startup shortcut (auto-starts every login)
rem    3. Starts the agent now
rem    4. Confirms it answers on http://127.0.0.1:8950/health
rem
rem  Remove it later:
rem    del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ZentroPrintAgent.lnk"
rem    taskkill /IM zentro-print-agent.exe /F
rem    rd /s /q "%LOCALAPPDATA%\ZentroPrintAgent"
rem ============================================================

setlocal
set "AGENT_URL=__APP_ORIGIN__/printer-agent/zentro-print-agent.exe"
set "APP_DATA=%LOCALAPPDATA%\ZentroPrintAgent"
set "EXE=%APP_DATA%\zentro-print-agent.exe"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\ZentroPrintAgent.lnk"

echo.
echo Setting up Zentro Print Agent...

rem --- 1. Get the agent exe ------------------------------------
if not exist "%APP_DATA%" mkdir "%APP_DATA%"

if exist "%EXE%" goto :have_exe
if exist "%~dp0zentro-print-agent.exe" (
    copy /Y "%~dp0zentro-print-agent.exe" "%EXE%" >nul
    goto :have_exe
)
rem No local copy. If the placeholder is still there, this file was not
rem fetched from the web app, so there is no real download address yet.
if not "%AGENT_URL:__APP_ORIGIN__=%"=="%AGENT_URL%" (
    echo [error] This installer was not downloaded from the web app, so it has no
    echo download address. Put zentro-print-agent.exe next to this file, or
    echo re-download this file from the app.
    echo.
    pause
    exit /b 1
)

echo Downloading the agent...
curl -fSL -o "%EXE%" "%AGENT_URL%"
if errorlevel 1 (
    echo [error] Download failed. Check this computer's internet and try again.
    echo.
    pause
    exit /b 1
)

:have_exe
rem --- 2. Auto-start at every login (Startup shortcut, no admin) ---
echo Installing start-at-login shortcut...
if not exist "%STARTUP%" mkdir "%STARTUP%"
powershell -NoProfile -WindowStyle Hidden -Command "$ws=New-Object -ComObject WScript.Shell;$s=$ws.CreateShortcut('%LNK%');$s.TargetPath='%EXE%';$s.WorkingDirectory='%APP_DATA%';$s.Save()"
if errorlevel 1 (
    echo [error] Could not create the startup shortcut.
    echo.
    pause
    exit /b 1
)

rem --- 3. Start it now (silently, no window) ----------------------
taskkill /IM zentro-print-agent.exe /F >nul 2>nul
start "" "%EXE%" --port 8950

rem --- 4. Confirm it is alive --------------------------------------
echo Checking the agent...
ping -n 3 127.0.0.1 >nul
for /l %%i in (1,1,30) do (
    curl -fsS http://127.0.0.1:8950/health >nul 2>nul
    if not errorlevel 1 goto :alive
    ping -n 2 127.0.0.1 >nul
)
echo [error] Agent is not answering yet. Re-run this file after a few seconds.
echo.
pause
exit /b 1

:alive
echo.
echo Done! Zentro Print Agent is installed and running.
echo  - Starts automatically at every login: yes
echo  - Prints from the POS with no internet needed: yes
echo.
pause
exit /b 0