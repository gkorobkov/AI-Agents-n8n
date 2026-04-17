@echo off
setlocal enabledelayedexpansion

:: Usage: build [--quiet | -q]
set QUIET=0
if /i "%1"=="--quiet" set QUIET=1
if /i "%1"=="-q" set QUIET=1

set ROOT=%~dp0
set BUILD_DIR=%ROOT%.build

if "!QUIET!"=="0" echo Build root: !ROOT!

:: Frontend
set FRONTEND_DST=!BUILD_DIR!\frontend\index.html
if not exist "!BUILD_DIR!\frontend" mkdir "!BUILD_DIR!\frontend"

copy /Y "!ROOT!frontend\n8n-chat.html" "!FRONTEND_DST!" >nul
if errorlevel 1 (
    echo ERROR: Failed to copy frontend\n8n-chat.html
    exit /b 1
)

if "!QUIET!"=="0" echo [OK] Copying .\frontend\n8n-chat.html --^> .\.build\frontend\index.html
