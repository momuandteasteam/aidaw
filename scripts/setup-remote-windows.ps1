# Configure a single-user AIDAW HTTP server on native Windows.
[CmdletBinding()]
param(
  [string]$DataDir,
  [int]$Port = 8787,
  [string]$TaskName = 'AIDAW HTTP Server',
  [string]$NodePath,
  [string]$EnginePath,
  [string]$FfmpegPath,
  [string]$FfprobePath,
  [switch]$EnableTailscaleServe,
  [switch]$RecoverStaleLock,
  [switch]$RotateToken,
  [switch]$SkipCodexConfig,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this script in native Windows PowerShell.' }
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }

$AidawRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
if ([string]::IsNullOrWhiteSpace($DataDir)) { $DataDir = Join-Path $AidawRoot '.aidaw' }
$DataDir = [IO.Path]::GetFullPath($DataDir)

function Resolve-AidawExecutable([string]$Requested, [string]$Command, [string]$Label) {
  if (![string]::IsNullOrWhiteSpace($Requested)) {
    $resolved = [IO.Path]::GetFullPath($Requested)
    if (!(Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "$Label was not found: $resolved" }
    return $resolved
  }
  $found = Get-Command $Command -ErrorAction SilentlyContinue
  if (!$found) { throw "$Label was not found. Run the normal AIDAW setup first or pass its absolute path." }
  return $found.Source
}

$NodePath = Resolve-AidawExecutable $NodePath 'node.exe' 'Node.js'
if ([string]::IsNullOrWhiteSpace($EnginePath)) { $EnginePath = Join-Path $AidawRoot 'build\bin\aidaw-engine.exe' }
$EnginePath = Resolve-AidawExecutable $EnginePath 'aidaw-engine.exe' 'AIDAW engine'
$FfmpegPath = Resolve-AidawExecutable $FfmpegPath 'ffmpeg.exe' 'FFmpeg'
$FfprobePath = Resolve-AidawExecutable $FfprobePath 'ffprobe.exe' 'FFprobe'
$EntryPoint = Join-Path $AidawRoot 'dist\http.js'
if (!(Test-Path -LiteralPath $EntryPoint -PathType Leaf)) { throw 'dist/http.js was not found. Run npm run build first.' }
foreach ($EnvironmentValue in @($DataDir, $EnginePath, $FfmpegPath, $FfprobePath)) {
  if ($EnvironmentValue -match '[\r\n]') { throw 'Environment paths must not contain line breaks.' }
}

$ServerRoot = Join-Path $DataDir 'Server.aidaw'
$ConfigRoot = Join-Path $ServerRoot 'config'
$BackupRoot = Join-Path $ConfigRoot ('backups\' + (Get-Date -Format 'yyyyMMddTHHmmss'))
$EnvironmentFile = Join-Path $ConfigRoot 'http.env'
$Runner = Join-Path $ConfigRoot 'run-http.ps1'
$LogFile = Join-Path $ServerRoot 'logs\http-server.log'
$LockDir = Join-Path $ServerRoot 'temp\server.lock'
New-Item -ItemType Directory -Path $ConfigRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path $LogFile -Parent) -Force | Out-Null

$ExistingEnvironmentText = if (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf) { Get-Content -LiteralPath $EnvironmentFile -Raw } else { $null }
$Token = $null
if (!$RotateToken -and $ExistingEnvironmentText) {
  $TokenLine = $ExistingEnvironmentText -split '\r?\n' | Where-Object { $_ -like 'AIDAW_HTTP_TOKEN=*' } | Select-Object -First 1
  if ($TokenLine) { $Token = $TokenLine.Substring('AIDAW_HTTP_TOKEN='.Length) }
}
if ([string]::IsNullOrWhiteSpace($Token) -or $Token.Length -lt 32) {
  $Bytes = New-Object byte[] 32
  $Generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $Generator.GetBytes($Bytes) } finally { $Generator.Dispose() }
  $Token = -join ($Bytes | ForEach-Object { $_.ToString('x2') })
}

$EnvironmentText = @(
  "AIDAW_HOME=$DataDir"
  "AIDAW_ENGINE=$EnginePath"
  "AIDAW_FFMPEG=$FfmpegPath"
  "AIDAW_FFPROBE=$FfprobePath"
  'AIDAW_HTTP_HOST=127.0.0.1'
  "AIDAW_HTTP_PORT=$Port"
  "AIDAW_HTTP_TOKEN=$Token"
) -join [Environment]::NewLine

$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($ExistingTask -and $ExistingTask.State -eq 'Running') {
  if ($RotateToken -or !$ExistingEnvironmentText -or $ExistingEnvironmentText.TrimEnd() -cne $EnvironmentText.TrimEnd()) {
    throw "The running '$TaskName' uses different settings. Stop it cleanly, then rerun this command."
  }
}
[IO.File]::WriteAllText($EnvironmentFile, $EnvironmentText + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))

$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $EnvironmentFile /inheritance:r | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not remove inherited permissions from the server environment file.' }
& icacls.exe $EnvironmentFile /grant:r "${CurrentIdentity}:(F)" 'SYSTEM:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the server environment file.' }

function Quote-AidawPowerShell([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
$RunnerText = @(
  "`$ErrorActionPreference = 'Stop'"
  ('Set-Location -LiteralPath ' + (Quote-AidawPowerShell $AidawRoot))
  ('$NodePath = ' + (Quote-AidawPowerShell $NodePath))
  ('$EnvironmentFile = ' + (Quote-AidawPowerShell $EnvironmentFile))
  ('$EntryPoint = ' + (Quote-AidawPowerShell $EntryPoint))
  ('$LogFile = ' + (Quote-AidawPowerShell $LogFile))
  'Add-Content -LiteralPath $LogFile -Value ("[" + (Get-Date -Format o) + "] Starting AIDAW HTTP server.")'
  '& $NodePath ("--env-file=" + $EnvironmentFile) $EntryPoint 2>&1 | ForEach-Object { Add-Content -LiteralPath $LogFile -Value $_ }'
  'exit $LASTEXITCODE'
) -join [Environment]::NewLine
[IO.File]::WriteAllText($Runner, $RunnerText + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))

if ($ExistingTask -and $ExistingTask.State -eq 'Running') {
  $ExpectedRunner = [regex]::Escape($Runner)
  if ($ExistingTask.Actions.Execute -notlike '*powershell.exe' -or $ExistingTask.Actions.Arguments -notmatch $ExpectedRunner) {
    throw "A different running scheduled task already uses the name '$TaskName'."
  }
}

if (!$ExistingTask -or $ExistingTask.State -ne 'Running') {
  if (Test-Path -LiteralPath $LockDir -PathType Container) {
    $OwnerFile = Join-Path $LockDir 'owner.json'
    $Owner = if (Test-Path -LiteralPath $OwnerFile -PathType Leaf) { Get-Content -LiteralPath $OwnerFile -Raw | ConvertFrom-Json } else { $null }
    $OwnerProcess = if ($Owner -and $Owner.pid) { Get-Process -Id $Owner.pid -ErrorAction SilentlyContinue } else { $null }
    if ($OwnerProcess) { throw "AIDAW data is already owned by PID $($Owner.pid). Close the stdio client or existing server first." }
    if (!$RecoverStaleLock) { throw "A stale server lock remains at $LockDir. Verify the old process stopped, then rerun with -RecoverStaleLock." }
    $Children = @(Get-ChildItem -LiteralPath $LockDir -Force)
    if ($Children.Count -gt 1 -or ($Children.Count -eq 1 -and $Children[0].Name -ne 'owner.json')) { throw 'The stale lock directory contains unexpected files; refusing recovery.' }
    if ($Children.Count -eq 1) { [IO.File]::Delete($Children[0].FullName) }
    [IO.Directory]::Delete($LockDir, $false)
  }

  $PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Runner + '"'
  $Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $AidawRoot
  $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentIdentity
  $Principal = New-ScheduledTaskPrincipal -UserId $CurrentIdentity -LogonType Interactive -RunLevel Limited
  $Settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
}

$CodexConfig = $null
if (!$SkipCodexConfig) {
  [Environment]::SetEnvironmentVariable('AIDAW_HTTP_TOKEN', $Token, [EnvironmentVariableTarget]::User)
  $ConfigPath = Join-Path $AidawRoot '.codex\config.toml'
  $ConfigTool = Join-Path $AidawRoot 'scripts\setup\remote-config.mjs'
  $CodexConfigText = & $NodePath $ConfigTool --config $ConfigPath --backup-dir $BackupRoot --url "http://127.0.0.1:$Port/mcp" --data-dir $DataDir
  if ($LASTEXITCODE -ne 0) { throw 'Could not configure the local Codex HTTP client.' }
  $CodexConfig = $CodexConfigText | ConvertFrom-Json
}

$Health = $null
if (!$NoStart) {
  if (!$ExistingTask -or $ExistingTask.State -ne 'Running') { Start-ScheduledTask -TaskName $TaskName }
  $Headers = @{ Authorization = "Bearer $Token" }
  $Deadline = (Get-Date).AddSeconds(20)
  do {
    try { $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -Headers $Headers -TimeoutSec 2 } catch { Start-Sleep -Milliseconds 500 }
  } while (!$Health -and (Get-Date) -lt $Deadline)
  if (!$Health -or $Health.status -ne 'ok') { throw "AIDAW did not become healthy on loopback port $Port." }
}

$TailnetUrl = $null
if ($EnableTailscaleServe) {
  if ($NoStart) { throw '-EnableTailscaleServe cannot be combined with -NoStart.' }
  $Tailscale = Get-Command 'tailscale.exe' -ErrorAction SilentlyContinue
  if (!$Tailscale) { throw 'Tailscale was not found.' }
  $Status = & $Tailscale.Source status --json | ConvertFrom-Json
  if (!$Status.Self.Online -or !$Status.Self.DNSName) { throw 'Tailscale is not online or MagicDNS is unavailable.' }
  $ExistingServeText = & $Tailscale.Source serve status --json
  $ExistingServe = $ExistingServeText | ConvertFrom-Json
  if ($ExistingServe.Web) {
    $WebEntries = @($ExistingServe.Web.PSObject.Properties)
    $ExpectedProxy = "http://127.0.0.1:$Port"
    $Conflicts = @($WebEntries | Where-Object { $_.Value.Handlers.'/'.Proxy -and $_.Value.Handlers.'/'.Proxy -ne $ExpectedProxy })
    if ($Conflicts.Count) { throw 'Tailscale Serve already has a different root proxy; refusing to overwrite it.' }
  }
  & $Tailscale.Source serve --bg --yes $Port
  if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve setup failed. Complete the authorization URL shown above, then rerun.' }
  $TailnetUrl = 'https://' + $Status.Self.DNSName.TrimEnd('.') + '/mcp'
}

[pscustomobject]@{
  state = if ($NoStart) { 'configured' } else { 'healthy' }
  task = $TaskName
  data_dir = $DataDir
  environment_file = $EnvironmentFile
  token_length = $Token.Length
  token_exposed = $false
  local_url = "http://127.0.0.1:$Port/mcp"
  tailnet_url = $TailnetUrl
  codex_config = $CodexConfig
  restart_codex_required = !$SkipCodexConfig
} | ConvertTo-Json -Depth 5
