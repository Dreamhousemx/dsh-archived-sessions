@echo off
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE if defined DSH_DIR if exist "%DSH_DIR%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" set "NODE=%DSH_DIR%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE (
  echo [ERROR] Node.js not found. Install Node.js or set DSH_DIR.
  pause
  exit /b 1
)
"%NODE%" "%HERE%lib\setup.cjs" repair %*
echo.
pause
