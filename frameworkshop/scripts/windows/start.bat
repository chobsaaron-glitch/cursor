@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
if not exist "package.json" cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
