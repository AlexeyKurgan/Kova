$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$missing = @()

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ((Test-Path (Join-Path $cargoBin "cargo.exe")) -and ($env:PATH -notlike "*$cargoBin*")) {
  $env:PATH = "$cargoBin;$env:PATH"
}

function Test-Tool($name, $command) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    $script:missing += $name
    Write-Host ("[ ] {0} - not found ({1})" -f $name, $command)
    return $false
  }
  return $true
}

Write-Output "Kova Hub setup"
Write-Output "=============="

$hasNode = Test-Tool "Node.js 20+" "node"
$hasPython = Test-Tool "Python 3.11+" "python"
$hasRust = Test-Tool "Rust (rustc)" "rustc"
Test-Tool "npm" "npm" | Out-Null

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
$hasMsvc = $false
if (Test-Path $vswhere) {
  $vcPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  $hasMsvc = [bool]$vcPath
}
if ($hasMsvc) {
  Write-Host "[x] Visual Studio C++ build tools"
} else {
  $missing += "Visual Studio C++ build tools"
  Write-Host "[ ] Visual Studio C++ build tools - not found"
}

if ($hasNode) {
  $nodeVersion = (& node --version).TrimStart("v")
  $nodeMajor = [int]($nodeVersion.Split(".")[0])
  if ($nodeMajor -lt 20) {
    Write-Host "[ ] Node.js $nodeVersion is too old - 20 or newer is required"
    if ($missing -notcontains "Node.js 20+") { $missing += "Node.js 20+" }
  } else {
    Write-Host "[x] Node.js $nodeVersion"
  }
}

if ($hasPython) {
  $pythonVersion = ((& python --version 2>&1) -replace "^Python\s+", "").Trim()
  $parts = $pythonVersion.Split(".")
  $pythonMinor = 0
  if ($parts.Length -ge 2) { $pythonMinor = [int]$parts[1] }
  if ($pythonMinor -lt 11) {
    Write-Host "[ ] Python $pythonVersion is too old - 3.11 or newer is required"
    if ($missing -notcontains "Python 3.11+") { $missing += "Python 3.11+" }
  } else {
    Write-Host "[x] Python $pythonVersion"
  }
}

if ($hasRust) {
  Write-Host "[x] $((& rustc --version))"
}

if ($missing.Count -gt 0) {
  Write-Output ""
  Write-Output "Install the missing prerequisites, then run this script again."
  Write-Output "Windows Package Manager (winget) commands:"
  Write-Output ""
  Write-Output "  winget install --id Git.Git -e"
  Write-Output "  winget install --id OpenJS.NodeJS.LTS -e"
  Write-Output "  winget install --id Python.Python.3.12 -e"
  Write-Output "  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override `"--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended`""
  Write-Output "  winget install --id Rustlang.Rustup -e"
  Write-Output "  winget install --id Microsoft.EdgeWebView2Runtime -e"
  Write-Output ""
  Write-Output "After installing Rust: rustup default stable-msvc"
  Write-Output "The Visual Studio Build Tools workload requires administrator rights."
  exit 1
}

Write-Output ""
Write-Output "Installing JavaScript dependencies..."
Push-Location $root
try {
  & npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

  Write-Output ""
  Write-Output "Installing the Python core..."
  & python -m pip install -e ./core
  if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
} finally {
  Pop-Location
}

Write-Output ""
Write-Output "Setup complete."
Write-Output "  Development:    scripts\dev.ps1"
Write-Output "  Production:     scripts\build.ps1, then scripts\run-app.ps1"
Write-Output "  Core only:      scripts\run-core.ps1"
