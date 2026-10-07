@echo off
rem Zentro Print Bridge - silent start for a POS terminal.
rem Runs the standalone agent (.exe) with no window. Falls back to Python
rem (pythonw, then minimized python) when run from a dev checkout.
rem
rem One-click setup instead of this file:
rem   setup-print-agent.bat   (download it to the terminal and double-click)
rem
rem Uninstall:
rem   del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ZentroPrintAgent.vbs"
rem   rd /s /q "%LOCALAPPDATA%\ZentroPrintAgent"

cd /d "%~dp0"

if exist "%~dp0zentro-print-agent.exe" (
  start "" "%~dp0zentro-print-agent.exe" --port 8950
  exit /b 0
)

rem Prefer pythonw (no window at all); fall back to a minimized python window.
where pythonw.exe >nul 2>nul
if %errorlevel%==0 (
  start "" pythonw.exe print_agent.py --port 8950
  exit /b 0
)

where python.exe >nul 2>nul
if %errorlevel%==0 (
  start "" /min python.exe print_agent.py --port 8950
  exit /b 0
)

echo [print-agent] No agent executable or Python found. Run setup-print-agent.bat.
exit /b 1