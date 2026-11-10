$pidFile = "$PSScriptRoot\.dev-pids"

if (Test-Path $pidFile) {
    $pids = (Get-Content $pidFile) -split ','
    foreach ($id in $pids) {
        if ($id) {
            Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $pidFile -Force
    Write-Host "Both servers and terminal windows have been closed." -ForegroundColor Green
} else {
    Write-Host "No active dev server PIDs found." -ForegroundColor Yellow
}