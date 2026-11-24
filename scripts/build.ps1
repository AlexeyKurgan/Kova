$root = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ((Test-Path $cargoBin) -and ($env:PATH -notlike "*$cargoBin*")) {
  $env:PATH = "$cargoBin;$env:PATH"
}

$sidecar = Join-Path $root "apps\desktop\src-tauri\binaries\kova-core-x86_64-pc-windows-msvc.exe"
if ($env:KOVA_SKIP_CORE_BUILD -ne "1") {
  & (Join-Path $PSScriptRoot "build-core.ps1")
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Core sidecar build failed"
    exit 1
  }
} elseif (-not (Test-Path $sidecar)) {
  Write-Error "Sidecar is missing and KOVA_SKIP_CORE_BUILD=1 was set"
  exit 1
}

Push-Location (Join-Path $root "apps\desktop")
try {
  npx tauri build
} finally {
  Pop-Location
}
