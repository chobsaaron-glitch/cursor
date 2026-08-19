# Starts FrameWorkshop on http://localhost:3000 and opens the browser.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = Split-Path -Parent $PSScriptRoot
}

$Marker = Join-Path $Root ".fw-installed"
$PidFile = Join-Path $Root ".fw-server.pid"

if (-not (Test-Path $Marker)) {
  Write-Host "Сначала выполняется установка — это займёт несколько минут."
  & (Join-Path $PSScriptRoot "install.ps1")
}

Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne "Running" } | ForEach-Object {
  try { Start-Service $_.Name } catch {}
}

$guess = @(
  "C:\Program Files\PostgreSQL\16\bin",
  "C:\Program Files\PostgreSQL\17\bin",
  "C:\Program Files\PostgreSQL\15\bin"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($guess) { $env:Path = "$guess;$env:Path" }

function Test-PortOpen {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", 3000, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(300)
    if ($ok) { $client.EndConnect($iar) | Out-Null }
    $client.Close()
    return $ok
  } catch {
    return $false
  }
}

if (Test-PortOpen) {
  Write-Host "Сервер уже запущен на http://localhost:3000"
  Start-Process "http://localhost:3000"
  return
}

if (-not (Test-Path (Join-Path $Root ".next"))) {
  Write-Host "Сборка приложения…"
  Push-Location $Root
  npm run build
  Pop-Location
}

Write-Host "Запуск FrameWorkshop на http://localhost:3000"
Write-Host "Это окно можно свернуть. Закрытие окна остановит программу."

$process = Start-Process -FilePath "npm" -ArgumentList "run","start","--","-H","127.0.0.1","-p","3000" `
  -WorkingDirectory $Root -PassThru -WindowStyle Hidden
Set-Content -Path $PidFile -Value $process.Id -Encoding ASCII

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  if (Test-PortOpen) { $ready = $true; break }
}
if (-not $ready) {
  throw "Сервер не открыл порт 3000. Смотрите журнал Next.js или запустите npm run start вручную."
}

Start-Process "http://localhost:3000"
Write-Host "Готово. Вход: admin@ramaisvet.ru / demo12345"
Write-Host "Нажмите Ctrl+C в этом окне, чтобы остановить сервер, либо закройте его."

try {
  Wait-Process -Id $process.Id
} finally {
  if (Test-Path $PidFile) { Remove-Item $PidFile -ErrorAction SilentlyContinue }
}
