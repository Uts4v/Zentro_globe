' Zentro Print Agent - silent launcher for the Startup folder.
' Run invisibly (window style 0) with no console and no admin rights.
' Installed by setup-print-agent.bat into:
'   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\
Set sh = CreateObject("WScript.Shell")
exe = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\ZentroPrintAgent\zentro-print-agent.exe"
sh.Run """" & exe & """ --port 8950", 0, False