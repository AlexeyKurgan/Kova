param(
  [Parameter(Mandatory = $true)]
  [string[]]$Paths,
  [string]$Timestamp = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

function Find-SignTool {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  if (Test-Path $kits) {
    $rows = Get-ChildItem $kits -Directory |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
      Where-Object { Test-Path $_ }
    if ($rows) { return @($rows)[0] }
  }
  $portable = Join-Path $env:USERPROFILE "sdk\microsoft.windows.sdk.cpp\c\bin"
  if (Test-Path $portable) {
    $rows = Get-ChildItem $portable -Directory |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
      Where-Object { Test-Path $_ }
    if ($rows) { return @($rows)[0] }
  }
  return ""
}

$signTool = Find-SignTool
if (-not $signTool) {
  Write-Host "signtool.exe not found - skipping code signing"
  return
}

$pfx = $env:KOVA_SIGN_PFX
$password = $env:KOVA_SIGN_PFX_PASSWORD
$thumbprint = $env:KOVA_SIGN_THUMBPRINT

if (-not $pfx -and -not $thumbprint) {
  Write-Host "KOVA_SIGN_PFX / KOVA_SIGN_THUMBPRINT is not set - skipping code signing"
  return
}

foreach ($path in $Paths) {
  if (-not (Test-Path $path)) {
    Write-Warning "skip missing file: $path"
    continue
  }
  $signArgs = @("sign", "/fd", "SHA256", "/tr", $Timestamp, "/td", "SHA256")
  if ($pfx) {
    $signArgs += @("/f", $pfx)
    if ($password) { $signArgs += @("/p", $password) }
  } else {
    $signArgs += @("/sha1", $thumbprint)
  }
  $signArgs += $path
  & $signTool @signArgs
  if ($LASTEXITCODE -ne 0) {
    throw "signtool failed for $path"
  }
  Write-Host "signed: $path"
}
