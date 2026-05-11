param(
  [string]$UserName = "OfficeAgentSandbox",
  [string]$Domain = ".",
  [switch]$ResetPassword,
  [switch]$NoElevate
)

$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function New-RandomPassword {
  $alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+="
  $bytes = New-Object byte[] 36
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $chars = foreach ($b in $bytes) { $alphabet[$b % $alphabet.Length] }
  return -join $chars
}

function Set-UserEnv($Name, $Value) {
  [Environment]::SetEnvironmentVariable($Name, $Value, "User")
  Set-Item -Path "Env:$Name" -Value $Value
}

if ($env:OS -notlike "Windows*") {
  throw "This setup script is Windows-only."
}

if (-not (Test-IsAdmin)) {
  if ($NoElevate) {
    throw "Administrator privileges are required to create/reset the local sandbox user."
  }

  $scriptPath = $PSCommandPath
  $argList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$scriptPath`"",
    "-UserName", "`"$UserName`"",
    "-Domain", "`"$Domain`""
  )
  if ($ResetPassword) { $argList += "-ResetPassword" }

  Write-Host "Requesting administrator permission to create/update local sandbox user '$Domain\$UserName'..."
  $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs -Wait -PassThru
  if ($proc.ExitCode -ne 0) {
    throw "Elevated setup failed or was cancelled. ExitCode=$($proc.ExitCode)"
  }
  Write-Host "Setup completed. Restart OfficeAgent/dev shell so persisted environment variables are loaded."
  exit 0
}

if ($Domain -ne "." -and $Domain -ne $env:COMPUTERNAME) {
  throw "This spike setup only provisions local users. Use -Domain . or -Domain $env:COMPUTERNAME."
}

$password = New-RandomPassword
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$existing = Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue

if ($existing) {
  if (-not $ResetPassword) {
    Write-Host "Local user '$UserName' already exists; resetting password so OfficeAgent can run the spike."
  }
  Set-LocalUser -Name $UserName -Password $securePassword -AccountNeverExpires:$true -PasswordNeverExpires:$true
  Enable-LocalUser -Name $UserName
} else {
  New-LocalUser `
    -Name $UserName `
    -Password $securePassword `
    -AccountNeverExpires `
    -PasswordNeverExpires `
    -Description "OfficeAgent experimental sandbox identity spike account" | Out-Null
}

# Keep it out of Administrators if somebody pre-created it there.
try {
  Remove-LocalGroupMember -Group "Administrators" -Member $UserName -ErrorAction SilentlyContinue
} catch {
  # Non-fatal; localized Windows group names can make this fail.
}

Set-UserEnv "OFFICE_AGENT_SANDBOX_IDENTITY_MODE" "logon-user"
Set-UserEnv "OFFICE_AGENT_SANDBOX_LOGON_USER" $UserName
Set-UserEnv "OFFICE_AGENT_SANDBOX_LOGON_DOMAIN" $Domain
Set-UserEnv "OFFICE_AGENT_SANDBOX_LOGON_PASSWORD" $password

$officeAgentDir = Join-Path $env:LOCALAPPDATA "OfficeAgent"
New-Item -ItemType Directory -Force -Path $officeAgentDir | Out-Null
$markerPath = Join-Path $officeAgentDir "sandbox-logon-spike.json"
@{
  identityMode = "logon-user"
  user = $UserName
  domain = $Domain
  createdAt = (Get-Date).ToString("o")
  note = "Password is stored in the current user's environment variables for the experimental OfficeAgent sandbox identity spike."
} | ConvertTo-Json | Set-Content -Path $markerPath -Encoding UTF8

Write-Host "OfficeAgent sandbox logon-user spike is configured."
Write-Host "User: $Domain\$UserName"
Write-Host "Marker: $markerPath"
Write-Host "Restart OfficeAgent/dev shell before testing the app normally."
Write-Host "To test in this shell immediately, run:"
Write-Host "  `$env:OFFICE_AGENT_SANDBOX_IDENTITY_MODE='logon-user'"
Write-Host "  `$env:OFFICE_AGENT_SANDBOX_LOGON_USER='$UserName'"
Write-Host "  `$env:OFFICE_AGENT_SANDBOX_LOGON_DOMAIN='$Domain'"
Write-Host "  `$env:OFFICE_AGENT_SANDBOX_LOGON_PASSWORD='<stored in User env; reopen shell to load>'"
