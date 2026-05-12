$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot

$setupCandidates = @(
  (Join-Path $repoRoot 'apps\gui\build\native\windows-sandbox-helper\office-agent-windows-sandbox-setup.exe'),
  (Join-Path $repoRoot 'native\windows-sandbox-helper\target\release\office-agent-windows-sandbox-setup.exe'),
  (Join-Path $repoRoot 'native\windows-sandbox-helper\target\debug\office-agent-windows-sandbox-setup.exe')
)

$setupExe = $setupCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $setupExe) {
  throw ('Could not find office-agent-windows-sandbox-setup.exe. Tried: ' + ($setupCandidates -join ', '))
}

$managedRoot = Join-Path $env:LOCALAPPDATA 'OfficeAgent\AgentData'
$requestsDir = Join-Path $managedRoot '.officeagent\sandbox\requests'
New-Item -ItemType Directory -Force -Path $requestsDir | Out-Null

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$payloadPath = Join-Path $requestsDir ('manual_setup_payload_{0}.json' -f ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()))

$payload = [ordered]@{
  version = 1
  realUserName = $identity.Name
  realUserSid = $identity.User.Value
  managedRoot = $managedRoot
  readRoots = @()
  writeRoots = @()
}

$payloadJson = $payload | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($payloadPath, $payloadJson, [System.Text.UTF8Encoding]::new($false))

Write-Host 'Preparing OfficeAgent Windows sandbox v2 setup...'
Write-Host ('Setup exe: ' + $setupExe)
Write-Host ('Managed root: ' + $managedRoot)
Write-Host ('Payload: ' + $payloadPath)
$logPath = Join-Path $requestsDir ('manual_setup_{0}.log' -f ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()))
$cmdPath = Join-Path $requestsDir ('manual_setup_{0}.cmd' -f ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()))
$cmdContent = @"
@echo off
"$setupExe" setup --payload "$payloadPath" > "$logPath" 2>&1
echo Exit code: %ERRORLEVEL%>> "$logPath"
"@
[System.IO.File]::WriteAllText($cmdPath, $cmdContent, [System.Text.UTF8Encoding]::new($false))

Write-Host 'Launching elevated setup. Accept the UAC prompt.'
Write-Host ('Elevated log: ' + $logPath)

Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "`"$cmdPath`"") -Verb RunAs -Wait

if (Test-Path $logPath) {
  Write-Host 'Elevated setup output:'
  Get-Content -Path $logPath | ForEach-Object { Write-Host $_ }
}

$markerPath = Join-Path $managedRoot '.officeagent\sandbox\setup_marker.json'
if (Test-Path $markerPath) {
  Write-Host 'OfficeAgent Windows sandbox v2 setup marker exists.' -ForegroundColor Green
  Write-Host 'Restart/retry the dev app. The app will do the full readiness check on launch/use.' -ForegroundColor Green
  exit 0
}

Write-Host 'Setup finished, but the setup marker was not found:' -ForegroundColor Yellow
Write-Host $markerPath -ForegroundColor Yellow
Write-Host 'If the elevated window showed an error, run the BAT again or use Ajustes > Windows sandbox v2.' -ForegroundColor Yellow
exit 1
