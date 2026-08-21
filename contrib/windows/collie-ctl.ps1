[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CommandArgs,
  [string]$TaskConfigDir,
  [string]$TaskSocketPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Community-maintained. This script lives in contrib/windows/, two levels below the plugin root.
$script:PluginRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$script:PluginId = "herdr.collie"
$script:TaskName = if ($env:COLLIE_TASK_NAME) { $env:COLLIE_TASK_NAME } else { "herdr.collie" }

function Resolve-CollieConfigDir {
  if ($env:HERDR_PLUGIN_CONFIG_DIR) {
    return $env:HERDR_PLUGIN_CONFIG_DIR
  }

  $herdr = Get-Command herdr.exe -ErrorAction SilentlyContinue
  if ($herdr) {
    try {
      $resolved = (& $herdr.Source plugin config-dir $script:PluginId 2>$null | Select-Object -First 1).Trim()
      if ($resolved) { return $resolved }
    } catch {
      # Herdr may not be running during login. Fall through to its conventional Windows path.
    }
  }

  $roaming = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $env:USERPROFILE "AppData\Roaming" }
  return Join-Path $roaming "herdr\plugins\config\$($script:PluginId)"
}

$script:ConfigDir = if ($TaskConfigDir) { $TaskConfigDir } else { Resolve-CollieConfigDir }
$script:EnvFile = Join-Path $script:ConfigDir ".env"
$script:LogFile = Join-Path $script:ConfigDir "collie.log"
$script:ErrorLogFile = Join-Path $script:ConfigDir "collie-error.log"
$script:PreviousLogFile = Join-Path $script:ConfigDir "collie-previous.log"
$script:PreviousErrorLogFile = Join-Path $script:ConfigDir "collie-error-previous.log"
$script:PidFile = Join-Path $script:ConfigDir "collie-processes"

# NTFS analogue of chmod 600/700: strip inherited ACEs and grant only the current user Full
# Control. chmod through MSYS is a no-op on NTFS, so the bash side's POSIX hardening never took
# effect here. Failure warns rather than throws — start must not brick over an ACL it can't set.
function Protect-CollieSecret([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $user = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
  & icacls.exe $Path /inheritance:r /grant:r "${user}:(F)" *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "could not restrict ACL on $Path (icacls exit $LASTEXITCODE)"
  }
}

function Import-CollieEnv([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  Protect-CollieSecret $Path

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $match = [regex]::Match($trimmed, '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
    if (-not $match.Success) {
      throw "invalid .env line: $line"
    }
    $name = $match.Groups[1].Value
    $value = $match.Groups[2].Value.Trim()
    if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

Import-CollieEnv $script:EnvFile

function Get-ColliePort {
  $port = 8787
  if ($env:COLLIE_PORT) {
    $parsed = 0
    if (-not [int]::TryParse($env:COLLIE_PORT, [ref]$parsed) -or $parsed -lt 1 -or $parsed -gt 65535) {
      Write-Warning "COLLIE_PORT=$($env:COLLIE_PORT) is invalid - using 8787"
    } else {
      $port = $parsed
    }
  }
  return $port
}

$script:Port = Get-ColliePort
$script:ServeMode = if ($env:COLLIE_SERVE_MODE -eq "http") { "http" } else { "https" }
$script:SkipServe = $env:COLLIE_SKIP_SERVE -eq "1"
$script:RoamingDir = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $env:USERPROFILE "AppData\Roaming" }
$script:SocketPath = if ($TaskSocketPath) {
  $TaskSocketPath
} elseif ($env:HERDR_SOCKET_PATH) {
  $env:HERDR_SOCKET_PATH
} else {
  Join-Path $script:RoamingDir "herdr\herdr.sock"
}

function Resolve-Bun {
  $command = Get-Command bun.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    (Join-Path $env:USERPROFILE ".bun\bin\bun.exe"),
    (Join-Path $env:ProgramData "chocolatey\bin\bun.exe"),
    (Join-Path $env:LOCALAPPDATA "bun\bin\bun.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  throw "bun not found - install Bun and make bun.exe available on PATH"
}

function Resolve-Tailscale {
  $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in @(
      (Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"),
      (Join-Path ${env:ProgramFiles(x86)} "Tailscale\tailscale.exe"),
      (Join-Path $env:LOCALAPPDATA "Tailscale\tailscale.exe")
    )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

function Invoke-InDirectory([string]$Path, [scriptblock]$Body) {
  Push-Location -LiteralPath $Path
  try { & $Body } finally { Pop-Location }
}

function Assert-LastExit([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

# Windows passes one command line, not an argv, so each value must survive CommandLineToArgvW's
# re-split. Quote it, escape embedded quotes, and double only the backslashes that precede a quote.
function Format-CommandArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function Write-CollieActionLauncher {
  $launcherDir = Join-Path $script:PluginRoot "build"
  $launcher = Join-Path $launcherDir "collie-action-v1.exe"
  if (Test-Path -LiteralPath $launcher) {
    $stream = [IO.File]::OpenRead($launcher)
    try { $isExecutable = $stream.ReadByte() -eq 77 -and $stream.ReadByte() -eq 90 } finally { $stream.Dispose() }
    if (-not $isExecutable) {
      throw "action launcher was built for POSIX; delete '$launcher' and rebuild"
    }
    return
  }
  New-Item -ItemType Directory -Force -Path $launcherDir | Out-Null
  Add-Type -Path (Join-Path $PSScriptRoot "collie-action.cs") -OutputAssembly $launcher -OutputType ConsoleApplication
}

function Install-CollieWebDist([string]$WebRoot) {
  $staging = Join-Path $WebRoot "dist-staging"
  $dist = Join-Path $WebRoot "dist"
  $backup = Join-Path $WebRoot "dist-backup"

  if (Test-Path -LiteralPath $backup) {
    if (Test-Path -LiteralPath $dist) {
      Remove-Item -LiteralPath $backup -Recurse -Force
    } else {
      Move-Item -LiteralPath $backup -Destination $dist
    }
  }
  if (Test-Path -LiteralPath $dist) { Move-Item -LiteralPath $dist -Destination $backup }
  try {
    Move-Item -LiteralPath $staging -Destination $dist
  } catch {
    if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $dist)) {
      Move-Item -LiteralPath $backup -Destination $dist
    }
    throw
  }
  Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
}

function Invoke-CollieApplicationBuild([string]$Bun) {
  New-Item -ItemType Directory -Force -Path $script:ConfigDir | Out-Null
  # No version gate here: scripts/check-version.sh is a maintainer release gate and needs bash.
  # Operators never need it; run it from WSL or Git Bash if you are cutting a release.

  Invoke-InDirectory $script:PluginRoot {
    & $Bun install --frozen-lockfile
    Assert-LastExit "root bun install"
    & $Bun run typecheck
    Assert-LastExit "root typecheck"
  }

  $webRoot = Join-Path $script:PluginRoot "web"
  $staging = Join-Path $webRoot "dist-staging"
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  Invoke-InDirectory $webRoot {
    & $Bun install --frozen-lockfile
    Assert-LastExit "web bun install"
    & $Bun run typecheck
    Assert-LastExit "web typecheck"
    & $Bun run build -- --outDir dist-staging --emptyOutDir
    Assert-LastExit "web build"
  }
  Install-CollieWebDist $webRoot
}

function Invoke-CollieBuild {
  $bun = Resolve-Bun
  Write-CollieActionLauncher
  Invoke-CollieApplicationBuild $bun
}

function Ensure-CollieBuild {
  if (Test-Path -LiteralPath (Join-Path $script:PluginRoot "web\dist\index.html")) { return }
  Write-Output "building web UI (first run)..."
  Invoke-CollieApplicationBuild (Resolve-Bun)
}

function Test-Administrator {
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-CollieTaskRunLevel {
  $requested = if ($env:COLLIE_TASK_RUN_LEVEL) { $env:COLLIE_TASK_RUN_LEVEL.Trim() } else { "limited" }
  if ($requested -ieq "limited") { return "Limited" }
  if ($requested -ine "highest") { throw "COLLIE_TASK_RUN_LEVEL must be 'limited' or 'highest'" }
  if (-not (Test-Administrator)) { throw "COLLIE_TASK_RUN_LEVEL=highest requires Administrator PowerShell" }
  return "Highest"
}

function Get-CollieHiddenTaskScriptPath {
  return Join-Path $script:ConfigDir "exec-bridge.vbs"
}

# Task Scheduler Interactive tasks show a console for powershell.exe/bun.exe (console-subsystem
# binaries). wscript.exe is a GUI host, and WshShell.Run(..., 0) starts the child hidden — no
# window, no taskbar button. The VBS is rewritten on every start so the baked-in paths stay current.
function Write-CollieHiddenTaskScript {
  $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
  $ctl = Join-Path $PSScriptRoot "collie-ctl.ps1"
  $command = '{0} -WindowStyle Hidden -NoProfile -NonInteractive -ExecutionPolicy Bypass -File {1} -TaskConfigDir {2} -TaskSocketPath {3} _exec-bridge' -f @(
    (Format-CommandArgument $powershell),
    (Format-CommandArgument $ctl),
    (Format-CommandArgument $script:ConfigDir),
    (Format-CommandArgument $script:SocketPath)
  )
  $literal = $command.Replace('"', '""')
  $lines = @(
    "' Written by collie-ctl.ps1; overwritten on each start."
    'Set sh = CreateObject("WScript.Shell")'
    ('WScript.Quit sh.Run("' + $literal + '", 0, True)')
  )
  New-Item -ItemType Directory -Force -Path $script:ConfigDir | Out-Null
  Set-Content -LiteralPath (Get-CollieHiddenTaskScriptPath) -Value $lines -Encoding Ascii
}

function Register-CollieTask {
  [void](Resolve-Bun)
  Write-CollieHiddenTaskScript
  $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
  if (-not (Test-Path -LiteralPath $wscript)) { throw "wscript.exe not found at $wscript" }
  $arguments = '//nologo {0}' -f (Format-CommandArgument (Get-CollieHiddenTaskScriptPath))
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name

  $action = New-ScheduledTaskAction -Execute $wscript -Argument $arguments -WorkingDirectory $script:PluginRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel (Get-CollieTaskRunLevel)
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

  Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Collie mobile bridge for Herdr" -Force | Out-Null
  Enable-ScheduledTask -TaskName $script:TaskName | Out-Null
}

function Test-BridgeReady([int]$Attempts = 25) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
      $connect = $client.ConnectAsync("127.0.0.1", $script:Port)
      if ($connect.Wait(200) -and $client.Connected) { return $true }
    } catch {
      # The bridge may still be starting.
    } finally {
      $client.Dispose()
    }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Test-HerdrReady([int]$Attempts = 1) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      $snapshot = Invoke-RestMethod -Uri "http://127.0.0.1:$($script:Port)/api/snapshot" -TimeoutSec 1
      if ($snapshot.bridge -eq "connected") { return $true }
    } catch {
      # The bridge or Herdr endpoint may still be starting.
    }
    if ($i + 1 -lt $Attempts) { Start-Sleep -Milliseconds 250 }
  }
  return $false
}

function Get-CollieVersion {
  $buildInfo = Join-Path $script:PluginRoot "web\dist\build-info.json"
  if (Test-Path -LiteralPath $buildInfo) {
    $info = Get-Content -LiteralPath $buildInfo -Raw | ConvertFrom-Json
    if ($info.sha) { return "$($info.version)+$($info.sha)" }
    return [string]$info.version
  }
  $manifest = Get-Content -LiteralPath (Join-Path $script:PluginRoot "herdr-plugin.toml") -Raw
  $version = [regex]::Match($manifest, '(?m)^\s*version\s*=\s*"([^"]+)"').Groups[1].Value
  return "$version (manifest; web not built)"
}

function Get-TailscaleStatus {
  $tailscale = Resolve-Tailscale
  if (-not $tailscale) { throw "tailscale not found" }
  $raw = & $tailscale status --json 2>$null | Out-String
  Assert-LastExit "tailscale status"
  return $raw | ConvertFrom-Json
}

function Get-TailscaleDnsName {
  try {
    $status = Get-TailscaleStatus
    return ([string]$status.Self.DNSName).TrimEnd(".")
  } catch {
    return ""
  }
}

function Get-CollieUrl {
  if ($script:SkipServe) {
    if ($env:COLLIE_PUBLIC_URL) { return $env:COLLIE_PUBLIC_URL }
    return "http://127.0.0.1:$($script:Port) (COLLIE_SKIP_SERVE=1; public URL unset)"
  }
  $dnsName = Get-TailscaleDnsName
  if (-not $dnsName) { return "http://127.0.0.1:$($script:Port) (Tailscale name unavailable)" }
  if ($script:ServeMode -eq "http") { return "http://$dnsName`:$($script:Port)" }
  return "https://$dnsName"
}

function Show-CollieServeStatus {
  if ($script:SkipServe) {
    Write-Output "  serve config: skipped (COLLIE_SKIP_SERVE=1)"
    return
  }

  Write-Output "  serve config:"
  $tailscale = Resolve-Tailscale
  if (-not $tailscale) {
    Write-Output "    (tailscale not found)"
    return
  }
  $status = & $tailscale serve status 2>$null
  if ($LASTEXITCODE -eq 0 -and $status) {
    $status | ForEach-Object { Write-Output "    $_" }
  } else {
    Write-Output "    (unavailable)"
  }
}

function Show-CollieStatus {
  $task = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
  $service = if ($task) { "Task Scheduler ($($script:TaskName)) - $($task.State)" } else { "not supervised" }
  Write-Output ""
  if (Test-HerdrReady) {
    Write-Output "  OK Collie is running - v$(Get-CollieVersion)"
  } elseif (Test-BridgeReady 1) {
    Write-Output "  WARN Collie is running but cannot reach Herdr - check logs"
  } else {
    Write-Output "  WARN Collie is not answering on :$($script:Port) - check logs"
  }
  Write-Output "    service   $service"
  Write-Output "    local     http://127.0.0.1:$($script:Port)"
  Write-Output "    remote    $(Get-CollieUrl)"
  Write-Output ""
  Show-CollieServeStatus
}

function Start-Collie {
  Protect-CollieSecret $script:ConfigDir
  Protect-CollieSecret $script:EnvFile
  Ensure-CollieBuild
  # `start` is not `restart`: it must not stack a second bridge on a port that already has one, and it
  # must not silently adopt one either. Stop what this checkout owns and refuse if a stranger remains.
  Stop-AllCollieBridges
  Register-CollieTask | Out-Null
  Start-ScheduledTask -TaskName $script:TaskName
  Write-Output "bridge started (Task Scheduler: $($script:TaskName))"
  if (-not (Test-HerdrReady 30)) {
    Write-Warning "Collie cannot reach Herdr yet. Herdr may be temporarily unavailable or running as Administrator. The bridge remains supervised and will reconnect."
  }
  Show-CollieStatus
}

# Every process running THIS checkout's bridge, or supervising one, whether or not the record names
# it — the record holds one launcher|bridge pair, and a bridge started any other way (an older
# start whose record was overwritten, `bash scripts/collie-ctl.sh`, a stray `bun run bridge/index.ts`)
# stayed alive across `stop`. Windows lets a second bridge bind 127.0.0.1:$Port beside the first, so
# the miss did not fail loud — it stacked, and requests round-robined between old and new code (#41).
# This process and every parent up to the session. _exec-bridge used to skip only $PID; once the
# task host became wscript.exe running exec-bridge.vbs, Stop-AllCollieBridges matched that parent
# and taskkill /T'd it — which killed the bridge it had just started.
function Get-SelfProcessIds {
  $ids = @()
  $current = [int]$PID
  for ($i = 0; $i -lt 16; $i++) {
    if ($ids -contains $current) { break }
    $ids += $current
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $current" -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ParentProcessId -le 0) { break }
    $current = [int]$proc.ParentProcessId
  }
  return @($ids)
}

# Ownership is the command line: bridge = bun running "<PluginRoot>\bridge\index.ts" (either slash
# style, since bash callers pass forward ones); launcher = this script run with _exec-bridge, or the
# wscript host that hides it (exec-bridge.vbs). One widening, for the case that actually stacked: a
# bridge started by hand from the checkout root runs as `bun run bridge/index.ts` — a RELATIVE path
# that names no checkout — so a bun whose command line is that relative script AND that is listening
# on our port is taken as ours too. The port alone never is: an unrelated listener on :$Port is left
# alone and reported by Wait-ColliePortFree.
function Get-CollieBridgeProcesses {
  $bridgeBack = Join-Path $script:PluginRoot "bridge\index.ts"
  $bridgeFwd = $bridgeBack.Replace("\", "/")
  $controlScript = Join-Path $PSScriptRoot "collie-ctl.ps1"
  $hiddenScript = Get-CollieHiddenTaskScriptPath
  $selfIds = Get-SelfProcessIds
  $listeners = @(Get-ColliePortListeners)
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $line = $_.CommandLine
    if (-not $line) { return $false }
    if ($selfIds -contains [int]$_.ProcessId) { return $false }
    if ($line.Contains($bridgeBack) -or $line.Contains($bridgeFwd)) { return $true }
    if ($line.Contains($controlScript) -and $line.Contains("_exec-bridge")) { return $true }
    if ($line.Contains($hiddenScript)) { return $true }
    ($listeners -contains $_.ProcessId) -and ($line -match '(^|[\s"''])bridge[\\/]index\.ts(["'']|\s|$)')
  }
}

# Stop the recorded pair, then every stray, then wait until nothing listens on the port. Throws if a
# listener remains: something that is NOT this checkout's bridge owns the port, and starting beside it
# is exactly the failure this function exists to remove — better to stop with the pids on screen.
function Stop-AllCollieBridges {
  Stop-RecordedCollieProcesses
  $hiddenScript = Get-CollieHiddenTaskScriptPath
  foreach ($proc in @(Get-CollieBridgeProcesses)) {
    if ($proc.CommandLine.Contains("_exec-bridge") -or $proc.CommandLine.Contains($hiddenScript)) {
      Stop-CollieProcessTree $proc.ProcessId
    } else {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Wait-ColliePortFree
}

# A launcher and everything under it (its bun child). Checked first so a pid that has already gone
# does not make taskkill complain to the console.
function Stop-CollieProcessTree([int]$Id) {
  if (-not (Get-Process -Id $Id -ErrorAction SilentlyContinue)) { return }
  & (Join-Path $env:SystemRoot "System32\taskkill.exe") /PID $Id /T /F | Out-Null
}

# The pids listening on 127.0.0.1:$Port right now (Get-NetTCPConnection is the netstat -ano of #41).
function Get-ColliePortListeners {
  @(Get-NetTCPConnection -LocalPort $script:Port -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq "127.0.0.1" -or $_.LocalAddress -eq "0.0.0.0" -or $_.LocalAddress -eq "::" -or $_.LocalAddress -eq "::1" } |
    ForEach-Object { $_.OwningProcess } | Sort-Object -Unique)
}

function Wait-ColliePortFree([int]$Attempts = 25) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    $pids = @(Get-ColliePortListeners)
    if ($pids.Count -eq 0) { return }
    Start-Sleep -Milliseconds 200
  }
  $pids = @(Get-ColliePortListeners)
  if ($pids.Count -eq 0) { return }
  throw "127.0.0.1:$($script:Port) is still bound by pid(s) $($pids -join ', ') after stopping Collie's bridges. Something that is not this checkout's bridge owns the port; refusing to start a second listener beside it (#41). Free the port (taskkill /PID <pid> /F) and retry."
}

function Stop-RecordedCollieProcesses {
  if (-not (Test-Path -LiteralPath $script:PidFile)) { return }
  $record = (Get-Content -LiteralPath $script:PidFile -Raw).Trim()
  $match = [regex]::Match($record, '^(\d+)\|(\d+)$')
  if (-not $match.Success) { throw "invalid Collie process ownership state: $record" }

  $launcherId = [int]$match.Groups[1].Value
  $bridgeId = [int]$match.Groups[2].Value
  $launcher = Get-CimInstance Win32_Process -Filter "ProcessId = $launcherId" -ErrorAction SilentlyContinue
  if ($launcher) {
    $controlScript = Join-Path $PSScriptRoot "collie-ctl.ps1"
    if ($launcher.CommandLine -and $launcher.CommandLine.Contains($controlScript) -and $launcher.CommandLine.Contains("_exec-bridge")) {
      & (Join-Path $env:SystemRoot "System32\taskkill.exe") /PID $launcherId /T /F | Out-Null
    }
  }

  $bridge = if ($bridgeId -gt 0) {
    Get-CimInstance Win32_Process -Filter "ProcessId = $bridgeId" -ErrorAction SilentlyContinue
  }
  if ($bridge) {
    $bridgeScript = Join-Path $script:PluginRoot "bridge\index.ts"
    if ($bridge.CommandLine -and $bridge.CommandLine.Contains($bridgeScript)) {
      Stop-Process -Id $bridgeId -Force
    }
  }
  Remove-Item -LiteralPath $script:PidFile -ErrorAction SilentlyContinue
}

function Stop-Collie {
  $task = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Disable-ScheduledTask -TaskName $script:TaskName | Out-Null
  }
  # Disabled first, so the scheduler does not relaunch what we are about to stop.
  Stop-AllCollieBridges
  if ($task) { Stop-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue }
  Write-Output "bridge stopped"
}

function Uninstall-Collie {
  Stop-Collie
  if (Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false
  }
  $hiddenScript = Get-CollieHiddenTaskScriptPath
  if (Test-Path -LiteralPath $hiddenScript) {
    Remove-Item -LiteralPath $hiddenScript -Force
  }
  Write-Output "OK uninstalled: task stopped and removed"
  Write-Output "  Tailscale Serve is operator-managed and was left unchanged"
  Write-Output "  kept: $($script:EnvFile) and the checkout"
}

function Test-CollieGitCommand([string[]]$GitArgs) {
  $savedPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & git -C $script:PluginRoot @GitArgs *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $savedPreference
  }
}

function Test-CollieManagedCheckout {
  return -not (Test-CollieGitCommand @("symbolic-ref", "-q", "HEAD"))
}

function Get-CollieNewestReleaseTag {
  $output = & git -C $script:PluginRoot ls-remote --tags --refs --sort=-v:refname origin "v*" 2>$null
  if ($LASTEXITCODE -ne 0) {
    $output = & git -C $script:PluginRoot ls-remote --tags --refs origin "v*"
    Assert-LastExit "git ls-remote"
    $tags = @()
    foreach ($line in $output) {
      if ($line -match 'refs/tags/(v\d+\.\d+\.\d+)$') {
        $tags += $Matches[1]
      }
    }
    if ($tags.Count -eq 0) { return "" }
    $sorted = $tags | Sort-Object { [version]($_ -replace '^v', '') }
    return $sorted[-1]
  }
  foreach ($line in $output) {
    if ($line -match 'refs/tags/(v\d+\.\d+\.\d+)$') {
      return $Matches[1]
    }
  }
  return ""
}

function Get-CollieManifestVersion([string]$Root = $script:PluginRoot) {
  $path = Join-Path $Root "herdr-plugin.toml"
  if (-not (Test-Path -LiteralPath $path)) { return "" }
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match '^version\s*=\s*"([^"]*)"') { return $Matches[1] }
  }
  return ""
}

function Get-CollieMajor([string]$Version) {
  if ($Version -match '^(\d+)\.') { return [int]$Matches[1] }
  return $null
}

function Get-CollieRemoteReleaseTags {
  $output = & git -C $script:PluginRoot ls-remote --tags origin 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "could not list the upstream release tags - is the remote reachable?"
  }
  $byName = @{}
  foreach ($line in @($output)) {
    if ($line -notmatch '^([0-9a-f]+)\s+refs/tags/(.+)$') { continue }
    $sha = $Matches[1]
    $name = $Matches[2]
    $peeled = $false
    if ($name.EndsWith("^{}")) {
      $peeled = $true
      $name = $name.Substring(0, $name.Length - 3)
    }
    if ($name -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { continue }
    if ($byName.ContainsKey($name) -and $byName[$name].Peeled -and -not $peeled) { continue }
    $byName[$name] = [pscustomobject]@{
      Major = [int]$Matches[1]
      Minor = [int]$Matches[2]
      Patch = [int]$Matches[3]
      Tag = $name
      Commit = $sha
      Peeled = $peeled
    }
  }
  return @($byName.Values)
}

function Get-CollieReleaseInMajor($Tags, [int]$Major) {
  $in = @($Tags | Where-Object { $_.Major -eq $Major } | Sort-Object Major, Minor, Patch)
  if ($in.Count -eq 0) { return $null }
  return $in[-1]
}

function Get-CollieNextMajorRelease($Tags, [int]$Major) {
  $higher = @($Tags | Where-Object { $_.Major -gt $Major } | Sort-Object Major, Minor, Patch)
  if ($higher.Count -eq 0) { return $null }
  $next = $higher[0].Major
  $in = @($higher | Where-Object { $_.Major -eq $next })
  return $in[-1]
}

function Write-CollieMajorAnnouncement($Higher) {
  if (-not $Higher) { return }
  $ver = $Higher.Tag.Substring(1)
  Write-Output "note: Collie $ver is out - a NEW MAJOR, which a routine update never takes."
  Write-Output "      Read its release notes, then consent to it with:  herdr plugin action invoke update-major --plugin herdr.collie"
}

function Set-CollieManagedTag([string]$Target) {
  if ([string]::IsNullOrWhiteSpace($Target)) {
    throw "no vX.Y.Z release tag found on origin; refuse to update to unverified origin HEAD (override with COLLIE_UPDATE_REF=<tag-or-ref>)"
  }
  Write-Output "updating Collie (Herdr-managed checkout: fetch + detach onto $Target)..."
  $shallow = (& git -C $script:PluginRoot rev-parse --is-shallow-repository | Out-String).Trim()
  Assert-LastExit "git shallow check"
  $depth = if ($shallow -eq "true") { @("--depth", "1") } else { @() }
  & git -C $script:PluginRoot fetch @depth origin tag $Target
  Assert-LastExit "git fetch"
  & git -C $script:PluginRoot checkout -q --detach --force "refs/tags/$Target"
  Assert-LastExit "git checkout"
  $exactTag = (& git -C $script:PluginRoot describe --tags --exact-match 2>$null | Out-String).Trim()
  if ($exactTag -ne $Target) {
    throw "checkout landed at '$exactTag', expected tag '$Target'"
  }
  $head = (& git -C $script:PluginRoot log -1 --format="%h %s" | Out-String).Trim()
  Assert-LastExit "git log"
  Write-Output "now at $Target ($head)"
}

function Update-CollieManagedCheckout([string]$Installed, [bool]$Cross) {
  if (-not [string]::IsNullOrWhiteSpace($env:COLLIE_UPDATE_REF)) {
    Set-CollieManagedTag $env:COLLIE_UPDATE_REF
    return
  }
  $tags = @(Get-CollieRemoteReleaseTags)
  $major = Get-CollieMajor $Installed
  if ($null -eq $major) {
    Write-Output "updating Collie (Herdr-managed checkout: no readable version - pinning to newest release tag)..."
    Set-CollieManagedTag (Get-CollieNewestReleaseTag)
    return
  }
  $higher = Get-CollieNextMajorRelease $tags $major
  if ($Cross) {
    if (-not $higher) {
      Write-Output "no release above major $major exists yet - nothing to cross to."
      return
    }
    $crossVer = $higher.Tag.Substring(1)
    Write-Output "crossing to Collie $crossVer (major flag given: consented)..."
    Set-CollieManagedTag $higher.Tag
    return
  }
  $best = Get-CollieReleaseInMajor $tags $major
  if (-not $best) {
    Write-Output "no release of major $major yet - leaving this checkout where it is."
    Write-CollieMajorAnnouncement $higher
    return
  }
  $head = (& git -C $script:PluginRoot rev-parse HEAD | Out-String).Trim()
  $bestVersion = [version]$best.Tag.Substring(1)
  $installedVersion = $null
  if ($Installed -match '^(\d+\.\d+\.\d+)') {
    $installedVersion = [version]$Matches[1]
  }
  if ($best.Commit -eq $head -or ($installedVersion -and $bestVersion -le $installedVersion)) {
    Write-Output "already current - $($best.Tag) is the newest release of major $major."
    Write-CollieMajorAnnouncement $higher
    return
  }
  Set-CollieManagedTag $best.Tag
  Write-CollieMajorAnnouncement $higher
}

function Update-CollieLinkedCheckout([string]$Installed, [bool]$Cross) {
  & git -C $script:PluginRoot fetch origin
  Assert-LastExit "git fetch"
  $ref = (& git -C $script:PluginRoot rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null | Out-String).Trim()
  if ($ref) {
    $fetched = ""
    $toml = & git -C $script:PluginRoot show "${ref}:herdr-plugin.toml" 2>$null
    if ($LASTEXITCODE -eq 0 -and $toml) {
      foreach ($line in @($toml -split "`n")) {
        if ($line -match '^version\s*=\s*"([^"]*)"') { $fetched = $Matches[1]; break }
      }
    }
    $from = Get-CollieMajor $Installed
    $to = Get-CollieMajor $fetched
    if (-not $Cross -and $null -ne $from -and $null -ne $to -and $to -gt $from) {
      Write-Output "refusing to update: $Installed -> $fetched ($ref) crosses a MAJOR version."
      Write-Output "A major means you have to change something - so it is never taken by a routine update."
      Write-Output "Read its release notes, then consent to it with:  herdr plugin action invoke update-major --plugin herdr.collie"
      Write-Output "(nothing was pulled - this checkout is unchanged)"
      return
    }
  }
  Write-Output "updating Collie (git pull --ff-only)..."
  & git -C $script:PluginRoot pull --ff-only
  Assert-LastExit "git pull"
}

function Update-CollieCheckout {
  if (-not (Test-CollieGitCommand @("rev-parse", "--git-dir"))) {
    throw "not a git checkout - refresh with: herdr plugin install AltanS/collie --yes"
  }

  $cross = @($CommandArgs) -contains "--major"
  $installed = Get-CollieManifestVersion
  if (-not (Test-CollieManagedCheckout)) {
    Update-CollieLinkedCheckout $installed $cross
    return
  }
  Update-CollieManagedCheckout $installed $cross
}

function Refresh-CollieRegistry {
  if (Test-CollieManagedCheckout) {
    Write-Output "note: Herdr-managed install - registry left alone (re-linking would block plugin reinstall)"
    return
  }
  try {
    & herdr plugin link $script:PluginRoot | Out-Null
    Assert-LastExit "herdr plugin link"
    Write-Output "herdr registry refreshed (re-linked)"
  } catch {
    Write-Warning "could not refresh the Herdr registry; run: herdr plugin link `"$($script:PluginRoot)`""
  }
}

function Apply-CollieUpdate {
  Invoke-CollieBuild
  Stop-Collie
  Start-Collie
  Refresh-CollieRegistry
  Write-Output "OK update complete"
}

function Update-Collie {
  Update-CollieCheckout
  $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
  & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "collie-ctl.ps1") _apply-update
  Assert-LastExit "apply update"
}

function Preserve-CollieCrashLogs {
  if (Test-Path -LiteralPath $script:LogFile) {
    Move-Item -LiteralPath $script:LogFile -Destination $script:PreviousLogFile -Force
  }
  if (Test-Path -LiteralPath $script:ErrorLogFile) {
    Move-Item -LiteralPath $script:ErrorLogFile -Destination $script:PreviousErrorLogFile -Force
  }
}

function Invoke-CollieBridge {
  $bun = Resolve-Bun
  New-Item -ItemType Directory -Force -Path $script:ConfigDir | Out-Null
  $env:HERDR_SOCKET_PATH = $script:SocketPath
  $env:COLLIE_PORT = [string]$script:Port
  $env:HERDR_PLUGIN_CONFIG_DIR = $script:ConfigDir
  if (-not $env:HERDR_PLUGIN_STATE_DIR) {
    $localData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
    $env:HERDR_PLUGIN_STATE_DIR = Join-Path $localData "herdr\plugins\$($script:PluginId)"
  }
  $bridge = Join-Path $script:PluginRoot "bridge\index.ts"
  # The launcher is the last line: whatever reached this point, there is exactly one bridge after it.
  Stop-AllCollieBridges
  while ($true) {
    "$PID|0" | Set-Content -LiteralPath $script:PidFile -NoNewline
    $process = Start-Process `
      -FilePath $bun `
      -ArgumentList @("run", "`"$bridge`"") `
      -WorkingDirectory $script:PluginRoot `
      -NoNewWindow `
      -PassThru `
      -RedirectStandardOutput $script:LogFile `
      -RedirectStandardError $script:ErrorLogFile
    "$PID|$($process.Id)" | Set-Content -LiteralPath $script:PidFile -NoNewline
    $process.WaitForExit()
    $exitCode = $process.ExitCode
    "$PID|0" | Set-Content -LiteralPath $script:PidFile -NoNewline
    if ($exitCode -eq 0) { exit 0 }
    Preserve-CollieCrashLogs
    Start-Sleep -Seconds 5
  }
}

if ($MyInvocation.InvocationName -eq ".") { return }

switch ($Command) {
  "build" { Invoke-CollieBuild }
  "start" { Start-Collie }
  "stop" { Stop-Collie }
  "restart" { Stop-Collie; Start-Collie }
  "uninstall" { Uninstall-Collie }
  "update" { Update-Collie }
  "_apply-update" { Apply-CollieUpdate }
  "status" { Show-CollieStatus }
  "url" { Get-CollieUrl }
  "version" { Get-CollieVersion }
  "logs" {
    $lines = if ($CommandArgs -and $CommandArgs.Count -gt 0) { [int]$CommandArgs[0] } else { 50 }
    if (Test-Path -LiteralPath $script:PreviousLogFile) { Write-Output "previous bridge crash (stdout):"; Get-Content -LiteralPath $script:PreviousLogFile -Tail $lines -Encoding UTF8 }
    if (Test-Path -LiteralPath $script:PreviousErrorLogFile) { Write-Output "previous bridge crash (stderr):"; Get-Content -LiteralPath $script:PreviousErrorLogFile -Tail $lines -Encoding UTF8 }
    if (Test-Path -LiteralPath $script:LogFile) { Get-Content -LiteralPath $script:LogFile -Tail $lines -Encoding UTF8 } else { "(no log)" }
    if (Test-Path -LiteralPath $script:ErrorLogFile) { Get-Content -LiteralPath $script:ErrorLogFile -Tail $lines -Encoding UTF8 }
  }
  "_exec-bridge" { Invoke-CollieBridge }
  default {
    Write-Error "usage: collie-ctl.ps1 {start|stop|restart|uninstall|update|version|build|status|url|logs}"
  }
}
