$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot "run-core.ps1")
$exe = Join-Path $root "apps\desktop\src-tauri\target\release\kova-hub.exe"
if (-not (Test-Path $exe)) {
  Write-Error "Build the app first: scripts\build.ps1"
  exit 1
}
Start-Process -FilePath $exe
Write-Output "Kova Hub launched"
