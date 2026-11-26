$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$core = Join-Path $root "core"
$bin = Join-Path $root "apps\desktop\src-tauri\binaries"
$work = Join-Path $root "build\pyinstaller"
New-Item -ItemType Directory -Force -Path $bin, $work | Out-Null

$skills = Join-Path $core "kova_core/integrations/blender/skills"
$blender = Join-Path $core "kova_core/integrations/blender"
Push-Location $core
try {
  python -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --name kova-core `
    --distpath $bin `
    --workpath $work `
    --specpath $work `
    --add-data "$skills;kova_core/integrations/blender/skills" `
    --add-data "$blender/inspect_asset.py;kova_core/integrations/blender" `
    --add-data "$blender/addon;kova_core/integrations/blender/addon" `
    sidecar.py
} finally {
  Pop-Location
}

$triple = "x86_64-pc-windows-msvc"
$source = Join-Path $bin "kova-core.exe"
$target = Join-Path $bin "kova-core-$triple.exe"
if (-not (Test-Path $source)) {
  Write-Error "PyInstaller did not produce kova-core.exe"
  exit 1
}
Move-Item -Force $source $target
Write-Output "Sidecar: $target"
