@echo off
chcp 65001 >nul
title Instalar Menchy
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Instala Node.js desde https://nodejs.org y volve a ejecutar este archivo.
  pause
  exit /b 1
)

echo Instalando Menchy...
call npm install
if errorlevel 1 (
  echo No se pudo instalar.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0crear-acceso.ps1"
echo.
echo Listo. En el escritorio quedo el acceso "Menchy".
echo Abrilo y deja esa ventana abierta para usarlo tambien desde el celular.
echo.
pause
