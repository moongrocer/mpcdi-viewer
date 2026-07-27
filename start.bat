@echo off
setlocal
title MPCDI Viewer

rem Run from this script's own folder, no matter where it was launched from.
pushd "%~dp0"

echo ============================================
echo   MPCDI Viewer - starting dev server
echo ============================================
echo.

rem --- Check for Node.js -------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on your PATH.
    echo         Install the LTS build from https://nodejs.org/ and try again.
    echo.
    goto :fail
)

for /f "delims=" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo Node.js %NODE_VERSION%

rem --- Install dependencies on first run ---------------------------------
if not exist "node_modules" (
    echo.
    echo First run detected - installing dependencies ^(this takes a minute^)...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. See the messages above.
        goto :fail
    )
)

rem --- Start Vite --------------------------------------------------------
echo.
echo Starting Vite on http://localhost:3000/ ...
echo Your browser should open automatically. Press Ctrl+C to stop.
echo.
call npm run dev
if errorlevel 1 goto :fail

popd
endlocal
exit /b 0

:fail
echo.
pause
popd
endlocal
exit /b 1
