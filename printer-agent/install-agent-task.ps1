<#
    Zentro Print Bridge - install as a start-at-login autostart.

    Copies the standalone agent into %LOCALAPPDATA%\ZentroPrintAgent and adds a
    silent Startup-folder launcher so it starts at every login - no admin
    rights, no console window, no Python needed.

    For staff the easiest path is setup-print-agent.bat (one double-click);
    this script is the same install from a terminal for repeat setups.

    Usage (run from the printer-agent folder):
        powershell -ExecutionPolicy Bypass -File .\install-agent-task.ps1

    To uninstall:
        schtasks /Delete /TN "Zentro Print Agent" /F   (legacy, harmless if absent)
        Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\ZentroPrintAgent.vbs" -Force
        Remove-Item -Recurse -Force "$env:LOCALAPPDATA\ZentroPrintAgent"
#>

$ErrorActionPreference = "Stop"

$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath  = Join-Path $agentDir "zentro-print-agent.exe"
$vbsPath  = Join-Path $agentDir "launch-agent.vbs"

if (-not (Test-Path -LiteralPath $exePath)) {
    Write-Error "zentro-print-agent.exe not found next to this script. Build it or copy it here first."
    exit 1
}
if (-not (Test-Path -LiteralPath $vbsPath)) {
    Write-Error "launch-agent.vbs not found next to this script."
    exit 1
}

$appDir   = Join-Path $env:LOCALAPPDATA "ZentroPrintAgent"
$startup  = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$launcher = Join-Path $startup "ZentroPrintAgent.vbs"

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
New-Item -ItemType Directory -Force -Path $startup | Out-Null
Copy-Item -Force $exePath (Join-Path $appDir "zentro-print-agent.exe")
Copy-Item -Force $vbsPath $launcher

Get-Process zentro-print-agent -ErrorAction SilentlyContinue | Stop-Process -Force
& cscript.exe //nologo //B $launcher
Start-Sleep -Seconds 2

try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:8950/health" -UseBasicParsing -TimeoutSec 3
    Write-Host "Installed. Agent health: $($health.Content)"
} catch {
    Write-Host "Installed, but agent is not answering yet (is port 8950 in use?)."
}