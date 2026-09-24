@echo off
chcp 65001 >nul
title Permitir celular - Menchy
echo Esto permite que el celular se conecte a Menchy.
echo Si Windows pide permiso, acepta.
echo.
netsh advfirewall firewall add rule name="Menchy HTTP" dir=in action=allow protocol=TCP localport=3847
netsh advfirewall firewall add rule name="Menchy HTTPS" dir=in action=allow protocol=TCP localport=3848
if errorlevel 1 (
  echo.
  echo No se pudo. Cerra esta ventana, hace clic derecho en permitir-celular.bat
  echo y elegi "Ejecutar como administrador".
) else (
  echo.
  echo Listo. El celular ya puede entrar a Menchy.
)
echo.
pause
