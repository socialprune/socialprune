$ErrorActionPreference = 'Stop'
$local = [Environment]::GetFolderPath('LocalApplicationData')
$programs = [Environment]::GetFolderPath('Programs')
$install = Join-Path $local 'Programs\SocialPrune'
$data = Join-Path $local 'SocialPrune Data'
$shortcuts = @((Join-Path $programs 'SocialPrune.lnk'), (Join-Path $programs 'SocialPrune\SocialPrune.lnk'))
$existing = @($shortcuts | Where-Object { Test-Path -LiteralPath $_ })
$registration = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SocialPrune' -ErrorAction SilentlyContinue
$keys = @()
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
  try {
    $key = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall', $false)
    try {
      foreach ($name in $key.GetSubKeyNames()) {
        $child = $key.OpenSubKey($name, $false)
        try { if ($child.GetValue('DisplayName') -ceq 'SocialPrune') { $keys += "$name|$($child.GetValue('UninstallString'))" } }
        finally { $child.Dispose() }
      }
    } finally { $key.Dispose() }
  } finally { $base.Dispose() }
}
@{ install = $install; data = $data; dataExists = (Test-Path -LiteralPath $data); installExists = (Test-Path -LiteralPath $install); updateExists = (Test-Path -LiteralPath (Join-Path $install 'Update.exe')); shortcuts = @($shortcuts); existingShortcuts = @($existing); registrationExists = ($null -ne $registration); uninstallCommand = if ($registration) { [string]$registration.UninstallString } else { $null }; quietUninstallCommand = if ($registration) { [string]$registration.QuietUninstallString } else { $null }; registrations = @($keys | Sort-Object -Unique) } | ConvertTo-Json -Depth 3 -Compress
