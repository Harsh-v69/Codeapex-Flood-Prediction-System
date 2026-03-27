@echo off
setlocal

cd /d "%~dp0python"
if exist "..\.venv\Scripts\python.exe" (
  "..\.venv\Scripts\python.exe" -m uvicorn api:app --host 127.0.0.1 --port 8000
) else (
  python -m uvicorn api:app --host 127.0.0.1 --port 8000
)
