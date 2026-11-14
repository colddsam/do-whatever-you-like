$ErrorActionPreference = "Stop"

$backendDir = Join-Path $PSScriptRoot "backend"
$frontendDir = Join-Path $PSScriptRoot "frontend"
$venvDir = Join-Path $backendDir "venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$requirementsFile = Join-Path $backendDir "requirements.txt"
$nodeModulesDir = Join-Path $frontendDir "node_modules"

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "Backend virtual environment not found. Creating venv and installing requirements.txt..." -ForegroundColor Cyan
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 -m venv $venvDir
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -m venv $venvDir
    } else {
        throw "Python was not found on PATH. Install Python 3.11+ and try again."
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPython)) {
        throw "Failed to create Python virtual environment at $venvDir."
    }

    & $venvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upgrade pip inside $venvDir."
    }

    & $venvPython -m pip install -r $requirementsFile
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install backend dependencies from $requirementsFile."
    }
}


if (-not (Test-Path -LiteralPath $nodeModulesDir)) {
    Write-Host "Frontend node_modules not found. Running npm install..." -ForegroundColor Cyan
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm was not found on PATH. Install Node.js 20+ and try again."
    }
    Push-Location -LiteralPath $frontendDir
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed in $frontendDir."
        }
    } finally {
        Pop-Location
    }
}

$backendCmd = "Set-Location -LiteralPath '$backendDir'; if (Test-Path '.\venv\Scripts\Activate.ps1') { try { . '.\venv\Scripts\Activate.ps1' } catch {} }; .\venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --proxy-headers"
$frontendCmd = "Set-Location -LiteralPath '$frontendDir'; npm run dev"

$backend = Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -PassThru
$frontend = Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -PassThru
"$($backend.Id),$($frontend.Id)" | Out-File -LiteralPath (Join-Path $PSScriptRoot ".dev-pids")
