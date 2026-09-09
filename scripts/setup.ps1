# Run in native Windows PowerShell: powershell -File scripts/setup.ps1
$ErrorActionPreference = 'Stop'
$AidawRoot = Split-Path $PSScriptRoot -Parent
function Refresh-AidawPath {
  $AidawMachinePath = [Environment]::GetEnvironmentVariable('Path','Machine')
  $AidawUserPath = [Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = "$AidawMachinePath;$AidawUserPath;$env:Path"
}
function Install-AidawPackage([string]$Id, [string[]]$Extra = @()) {
  if (!(Get-Command winget -ErrorAction SilentlyContinue)) { throw "winget is required to install $Id. Install Windows App Installer or the missing dependency, then rerun." }
  & winget install --id $Id --exact --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity @Extra
  if ($LASTEXITCODE -ne 0) { throw "Installer failed for $Id ($LASTEXITCODE). Resolve the installer error and rerun." }
  Refresh-AidawPath
}
Refresh-AidawPath
if (!(Get-Command node -ErrorAction SilentlyContinue)) { Install-AidawPackage 'OpenJS.NodeJS.LTS' }
$AidawNodeVersionText = (& node --version).Trim().TrimStart('v')
$AidawNodeVersion = $null
if (![version]::TryParse($AidawNodeVersionText, [ref]$AidawNodeVersion) -or $AidawNodeVersion -lt [version]'22.13.0') {
  throw "Node >=22.13 required. Found '$AidawNodeVersionText'. Upgrade Node.js LTS and rerun."
}
if (!(Get-Command cmake -ErrorAction SilentlyContinue)) { Install-AidawPackage 'Kitware.CMake' }
if (!(Get-Command cmake -ErrorAction SilentlyContinue)) {
  $AidawCmake = Join-Path $env:ProgramFiles 'CMake\bin'
  if (Test-Path (Join-Path $AidawCmake 'cmake.exe')) { $env:Path = "$AidawCmake;$env:Path" }
}
if (!(Get-Command ffmpeg -ErrorAction SilentlyContinue) -or !(Get-Command ffprobe -ErrorAction SilentlyContinue)) { Install-AidawPackage 'Gyan.FFmpeg' }
$AidawVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$AidawCompiler = ''
if (Test-Path $AidawVswhere) { $AidawCompiler = & $AidawVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath }
if (!$AidawCompiler) {
  Install-AidawPackage 'Microsoft.VisualStudio.2022.BuildTools' @('--override','--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
}
& node (Join-Path $AidawRoot 'scripts\setup.mjs') @args
exit $LASTEXITCODE
