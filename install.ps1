# Kova Hub one-line installer (Windows)
# powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/AlexeyKurgan/Kova/main/install.ps1 | iex"
$ErrorActionPreference = "Stop"
$repo = "AlexeyKurgan/Kova"
$headers = @{ "User-Agent" = "Kova-Hub-Installer" }
$work = Join-Path $env:TEMP "kova-install"
New-Item -ItemType Directory -Force -Path $work | Out-Null

Write-Host "Kova Hub: fetching latest release..."
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers $headers
$installerAsset = $release.assets |
  Where-Object { $_.name -like "*.exe" -and $_.name -notlike "*.msi" } |
  Select-Object -First 1
if (-not $installerAsset) {
  throw "No .exe installer in the latest release"
}

$manifestAsset = $release.assets | Where-Object { $_.name -eq "manifest.json" } | Select-Object -First 1
$expected = $null
if ($manifestAsset) {
  $manifestPath = Join-Path $work "manifest.json"
  Invoke-WebRequest $manifestAsset.browser_download_url -OutFile $manifestPath -Headers $headers
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $expected = ($manifest.files | Where-Object { $_.name -eq $installerAsset.name } | Select-Object -First 1)
}

$target = Join-Path $work $installerAsset.name
Write-Host "Kova Hub: downloading $($installerAsset.name)..."
Invoke-WebRequest $installerAsset.browser_download_url -OutFile $target -Headers $headers
Unblock-File $target
if ($expected) {
  $actual = (Get-FileHash -Algorithm SHA256 -Path $target).Hash.ToLowerInvariant()
  if ($actual -ne $expected.sha256) {
    Remove-Item $target -Force
    throw "Installer SHA256 does not match manifest.json"
  }
  Write-Host "Kova Hub: SHA256 verified"
}

Get-Process kova-hub,kova-core -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Kova Hub: installing..."
$proc = Start-Process -FilePath $target -ArgumentList "/S" -Wait -PassThru
if ($proc.ExitCode -ne 0) {
  Write-Host "Silent install failed ($($proc.ExitCode)); starting normal installer..."
  Start-Process -FilePath $target -Wait
}

$roots = @(
  (Join-Path $env:LOCALAPPDATA "Programs\Kova Hub"),
  (Join-Path $env:LOCALAPPDATA "Kova Hub"),
  (Join-Path $env:ProgramFiles "Kova Hub")
)
$exe = $null
foreach ($root in $roots) {
  if (Test-Path $root) {
    $exe = Get-ChildItem $root -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match "kova" } |
      Select-Object -First 1
    if ($exe) { break }
  }
}
if (-not $exe) {
  $exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs") -Filter "kova-hub.exe" -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
}
if (-not $exe) { throw "Kova Hub installed, but the executable was not found" }

Write-Host "Kova Hub: launching..."
Start-Process -FilePath $exe.FullName
Write-Host "Done."
