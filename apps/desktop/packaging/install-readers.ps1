. "$PSScriptRoot\windows-readers.ps1"
function Get-InstallRegistration($Base,[string]$Path) {
  $key=Open-WindowsRegistryKey $Base $Path
  if(-not $key) { return $null }
  try {
    $result=[ordered]@{}
    foreach($name in @('DisplayName','DisplayVersion','InstallLocation','UninstallString','QuietUninstallString')) { $result[$name]=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
    return $result
  } finally { $key.Dispose() }
}
function Get-InstallLayout(
  [string]$Local=[Environment]::GetFolderPath('LocalApplicationData',[Environment+SpecialFolderOption]::DoNotVerify),
  [string]$Programs=[Environment]::GetFolderPath('Programs',[Environment+SpecialFolderOption]::DoNotVerify),
  [string]$UninstallPath='Software\Microsoft\Windows\CurrentVersion\Uninstall'
) {
  $absent=[Collections.Generic.List[string]]::new()
  $install=if($Local) { Join-Path $Local 'Programs\SocialPrune' } else { $null }
  $data=if($Local) { Join-Path $Local 'SocialPrune Data' } else { $null }
  $shortcuts=if($Programs) { @((Join-Path $Programs 'SocialPrune.lnk'),(Join-Path $Programs 'SocialPrune\SocialPrune.lnk')) } else { @() }
  if(-not $Local) { $absent.Add('known-folder:LocalApplicationData') }
  if(-not $Programs) { $absent.Add('known-folder:Programs') }
  if(-not (Get-WindowsFileSystemItem $Programs)) { $absent.Add('start-menu:Programs') }
  $existing=@($shortcuts | Where-Object { $null -ne (Get-WindowsFileSystemItem $_) })
  $registration=$null
  $keys=@()
  foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
    $key=$null
    try {
      $key=Open-WindowsRegistryKey $base $UninstallPath
      if(-not $key) { $absent.Add("uninstall-root:$view"); continue }
      if($view -eq [Microsoft.Win32.RegistryView]::Registry64) { $registration=Get-InstallRegistration $base "$UninstallPath\SocialPrune" }
      foreach($name in $key.GetSubKeyNames()) {
        $child=Open-WindowsRegistryKey $key $name
        if(-not $child) { $absent.Add("uninstall-entry:$view|$name"); continue }
        try {
          if($child.GetValue('DisplayName') -ceq 'SocialPrune') { $keys+="$name|$($child.GetValue('UninstallString'))" }
        } finally { $child.Dispose() }
      }
    } finally { if($key) { $key.Dispose() }; $base.Dispose() }
  }
  if(-not $registration) { $absent.Add('registration:SocialPrune') }
  else {
    foreach($name in @('UninstallString','QuietUninstallString')) { if($null -eq $registration[$name]) { $absent.Add("registration-value:$name") } }
  }
  $installExists=$null -ne (Get-WindowsFileSystemItem $install)
  $dataExists=$null -ne (Get-WindowsFileSystemItem $data)
  if(-not $installExists) { $absent.Add('program-folder') }
  if(-not $dataExists) { $absent.Add('data-folder') }
  return @{ install=$install; data=$data; dataExists=$dataExists; installExists=$installExists; updateExists=($install -and $null -ne (Get-WindowsFileSystemItem (Join-Path $install 'Update.exe'))); shortcuts=@($shortcuts); existingShortcuts=$existing; registrationExists=($null -ne $registration); uninstallCommand=if($registration) {$registration.UninstallString} else {$null}; quietUninstallCommand=if($registration) {$registration.QuietUninstallString} else {$null}; registrations=@($keys|Sort-Object -Unique); absent=@($absent) }
}
