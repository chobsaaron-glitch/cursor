# Stops the FrameWorkshop Node process started by start.ps1.

Set-StrictMode -Version Latest
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = Split-Path -Parent $PSScriptRoot
}
$PidFile = Join-Path $Root ".fw-server.pid"

if (Test-Path $PidFile) {
  $procId = Get-Content $PidFile | Select-Object -First 1
  if ($procId) {
    Get-Process -Id $procId -ErrorAction SilentlyContinue | Stop-Process -Force
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Write-Host "FrameWorkshop остановлен."
