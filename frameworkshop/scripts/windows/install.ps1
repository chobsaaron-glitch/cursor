# FrameWorkshop ERP — first-time setup for a Windows PC.
# Installs Node.js and PostgreSQL if missing, creates the database, applies
# migrations, loads demo data and writes .env.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = Split-Path -Parent $PSScriptRoot
}
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  throw "Не найден package.json. Запускайте скрипт из поставки FrameWorkshop."
}

$Marker = Join-Path $Root ".fw-installed"
$EnvFile = Join-Path $Root ".env"
$DbName = "frameworkshop_dev"
$DbUser = "fw"
$DbPassword = "fw"
$DbPort = "5432"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WithWinget([string]$Id, [string]$Title) {
  if (-not (Test-Command "winget")) {
    throw "$Title не найден, а winget недоступен. Установите $Title вручную и запустите установку снова."
  }
  Write-Step "Установка $Title"
  & winget install --id $Id -e --accept-package-agreements --accept-source-agreements --disable-interactivity
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")
}

Write-Host "FrameWorkshop ERP — установка на этот компьютер"
Write-Host "Каталог: $Root"

if (-not (Test-Command "node")) {
  Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js"
  if (-not (Test-Command "node")) {
    throw "Node.js установлен, но не виден в PATH. Закройте окно и запустите Установить.bat ещё раз."
  }
}

$nodeVersion = (node -v).TrimStart("v").Split(".")[0]
if ([int]$nodeVersion -lt 20) {
  throw "Нужен Node.js 20 или новее. Сейчас $(node -v)."
}

$psql = Get-Command "psql" -ErrorAction SilentlyContinue
if (-not $psql) {
  $guess = @(
    "C:\Program Files\PostgreSQL\16\bin\psql.exe",
    "C:\Program Files\PostgreSQL\17\bin\psql.exe",
    "C:\Program Files\PostgreSQL\15\bin\psql.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($guess) {
    $env:Path = "$(Split-Path $guess);$env:Path"
    $psql = Get-Command "psql" -ErrorAction SilentlyContinue
  }
}

if (-not $psql) {
  Write-Host ""
  Write-Host "PostgreSQL не найден. Сейчас откроется установщик через winget." -ForegroundColor Yellow
  Write-Host "Если установщик спросит пароль суперпользователя — запомните его (для входа в psql)."
  Install-WithWinget "PostgreSQL.PostgreSQL.16" "PostgreSQL"
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")
  $guess = @(
    "C:\Program Files\PostgreSQL\16\bin",
    "C:\Program Files\PostgreSQL\17\bin",
    "C:\Program Files\PostgreSQL\15\bin"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($guess) { $env:Path = "$guess;$env:Path" }
}

if (-not (Test-Command "psql")) {
  throw "PostgreSQL установлен, но psql не в PATH. Перезапустите установку из нового окна."
}

Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne "Running" } | ForEach-Object {
  try { Start-Service $_.Name } catch { Write-Host "Не удалось запустить службу $($_.Name): $_" -ForegroundColor Yellow }
}

$PgPassword = $env:PGPASSWORD
if (-not $PgPassword) {
  Write-Host ""
  Write-Host "Нужен пароль суперпользователя PostgreSQL (обычно пользователь postgres)."
  $secure = Read-Host "Пароль postgres" -AsSecureString
  $PgPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
}
$env:PGPASSWORD = $PgPassword

Write-Step "Создание базы $DbName"

$check = & psql -U postgres -h 127.0.0.1 -p $DbPort -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName'" 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Не удалось подключиться к PostgreSQL как postgres. Проверьте пароль и что служба запущена.`n$check"
}

& psql -U postgres -h 127.0.0.1 -p $DbPort -d postgres -v ON_ERROR_STOP=1 -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DbUser') THEN CREATE USER $DbUser WITH PASSWORD '$DbPassword' CREATEDB; END IF; END `$`$;" | Out-Host
$exists = (& psql -U postgres -h 127.0.0.1 -p $DbPort -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName'").Trim()
if ($exists -ne "1") {
  & psql -U postgres -h 127.0.0.1 -p $DbPort -d postgres -c "CREATE DATABASE $DbName OWNER $DbUser;" | Out-Host
}

if (-not (Test-Path $EnvFile)) {
  Write-Step "Файл .env"
  $secretBytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
  $secret = [Convert]::ToBase64String($secretBytes)
  @"
DATABASE_URL="postgresql://${DbUser}:${DbPassword}@127.0.0.1:${DbPort}/${DbName}?schema=public"
AUTH_SECRET="$secret"
AUTH_SESSION_TTL=43200
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=./storage
STORAGE_PUBLIC_PREFIX=/api/files
NOTIFY_EMAIL_DRIVER=console
NOTIFY_SMS_DRIVER=console
NOTIFY_TELEGRAM_DRIVER=console
"@ | Set-Content -Path $EnvFile -Encoding UTF8
}

Write-Step "npm install"
Push-Location $Root
try {
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install завершился с ошибкой." }

  Write-Step "Миграции базы"
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw "Миграции Prisma не применились." }

  Write-Step "Демо-данные"
  npm run seed
  if ($LASTEXITCODE -ne 0) { throw "Не удалось загрузить демо-данные." }

  Write-Step "Сборка приложения"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Сборка Next.js не удалась." }
} finally {
  Pop-Location
}

Set-Content -Path $Marker -Value (Get-Date -Format "o") -Encoding UTF8

$Wsh = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$startMenu = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\FrameWorkshop"
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
$startBat = Join-Path $PSScriptRoot "start.bat"
foreach ($linkPath in @(
  (Join-Path $desktop "FrameWorkshop.lnk"),
  (Join-Path $startMenu "FrameWorkshop.lnk")
)) {
  $shortcut = $Wsh.CreateShortcut($linkPath)
  $shortcut.TargetPath = $startBat
  $shortcut.WorkingDirectory = $Root
  $shortcut.WindowStyle = 1
  $shortcut.Description = "FrameWorkshop ERP"
  $shortcut.Save()
}

Write-Host ""
Write-Host "Установка закончена." -ForegroundColor Green
Write-Host "Запуск: ярлык FrameWorkshop на рабочем столе или scripts\windows\start.ps1"
Write-Host "Вход: admin@ramaisvet.ru / demo12345"
Write-Host "Адрес: http://localhost:3000"
