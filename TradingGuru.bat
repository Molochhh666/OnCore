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
set "PY_VERSION="
where py >nul 2>nul
if not errorlevel 1 (
  call :try_python 3.14
  call :try_python 3.13
  call :try_python 3.12
  call :try_python 3.11
  call :try_python 3.10
  call :try_python 3.9
  call :try_python 3.8
)
if not defined PY_LAUNCHER call :try_system_python
if not defined PY_LAUNCHER goto compatible_python_required

:python_selected
set "VENV_PATH=.venv-%PY_VERSION%"
set "VENV_PYTHON=%VENV_PATH%\Scripts\python.exe"
if not exist "%VENV_PYTHON%" (
  echo Setting up TradingGuru. This only happens once...
  %PY_LAUNCHER% -m venv "%VENV_PATH%"
  if not exist "%VENV_PYTHON%" goto python_setup_error
)
set "VENV_VERSION="
for /f %%V in ('"%VENV_PYTHON%" -c "import sys; print(str(sys.version_info[0])+'.'+str(sys.version_info[1]))" 2^>nul') do set "VENV_VERSION=%%V"
if not "%VENV_VERSION%"=="%PY_VERSION%" goto python_setup_error

"%VENV_PYTHON%" -c "import MetaTrader5" >nul 2>&1
if errorlevel 1 (
  echo Installing the free MetaTrader 5 data connector...
  "%VENV_PYTHON%" -m pip install MetaTrader5
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
"%VENV_PYTHON%" server.py
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

:try_python
if defined PY_LAUNCHER exit /b 0
set "PY_CANDIDATE="
for /f "tokens=2" %%V in ('py -%~1 --version 2^>nul') do set "PY_CANDIDATE=%%V"
if not defined PY_CANDIDATE exit /b 0
for /f "tokens=1,2 delims=." %%A in ("%PY_CANDIDATE%") do set "PY_CHECK_VERSION=%%A.%%B"
if not "%PY_CHECK_VERSION%"=="%~1" exit /b 0
set "PY_ARCH_CHECK="
for /f %%V in ('py -%~1 -c "import platform,struct; print('TG_X64' if platform.machine().lower() in ('amd64','x86_64') and struct.calcsize('P') == 8 else 'TG_NO')" 2^>nul') do set "PY_ARCH_CHECK=%%V"
if /i not "%PY_ARCH_CHECK%"=="TG_X64" exit /b 0
set "PY_LAUNCHER=py -%~1"
set "PY_VERSION=%~1"
exit /b 0

:try_system_python
where python >nul 2>nul
if errorlevel 1 exit /b 0
set "PY_CANDIDATE="
for /f "tokens=2" %%V in ('python --version 2^>nul') do set "PY_CANDIDATE=%%V"
if not defined PY_CANDIDATE exit /b 0
for /f "tokens=1,2 delims=." %%A in ("%PY_CANDIDATE%") do set "PY_VERSION=%%A.%%B"
set "PY_ARCH_CHECK="
for /f %%V in ('python -c "import platform,struct,sys; print('TG_X64' if (3,8) <= sys.version_info[:2] < (3,15) and platform.machine().lower() in ('amd64','x86_64') and struct.calcsize('P') == 8 else 'TG_NO')" 2^>nul') do set "PY_ARCH_CHECK=%%V"
if /i not "%PY_ARCH_CHECK%"=="TG_X64" exit /b 0
set "PY_LAUNCHER=python"
exit /b 0

:compatible_python_required
where py >nul 2>nul
if errorlevel 1 goto python_download_page
py help install >nul 2>&1
if errorlevel 1 goto python_download_page
echo A compatible 64-bit Python version is needed for the MT5 connector.
echo The Python installer can add Python 3.14 alongside your current version.
choice /m "Download and install Python 3.14 now"
if errorlevel 2 goto python_download_page
py install 3.14
if errorlevel 1 goto python_download_page
call :try_python 3.14
if not defined PY_LAUNCHER goto python_download_page
goto python_selected

:python_download_page
echo TradingGuru needs 64-bit Python 3.8 through 3.14 for the MT5 connector.
echo Opening the official Python 3.14 download page.
start "" "https://www.python.org/downloads/release/python-31410/"
echo Install the Windows installer marked 64-bit, then double-click TradingGuru.bat again.
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
echo Could not install the MT5 connector. It needs 64-bit Python 3.8 through 3.14 on Windows x64.
echo Check your internet connection and confirm that TradingGuru selected a supported Python version.
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

