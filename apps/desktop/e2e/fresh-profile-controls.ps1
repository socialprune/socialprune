param([string]$Scratch,[string]$MarkerKey,[string]$MarkerValue)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\..\packaging\install-readers.ps1"
. "$PSScriptRoot\..\packaging\sdk-reader.ps1"
. "$PSScriptRoot\..\packaging\system-reference.ps1"
function Require($Condition,[string]$Message) { if(-not $Condition) { throw $Message } }
$absentKey='Software\SocialPrune-test-'+[guid]::NewGuid().ToString()+'\Uninstall'
$absentFolder=Join-Path $Scratch 'never-created'
$layout=Get-InstallLayout -Local (Join-Path $absentFolder 'Local') -Programs (Join-Path $absentFolder 'Programs') -UninstallPath $absentKey
Require (-not $layout.registrationExists -and $layout.registrations.Count -eq 0) 'MISSING_REGISTRY_NOT_EMPTY'
Require ($null -eq $layout.uninstallCommand -and $null -eq $layout.quietUninstallCommand) 'MISSING_VALUES_NOT_NULL'
Require ($layout.absent -contains 'uninstall-root:Registry64' -and $layout.absent -contains 'uninstall-root:Registry32') 'MISSING_REGISTRY_NOT_RECORDED'
Require (-not $layout.installExists -and -not $layout.dataExists -and $layout.existingShortcuts.Count -eq 0) 'MISSING_FOLDERS_NOT_EMPTY'
$missingKnown=Get-InstallLayout -Local '' -Programs '' -UninstallPath $absentKey
Require ($missingKnown.absent -contains 'known-folder:Programs' -and $missingKnown.absent -contains 'known-folder:LocalApplicationData') 'MISSING_KNOWN_FOLDER_NOT_RECORDED'
foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
  try {
    Require ($null -eq (Get-InstallRegistration $base $absentKey)) 'MISSING_REGISTRATION_NOT_NULL'
    Require (@(Get-WindowsRegistryValues $base $absentKey).Count -eq 0) 'MISSING_RUN_KEY_NOT_EMPTY'
  } finally { $base.Dispose() }
}
$partialPath='Software\SocialPrune-test-'+[guid]::NewGuid().ToString()
$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
try {
  Require ($null -eq (Open-WindowsRegistryKey $base $partialPath)) 'DISPOSABLE_REGISTRY_ALREADY_EXISTS'
  $key=$base.CreateSubKey($partialPath)
  try { $key.SetValue('DisplayName','SocialPrune') } finally { $key.Dispose() }
  $partial=Get-InstallRegistration $base $partialPath
  Require ($partial.DisplayName -ceq 'SocialPrune' -and $null -eq $partial.UninstallString -and $null -eq $partial.QuietUninstallString) 'ABSENT_SUBKEY_VALUES_NOT_NULL'
} finally { $base.DeleteSubKeyTree($partialPath,$false); $base.Dispose() }
Require (@(Get-WindowsFolderEntries $absentFolder).Count -eq 0) 'MISSING_FOLDER_NOT_EMPTY'
$file=Join-Path $Scratch 'not-a-folder.txt'
[IO.File]::WriteAllText($file,'generated')
$failed=$false
try { @(Get-WindowsFolderEntries $file) | Out-Null } catch { $failed=$_.Exception.Message -match 'EXPECTED_DIRECTORY' }
Require $failed 'NON_DIRECTORY_READ_DID_NOT_FAIL'
$denied=[pscustomobject]@{}
$denied | Add-Member ScriptMethod OpenSubKey { param($path,$writable) throw [UnauthorizedAccessException]::new('generated read denial') }
$failed=$false
try { Open-WindowsRegistryKey $denied 'generated' | Out-Null } catch { $failed=$_.Exception.ToString().Contains('generated read denial') }
Require $failed 'DENIED_REGISTRY_READ_BECAME_ABSENCE'
$missingScheduler=[pscustomobject]@{}
$missingScheduler | Add-Member ScriptMethod GetFolder { param($path) throw [Runtime.InteropServices.COMException]::new('generated absent folder',-2147024894) }
Require ($null -eq (Get-WindowsTaskFolder $missingScheduler '\generated')) 'MISSING_TASK_FOLDER_NOT_NULL'
$deniedScheduler=[pscustomobject]@{}
$deniedScheduler | Add-Member ScriptMethod GetFolder { param($path) throw [UnauthorizedAccessException]::new('generated task denial') }
$failed=$false
try { Get-WindowsTaskFolder $deniedScheduler '\generated' | Out-Null } catch { $failed=$_.Exception.ToString().Contains('generated task denial') }
Require $failed 'DENIED_TASK_READ_BECAME_ABSENCE'
$missingTask=[pscustomobject]@{}
$missingTask | Add-Member ScriptMethod GetTask { param($name) throw [Runtime.InteropServices.COMException]::new('generated absent task',-2147024894) }
Require ($null -eq (Get-WindowsRegisteredTask $missingTask 'generated')) 'MISSING_TASK_NOT_NULL'
Require ($null -eq (New-WindowsOptionalCom ('SocialPrune.GeneratedAbsent.'+[guid]::NewGuid()))) 'MISSING_COM_NOT_NULL'
$scheduler=New-WindowsOptionalCom 'Schedule.Service'
if($scheduler) {
  try {
    $scheduler.Connect()
    Require ($null -eq (Get-WindowsTaskFolder $scheduler ('\SocialPrune-test-'+[guid]::NewGuid()))) 'REAL_MISSING_TASK_FOLDER_NOT_NULL'
    $root=Get-WindowsTaskFolder $scheduler '\'
    try { Require ($null -eq (Get-WindowsRegisteredTask $root ('SocialPrune-test-'+[guid]::NewGuid()))) 'REAL_MISSING_TASK_NOT_NULL' }
    finally { Close-WindowsCom $root }
  } finally { Close-WindowsCom $scheduler }
}
$sdk=Find-WindowsMakeAppx -SdkRoot (Join-Path $Scratch 'missing-sdk') -FindCommand { $null }
Require ($null -eq $sdk.path -and $sdk.absent -contains 'sdk-root' -and $sdk.absent -contains 'makeappx') 'MISSING_SDK_NOT_RECORDED'
$failed=$false
try { Find-WindowsMakeAppx -SdkRoot $absentFolder -FindCommand { throw [UnauthorizedAccessException]::new('generated command denial') } | Out-Null } catch { $failed=$_.Exception.Message.Contains('generated command denial') }
Require $failed 'DENIED_SDK_READ_BECAME_ABSENCE'
Require (Test-InventoryAppReference (Join-Path $absentFolder 'SocialPrune\Uninstall.exe')) 'ABSENT_APP_PATH_NOT_ATTRIBUTED'
Require (-not (Test-InventoryAppReference 'C:\Windows\System32\generated.exe /name:generated *')) 'CONFIG_TEXT_WRONGLY_PARSED_AS_PATH'
$shortFolder=Join-Path $Scratch 'SocialPrune generated missing child'
[void][IO.Directory]::CreateDirectory($shortFolder)
try {
  $fso=New-Object -ComObject Scripting.FileSystemObject
  $object=$null
  try {
    $object=$fso.GetFolder($shortFolder)
    $short=$object.ShortPath
    Require (Test-InventoryAppReference ($short+'\missing.exe /name:generated *')) 'SHORT_PATH_ARGUMENTS_NOT_ATTRIBUTED'
  } finally { Close-WindowsCom $object; Close-WindowsCom $fso }
} finally { [IO.Directory]::Delete($shortFolder,$false) }
# Inject exceptions only in this test entrypoint, not through production args
# or environment variables. Only not-found may become an empty filesystem.
function Get-Item { [CmdletBinding()]param([string]$LiteralPath,[switch]$Force) throw [UnauthorizedAccessException]::new('generated filesystem denial') }
$failed=$false
try { Get-WindowsFileSystemItem $absentFolder | Out-Null } catch { $failed=$_.Exception.ToString().Contains('generated filesystem denial') }
Remove-Item Function:\Get-Item
Require $failed 'DENIED_FOLDER_READ_BECAME_ABSENCE'
function New-Object { [CmdletBinding()]param([string]$ComObject) throw [Runtime.InteropServices.COMException]::new('generated COM denial',-2147024891) }
$failed=$false
try { New-WindowsOptionalCom 'generated' | Out-Null } catch { $failed=$_.Exception.ToString().Contains('generated COM denial') }
Remove-Item Function:\New-Object
Require $failed 'DENIED_COM_READ_BECAME_ABSENCE'
$profileVerified=$false
if($MarkerKey) {
  $hive=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($MarkerKey,$false)
  try { Require ($null -ne $hive -and $hive.GetValue('Marker') -ceq $MarkerValue) 'RESTRICTED_HKCU_MARKER_MISSING'; $profileVerified=$true }
  finally { if($hive) { $hive.Dispose() } }
}
@{ proof='fresh-profile-readers'; missingRegistryViews=2; registrationAndValuesNull=$true; missingRunKeysEmpty=$true; missingKnownFoldersRecorded=$true; missingStartMenuAndStartupEmpty=$true; missingTaskFolderAndTaskNull=$true; absentComRecorded=$true; absentSdkRecorded=$true; deniedAndWrongTypeReadsFailed=$true; absentAppPathAttributed=$true; restrictedChildReadsParentHkcuMarker=$profileVerified } | ConvertTo-Json -Compress
