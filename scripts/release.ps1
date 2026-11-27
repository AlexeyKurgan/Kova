param(
  [string]$Version = $(if ($env:KOVA_VERSION) { $env:KOVA_VERSION } else { "0.0.0" }),
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$bundle = Join-Path $root "apps\desktop\src-tauri\target\release\bundle"
$release = Join-Path $root "release"

if (-not $SkipBuild) {
  & (Join-Path $PSScriptRoot "build.ps1")
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
}

$files = @()
foreach ($pattern in @("msi\*.msi", "nsis\*.exe")) {
  $rows = Get-ChildItem (Join-Path $bundle $pattern) -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($rows) { $files += $rows }
}
if ($files.Count -eq 0) { throw "no installer artifacts found" }

& (Join-Path $PSScriptRoot "sign-release.ps1") -Paths ($files | ForEach-Object { $_.FullName })

New-Item -ItemType Directory -Force -Path $release | Out-Null
$manifestFiles = foreach ($file in $files) {
  $hash = Get-FileHash -Algorithm SHA256 -Path $file.FullName
  [ordered]@{
    name = $file.Name
    size = $file.Length
    sha256 = $hash.Hash.ToLowerInvariant()
  }
}

$signed = -not [string]::IsNullOrEmpty($env:KOVA_SIGN_PFX) -or -not [string]::IsNullOrEmpty($env:KOVA_SIGN_THUMBPRINT)
$manifest = [ordered]@{
  version = $Version
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  signed = $signed
  files = @($manifestFiles)
}
$target = Join-Path $release "manifest.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $target
Write-Output "Release manifest: $target"
Get-Content $target
