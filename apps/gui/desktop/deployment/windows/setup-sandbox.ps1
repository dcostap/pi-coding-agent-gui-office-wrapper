# One-time elevated sandbox setup for the portable Castrosua IA build.
# Run this once on each target Windows PC before using agent command execution.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$HelperPath = Join-Path $ScriptDir "resources\windows-sandbox-helper\officeagent-windows-sandbox-helper.exe"
$ManagedRoot = Join-Path $env:LOCALAPPDATA "OfficeAgent\AgentData"

if (-not (Test-Path -LiteralPath $HelperPath)) {
  throw "OfficeAgent sandbox helper not found: $HelperPath"
}

New-Item -ItemType Directory -Force -Path $ManagedRoot | Out-Null

function Invoke-SandboxHelperJson {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable] $Request
  )

  $json = $Request | ConvertTo-Json -Depth 20 -Compress
  $output = $json | & $HelperPath
  if ($LASTEXITCODE -ne 0) {
    throw "Sandbox helper failed with exit code ${LASTEXITCODE}: $output"
  }
  return ($output | ConvertFrom-Json)
}

Write-Host "Castrosua IA sandbox setup"
Write-Host "Managed root: $ManagedRoot"
Write-Host "Helper:       $HelperPath"
Write-Host ""

$check = Invoke-SandboxHelperJson @{
  kind = "checkSandboxSetup"
  requestId = [guid]::NewGuid().ToString()
  managedRoot = $ManagedRoot
}

if ($check.ok -and $check.result.ready -eq $true) {
  Write-Host "Sandbox is already ready."
  exit 0
}

$prepare = Invoke-SandboxHelperJson @{
  kind = "prepareSandboxSetup"
  requestId = [guid]::NewGuid().ToString()
  action = "setup"
  managedRoot = $ManagedRoot
}

if (-not $prepare.ok) {
  $message = if ($prepare.error.message) { $prepare.error.message } else { ($prepare | ConvertTo-Json -Depth 20) }
  throw "Preparing sandbox setup failed: $message"
}

$setupExePath = $prepare.result.setupExePath
$setupArgs = @($prepare.result.setupArgs)
if (-not $setupExePath -or $setupArgs.Count -eq 0) {
  throw "Sandbox helper did not return setup executable details. Response: $($prepare | ConvertTo-Json -Depth 20)"
}

Write-Host "Requesting administrator permission for one-time sandbox setup..."
Write-Host "Setup exe:  $setupExePath"
Write-Host "Setup args: $($setupArgs -join ' ')"
Write-Host ""

function Quote-PowerShellSingleQuotedString {
  param([Parameter(Mandatory = $true)][string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

$requestDir = Split-Path -Parent $prepare.result.payloadPath
$elevatedScript = Join-Path $requestDir ("run_setup_elevated_" + [guid]::NewGuid().ToString("N") + ".ps1")
$elevatedLog = Join-Path $requestDir "setup_elevated.log"
$quotedSetupExePath = Quote-PowerShellSingleQuotedString $setupExePath
$quotedElevatedLog = Quote-PowerShellSingleQuotedString $elevatedLog
$quotedSetupArgs = ($setupArgs | ForEach-Object { Quote-PowerShellSingleQuotedString ([string]$_) }) -join ", "

@"
`$ErrorActionPreference = "Continue"
`$logPath = $quotedElevatedLog
Start-Transcript -Path `$logPath -Force | Out-Null
`$principal = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
`$isAdmin = `$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Host "Elevated setup identity: `$([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
Write-Host "Elevated setup is admin: `$isAdmin"
if (-not `$isAdmin) {
  Stop-Transcript | Out-Null
  exit 102
}
& $quotedSetupExePath @($quotedSetupArgs)
`$exitCode = `$LASTEXITCODE
Write-Host "Sandbox setup helper exit code: `$exitCode"
Stop-Transcript | Out-Null
exit `$exitCode
"@ | Set-Content -LiteralPath $elevatedScript -Encoding UTF8

# Use EncodedCommand so paths containing spaces (e.g. the Windows user profile)
# cannot be split incorrectly by Start-Process/UAC argument handling.
$encodedElevatedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("& " + (Quote-PowerShellSingleQuotedString $elevatedScript)))
$process = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-EncodedCommand", $encodedElevatedCommand
)

if ($process.ExitCode -ne 0) {
  $setupErrorPath = Join-Path $ManagedRoot ".officeagent\sandbox\setup_error.json"
  $details = @("Elevated sandbox setup failed with exit code $($process.ExitCode).")
  if (Test-Path -LiteralPath $elevatedLog) {
    $details += "Elevated setup log:"
    $details += (Get-Content -LiteralPath $elevatedLog -Raw)
  }
  if (Test-Path -LiteralPath $setupErrorPath) {
    $details += "Setup error report:"
    $details += (Get-Content -LiteralPath $setupErrorPath -Raw)
  }
  throw ($details -join "`n")
}

$finalCheck = Invoke-SandboxHelperJson @{
  kind = "checkSandboxSetup"
  requestId = [guid]::NewGuid().ToString()
  managedRoot = $ManagedRoot
}

if (-not ($finalCheck.ok -and $finalCheck.result.ready -eq $true)) {
  throw "Sandbox setup completed but readiness check failed: $($finalCheck | ConvertTo-Json -Depth 20)"
}

Write-Host "Sandbox setup completed successfully."
