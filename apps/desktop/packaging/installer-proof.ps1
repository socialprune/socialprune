param([ValidateSet('registration')][string]$Action)
$ErrorActionPreference = 'Stop'
$key = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SocialPrune' -ErrorAction SilentlyContinue
if ($key) { $key | Select-Object DisplayName,DisplayVersion,InstallLocation,UninstallString,QuietUninstallString | ConvertTo-Json -Compress }
else { 'null' }
