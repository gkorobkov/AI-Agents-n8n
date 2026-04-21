@echo off
call "%~dp0build.cmd" %*
if errorlevel 1 exit /b 1
call "%~dp0deploy.cmd"
