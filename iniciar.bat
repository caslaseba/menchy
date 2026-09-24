@echo off
chcp 65001 >nul
title Menchy
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Instala Node.js desde https://nodejs.org y volve a abrir Menchy.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Primera vez: instalando Menchy...
  call npm install
  if errorlevel 1 (
    echo No se pudo instalar.
    pause
    exit /b 1
  )
)

echo.
echo Menchy esta arrancando. No cierres esta ventana.
echo.
node server.js
if errorlevel 1 pause
