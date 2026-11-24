$root = Split-Path -Parent $PSScriptRoot
$coreDir = Join-Path $root "core"
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
  Write-Error "python not found in PATH"
  exit 1
}

$existing = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output "Core is already listening on 8765"
  exit 0
}

$logDir = Join-Path $env:TEMP "opencode"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$process = Start-Process -FilePath $python -ArgumentList "-m", "kova_core" -WorkingDirectory $coreDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir "kova-core.out.log") -RedirectStandardError (Join-Path $logDir "kova-core.err.log")
Start-Sleep -Seconds 4

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 5
  Write-Output "Core PID: $($process.Id) - $($health.status)"
} catch {
  Write-Output "Core failed to start"
  Get-Content (Join-Path $logDir "kova-core.err.log") -ErrorAction SilentlyContinue | Select-Object -Last 40
  exit 1
}
