# Run in native Windows PowerShell: powershell -File scripts/setup.ps1
$ErrorActionPreference = 'Stop'
$AidawRoot = Split-Path $PSScriptRoot -Parent
function Refresh-AidawPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}
function Install-AidawPackage([string]$Id, [string[]]$Extra = @()) {
  if (!(Get-Command winget -ErrorAction SilentlyContinue)) { throw "winget is required to install $Id. Install Windows App Installer or the missing dependency, then rerun." }
  & winget install --id $Id --exact --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity @Extra
  if ($LASTEXITCODE -ne 0) { throw "Installer failed for $Id ($LASTEXITCODE). Resolve the installer error and rerun." }
  Refresh-AidawPath
}
if (!(Get-Command node -ErrorAction SilentlyContinue)) { Install-AidawPackage 'OpenJS.NodeJS.LTS' }
& node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'
if ($LASTEXITCODE -ne 0) { throw 'Node >=22.13 required. Upgrade Node.js LTS and rerun.' }
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
