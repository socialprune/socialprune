param([string]$Scratch)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\..\packaging\install-readers.ps1"
$key='Software\SocialPrune-test-'+[Guid]::NewGuid().ToString()
$parent="$key\Uninstall"
$install=Join-Path $Scratch 'Programs\SocialPrune'
$before=Get-InstallLayout -Local $Scratch -Programs $Scratch -UninstallPath $parent
try {
  # Reproduce WriteRegStr HKCU <absent parent>\SocialPrune then DeleteRegKey
  # HKCU <parent>\SocialPrune, exactly the installer's ownership boundary.
  $entry=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$parent\SocialPrune")
  try { $entry.SetValue('DisplayName','SocialPrune') } finally { $entry.Dispose() }
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("$parent\SocialPrune")
  $settled=Get-InstallLayout -Local $Scratch -Programs $Scratch -UninstallPath $parent
  $again=Get-InstallLayout -Local $Scratch -Programs $Scratch -UninstallPath $parent
  @{before=$before;settled=$settled;again=$again;noChildProcessesStarted=$true;ownedProductAbsent=(-not $settled.installExists -and -not $settled.registrationExists -and $settled.existingShortcuts.Count -eq 0)} | ConvertTo-Json -Depth 8 -Compress
} finally { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($key) }
