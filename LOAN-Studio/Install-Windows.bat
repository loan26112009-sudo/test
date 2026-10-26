@echo off
chcp 65001 >nul
title LOAN Studio - installation
if not exist "%~dp0install\install.ps1" (
  echo.
  echo  [X] Fichiers introuvables. Extrais d abord le ZIP : clic droit sur le ZIP ^> Extraire tout,
  echo      puis relance Install-Windows.bat depuis le dossier extrait.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\install.ps1"
pause
