$backend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; venv/Scripts/activate; uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --proxy-headers" -PassThru
$frontend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm run dev" -PassThru
"$($backend.Id),$($frontend.Id)" | Out-File "$PSScriptRoot\.dev-pids"
