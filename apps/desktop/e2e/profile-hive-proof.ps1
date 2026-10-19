param([string]$MarkerKey,[string]$Marker,[string]$ExpectedSid,[string]$Report)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\..\packaging\windows-readers.ps1"
if($MarkerKey -cnotmatch '^Software\\SocialPrune-test-[a-f0-9-]{36}$') { throw 'PROFILE_PROOF_KEY_REFUSED' }
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try {
  if($identity.User.Value -cne $ExpectedSid) { throw 'RESTRICTED_PROFILE_USER_CHANGED' }
  $key=Open-WindowsRegistryKey ([Microsoft.Win32.Registry]::CurrentUser) $MarkerKey
  if(-not $key) { throw 'RESTRICTED_HKCU_PARENT_MARKER_ABSENT' }
  try { if($key.GetValue('Marker') -cne $Marker) { throw 'RESTRICTED_HKCU_PARENT_MARKER_DIFFERS' } }
  finally { $key.Dispose() }
  $folders=[ordered]@{}
  foreach($name in @('LocalApplicationData','Programs','Startup','CommonStartup')) {
    $path=[Environment]::GetFolderPath([Environment+SpecialFolder]$name,[Environment+SpecialFolderOption]::DoNotVerify)
    $folders[$name]=if(-not $path) { 'unknown' } elseif(Get-WindowsFileSystemItem $path) { 'present' } else { 'absent' }
  }
  @{ sameUserSid=$true; parentHkcuMarkerRead=$true; loadUserProfileCalled=$false; knownFolders=$folders } | ConvertTo-Json -Compress | Set-Content -LiteralPath $Report -Encoding UTF8
} finally { $identity.Dispose() }
