param([ValidateSet('registration')][string]$Action)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\install-readers.ps1"
$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
try {
  $key=Get-InstallRegistration $base 'Software\Microsoft\Windows\CurrentVersion\Uninstall\SocialPrune'
  if($key) { $key | ConvertTo-Json -Compress } else { 'null' }
} finally { $base.Dispose() }
