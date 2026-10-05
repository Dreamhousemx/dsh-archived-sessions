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
set "CLI="
if defined DSH_CLI if exist "%DSH_CLI%" set "CLI=%DSH_CLI%"
if not defined CLI if defined DSH_DIR if exist "%DSH_DIR%\resources\runtime\cli\bin\dsh.cmd" set "CLI=%DSH_DIR%\resources\runtime\cli\bin\dsh.cmd"
if not defined CLI for /f "delims=" %%i in ('where dsh 2^>nul') do if not defined CLI set "CLI=%%i"
if not defined CLI (
  echo [ERROR] the dsh CLI was not found. Set DSH_DIR or DSH_CLI.
  pause
  exit /b 1
)
"%NODE%" "%HERE%lib\setup.cjs" bundle-install --cli "%CLI%" %*
echo.
pause
