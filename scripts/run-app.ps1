$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "apps\desktop\src-tauri\target\release\kova-hub.exe"
if (-not (Test-Path $exe)) {
  Write-Error "Build the app first: scripts\build.ps1"
  exit 1
}
$sidecar = Join-Path $root "apps\desktop\src-tauri\target\release\kova-core.exe"
if (-not (Test-Path $sidecar)) {
  & (Join-Path $PSScriptRoot "run-core.ps1")
}
Start-Process -FilePath $exe
Write-Output "Kova Hub launched"
