<#
    Zentro Print Bridge - install as a start-at-login autostart.

    Copies the standalone agent into %LOCALAPPDATA%\ZentroPrintAgent and adds a
    silent Startup shortcut so it starts at every login - no admin rights, no
    console window, no Python needed.

    For staff the easiest path is the app: go to POS Settings -> Printers &
    Routing and click "Download print agent (Windows)", then run the file.
    This script is the same install from a terminal for repeat setups.

    Usage:
        powershell -ExecutionPolicy Bypass -File .\install-agent-task.ps1

    Uninstall:
        Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\ZentroPrintAgent.lnk" -Force
        Stop-Process -Name zentro-print-agent -Force
        Remove-Item -Recurse -Force "$env:LOCALAPPDATA\ZentroPrintAgent"
#>

$ErrorActionPreference = "Stop"

$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath  = Join-Path $agentDir "zentro-print-agent.exe"

if (-not (Test-Path -LiteralPath $exePath)) {
    Write-Error "zentro-print-agent.exe not found next to this script. Build it or copy it here first."
    exit 1
}

$appDir   = Join-Path $env:LOCALAPPDATA "ZentroPrintAgent"
$startup  = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$lnkPath  = Join-Path $startup "ZentroPrintAgent.lnk"

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
New-Item -ItemType Directory -Force -Path $startup | Out-Null
Copy-Item -Force $exePath (Join-Path $appDir "zentro-print-agent.exe")

$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($lnkPath)
$shortcut.TargetPath = Join-Path $appDir "zentro-print-agent.exe"
$shortcut.WorkingDirectory = $appDir
$shortcut.Save()

Get-Process zentro-print-agent -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process (Join-Path $appDir "zentro-print-agent.exe") -ArgumentList "--port 8950"
Start-Sleep -Seconds 2

try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:8950/health" -UseBasicParsing -TimeoutSec 3
    Write-Host "Installed. Agent health: $($health.Content)"
} catch {
    Write-Host "Installed, but agent is not answering yet (is port 8950 in use?)."
}