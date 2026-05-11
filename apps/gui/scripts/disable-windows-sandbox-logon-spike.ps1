param(
  [string]$UserName = "OfficeAgentSandbox",
  [switch]$RemoveUser,
  [switch]$NoElevate
)

$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Clear-UserEnv($Name) {
  [Environment]::SetEnvironmentVariable($Name, $null, "User")
  Remove-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
}

Clear-UserEnv "OFFICE_AGENT_SANDBOX_IDENTITY_MODE"
Clear-UserEnv "OFFICE_AGENT_SANDBOX_LOGON_USER"
Clear-UserEnv "OFFICE_AGENT_SANDBOX_LOGON_DOMAIN"
Clear-UserEnv "OFFICE_AGENT_SANDBOX_LOGON_PASSWORD"

$markerPath = Join-Path (Join-Path $env:LOCALAPPDATA "OfficeAgent") "sandbox-logon-spike.json"
Remove-Item -Path $markerPath -Force -ErrorAction SilentlyContinue

if ($RemoveUser) {
  if (-not (Test-IsAdmin)) {
    if ($NoElevate) {
      throw "Administrator privileges are required to remove the local sandbox user."
    }
    $scriptPath = $PSCommandPath
    $argList = @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", "`"$scriptPath`"",
      "-UserName", "`"$UserName`"",
      "-RemoveUser"
    )
    Write-Host "Requesting administrator permission to remove local sandbox user '$UserName'..."
    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
      throw "Elevated cleanup failed or was cancelled. ExitCode=$($proc.ExitCode)"
    }
    exit 0
  }
  Remove-LocalUser -Name $UserName -ErrorAction SilentlyContinue
} elseif (Test-IsAdmin) {
  Disable-LocalUser -Name $UserName -ErrorAction SilentlyContinue
}

Write-Host "OfficeAgent sandbox logon-user spike env vars cleared. Restart OfficeAgent/dev shell."
