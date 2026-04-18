@echo off
setlocal enabledelayedexpansion

scp -r ./.build/frontend/* user@server.ru:/home/user/folder/

rem rsync -avz ./.build/frontend/* user@server.ru:/home/user/folder/
