@echo off
setlocal

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

echo [Codex] Project: %PROJECT_DIR%
echo [Codex] Mode: approval=never, sandbox=workspace-write

codex -C "%PROJECT_DIR%" -a never -s workspace-write %*

endlocal
