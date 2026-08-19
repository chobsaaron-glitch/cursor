@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install.ps1"
if errorlevel 1 (
  echo.
  echo Установка не завершилась. Прочитайте сообщение выше.
  pause
  exit /b 1
)
echo.
echo Запускаем программу...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start.ps1"
pause
