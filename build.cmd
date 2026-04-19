@echo off

set QUIET=0
if /i "%1"=="--quiet" set QUIET=1
if /i "%1"=="-q"      set QUIET=1

set ROOT=%~dp0
set BUILD_DIR=%ROOT%.build
set FRONTEND_SRC=%ROOT%frontend\index.html
set FRONTEND_DIR=%ROOT%frontend
set FRONTEND_DST=%BUILD_DIR%\frontend

if "%QUIET%"=="0" echo Build root: %ROOT%

if not exist "%FRONTEND_DST%" mkdir "%FRONTEND_DST%"

for /f "delims=" %%v in ('powershell -NoProfile -Command "$f='%FRONTEND_SRC%'; $c=[IO.File]::ReadAllText($f); if ($c -match 'APP_VERSION = ''([\d]+\.[\d]+\.)([\d]+)''') { $old=$Matches[0]; $ver=$Matches[1]+([int]$Matches[2]+1); $new='APP_VERSION = ''' + $ver + ''''; [IO.File]::WriteAllText($f,$c.Replace($old,$new)); $ver }"') do set APP_VER=%%v
if errorlevel 1 (
    echo ERROR: Failed to increment APP_VERSION
    exit /b 1
)

if "%QUIET%"=="0" echo [OK] Version: v%APP_VER%

xcopy /Y /Q "%FRONTEND_DIR%\*" "%FRONTEND_DST%\" >nul
if errorlevel 1 (
    echo ERROR: Failed to copy frontend files
    exit /b 1
)

if "%QUIET%"=="0" (
    echo [OK] Copying .\frontend\* --^> .\.build\frontend\
    for %%f in ("%FRONTEND_DIR%\*") do echo     .\frontend\%%~nxf
)
