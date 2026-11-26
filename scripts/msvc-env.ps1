# Portable MSVC/Windows SDK environment for local Kova builds.
# Used when Visual Studio Build Tools are not installed system-wide.
# The toolchain is optional; if it is missing this script does nothing.

$ErrorActionPreference = "SilentlyContinue"
$portableRoot = Join-Path $env:USERPROFILE "sdk"
$msvcBase = Join-Path $portableRoot "msvc\Contents\VC\Tools\MSVC"
$sdkBase = Join-Path $portableRoot "microsoft.windows.sdk.cpp"
$sdkLib = Join-Path $portableRoot "microsoft.windows.sdk.cpp.x64"

$msvc = Get-ChildItem $msvcBase -Directory | Sort-Object Name -Descending | Select-Object -First 1
$includeVersion = Get-ChildItem (Join-Path $sdkBase "c\Include") -Directory |
  Sort-Object Name -Descending |
  Select-Object -First 1

$llvmBin = Join-Path $env:USERPROFILE "scoop\apps\llvm\current\bin"
$llvmRc = Join-Path $llvmBin "llvm-rc.exe"
$link = if ($msvc) { Join-Path $msvc.FullName "bin\Hostx64\x64\link.exe" } else { "" }

if ($msvc -and $includeVersion -and (Test-Path $link) -and (Test-Path $llvmRc)) {
  $msvcBin = Split-Path $link
  $env:PATH = "$msvcBin;$llvmBin;" + $env:PATH
  $env:LIB = "$($msvc.FullName)\lib\x64;$portableRoot\msvc\stubs;$($sdkLib)\c\ucrt\x64;$($sdkLib)\c\um\x64;" + $env:LIB
  $env:INCLUDE = "$($msvc.FullName)\include;$($includeVersion.FullName)\ucrt;$($includeVersion.FullName)\um;$($includeVersion.FullName)\shared;$($includeVersion.FullName)\winrt;$($includeVersion.FullName)\cppwinrt;" + $env:INCLUDE
  $env:RC = $llvmRc
  if (-not $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER) {
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = $link
  }
  if (-not $env:RUSTFLAGS) {
    $env:RUSTFLAGS = "-C target-feature=+crt-static"
  }
  Write-Host "Using portable MSVC toolchain: $($msvc.Name)"
}
