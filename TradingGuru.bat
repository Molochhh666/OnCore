@echo off
setlocal
cd /d "%~dp0"
title TradingGuru Setup and Launcher

echo.
echo  TradingGuru - first-time setup and launcher
echo  Keep this window open while you use the app.
echo.

if not exist "config.json" (
  copy /y "config.example.json" "config.json" >nul
  if errorlevel 1 goto config_error
  echo Created private settings for this PC.
)

set "PY_LAUNCHER="
where py >nul 2>nul
if not errorlevel 1 (
  py -3 --version >nul 2>&1
  if not errorlevel 1 set "PY_LAUNCHER=py -3"
)
if not defined PY_LAUNCHER (
  where python >nul 2>nul
  if not errorlevel 1 (
    python --version >nul 2>&1
    if not errorlevel 1 set "PY_LAUNCHER=python"
  )
)
if not defined PY_LAUNCHER goto missing_python

if not exist ".venv\Scripts\python.exe" (
  echo Setting up TradingGuru. This only happens once...
  %PY_LAUNCHER% -m venv .venv
  if errorlevel 1 goto python_setup_error
)

".venv\Scripts\python.exe" -c "import MetaTrader5" >nul 2>&1
if errorlevel 1 (
  echo Installing the free MetaTrader 5 data connector...
  ".venv\Scripts\python.exe" -m pip install MetaTrader5
  if errorlevel 1 goto mt5_install_error
)

call :ensure_ollama
if errorlevel 2 goto missing_ollama
if errorlevel 1 goto ollama_start_error

ollama show qwen2.5:3b >nul 2>&1
if errorlevel 1 (
  echo.
  echo Downloading the free local AI model (about 2 GB, first run only)...
  echo Please keep this window open until the download finishes.
  ollama pull qwen2.5:3b
  if errorlevel 1 goto model_download_error
)

echo.
echo Starting TradingGuru at http://127.0.0.1:8765
start "" "http://127.0.0.1:8765"
".venv\Scripts\python.exe" server.py
echo.
echo TradingGuru has stopped. You can close this window.
pause
exit /b 0

:ensure_ollama
where ollama >nul 2>nul
if errorlevel 1 exit /b 2
ollama list >nul 2>&1
if not errorlevel 1 exit /b 0
echo Starting Ollama's local AI service...
start "TradingGuru AI" /min ollama serve
set /a ollama_attempts=0
:wait_for_ollama
ollama list >nul 2>&1
if not errorlevel 1 exit /b 0
set /a ollama_attempts+=1
if %ollama_attempts% GEQ 15 exit /b 1
timeout /t 2 /nobreak >nul
goto wait_for_ollama

:missing_python
echo Python 3 is needed. Opening the official Python download page.
start "" "https://www.python.org/downloads/windows/"
echo Install Python 3, then double-click TradingGuru.bat again.
pause
exit /b 1

:missing_ollama
echo Ollama is needed for the free local AI. Opening its official download page.
start "" "https://ollama.com/download/windows"
echo Install Ollama, then double-click TradingGuru.bat again.
pause
exit /b 1

:config_error
echo Could not create private settings. Make sure you extracted the ZIP first.
pause
exit /b 1

:python_setup_error
echo Could not set up Python for TradingGuru. Reinstall Python 3 and try again.
pause
exit /b 1

:mt5_install_error
echo Could not install the MT5 data connector. Check your internet connection and try again.
pause
exit /b 1

:ollama_start_error
echo Ollama did not start. Open Ollama from the Windows Start menu, then try again.
pause
exit /b 1

:model_download_error
echo The AI model download did not finish. Check your internet connection and try again.
pause
exit /b 1

