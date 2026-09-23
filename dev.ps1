Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Starting Zentro Globe (Full Stack)...  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Backend:  http://127.0.0.1:8000" -ForegroundColor Yellow
Write-Host " Frontend: http://localhost:8080" -ForegroundColor Yellow
Write-Host " Admin:    http://127.0.0.1:8000/admin/" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

bun run dev
