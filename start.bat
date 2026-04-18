@echo off
title IPL Market Launcher
setlocal
cd /d "%~dp0"

echo.
echo  ==========================================
echo   IPL Market - Starting...
echo  ==========================================
echo.

echo  Clearing old processes on ports 3001 and 5173...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3001 "') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173 "') do taskkill /F /PID %%a 2>nul

echo  Starting backend server...
start "IPL Market - Backend" cmd /k "node server\index.js"

echo  Waiting for backend...
timeout /t 3 /nobreak >nul

echo  Starting frontend...
start "IPL Market - Frontend" cmd /k "npm --prefix client run dev"

echo  Waiting for frontend to compile (this takes ~8 seconds)...
timeout /t 8 /nobreak >nul

echo  Opening browser...
start "" http://localhost:5173

echo.
echo  ==========================================
echo   Done! App is open in your browser.
echo   Close the two server windows to stop.
echo  ==========================================
echo.
pause
