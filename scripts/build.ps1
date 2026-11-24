$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root "apps\desktop")
try {
  npx tauri build
} finally {
  Pop-Location
}
