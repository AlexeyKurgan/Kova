$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot "run-core.ps1")
Push-Location (Join-Path $root "apps\desktop")
try {
  npx tauri dev
} finally {
  Pop-Location
}
