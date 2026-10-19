# Read-only Windows primitives. Production wrappers select fixed paths; tests
# inject only disposable paths or reader objects into these functions.
function Test-WindowsNotFound($Exception) {
  $error=$Exception
  while($error) {
    if($error -is [IO.FileNotFoundException] -or $error -is [IO.DirectoryNotFoundException] -or $error -is [Management.Automation.ItemNotFoundException]) { return $true }
    if($error.HResult -in @(-2147024894,-2147024893)) { return $true } # HRESULT_FROM_WIN32(2/3)
    $error=$error.InnerException
  }
  return $false
}
function Get-WindowsFileSystemItem([string]$Path) {
  if([string]::IsNullOrWhiteSpace($Path)) { return $null }
  try { return Get-Item -LiteralPath $Path -Force -ErrorAction Stop }
  catch { if(Test-WindowsNotFound $_.Exception) { return $null }; throw }
}
function Get-WindowsFolderEntries([string]$Path) {
  $folder=Get-WindowsFileSystemItem $Path
  if(-not $folder) { return }
  if(-not $folder.PSIsContainer) { throw 'WINDOWS_INVENTORY_EXPECTED_DIRECTORY' }
  try { Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop }
  catch { if(Test-WindowsNotFound $_.Exception) { return }; throw }
}
function Open-WindowsRegistryKey($Base,[string]$Path) {
  # .NET returns null only for a missing key; permission and I/O errors throw.
  return $Base.OpenSubKey($Path,$false)
}
function Get-WindowsRegistryValues($Base,[string]$Path) {
  $key=Open-WindowsRegistryKey $Base $Path
  if(-not $key) { return }
  try {
    foreach($name in $key.GetValueNames()) {
      try {
        $kind=$key.GetValueKind($name)
        $value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        @{name=$name;kind=[string]$kind;value=$value;securityDescriptor=$key.GetAccessControl().Sddl}
      } catch { if(-not (Test-WindowsNotFound $_.Exception)) { throw } }
    }
  } finally { $key.Dispose() }
}
function Get-WindowsTaskFolder($Scheduler,[string]$Path) {
  try { return $Scheduler.GetFolder($Path) }
  catch { if(Test-WindowsNotFound $_.Exception) { return $null }; throw }
}
function Get-WindowsRegisteredTask($Folder,[string]$Name) {
  if(-not $Folder) { return $null }
  try { return $Folder.GetTask($Name) }
  catch { if(Test-WindowsNotFound $_.Exception) { return $null }; throw }
}
function New-WindowsOptionalCom([string]$Class) {
  try { return New-Object -ComObject $Class -ErrorAction Stop }
  catch {
    $error=$_.Exception
    while($error) {
      if($error.HResult -eq -2147221164) { return $null } # REGDB_E_CLASSNOTREG
      $error=$error.InnerException
    }
    throw
  }
}
function Close-WindowsCom($Object) {
  if($Object) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($Object) }
}
if(-not ('WindowsReadPath' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class WindowsReadPath {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetLongPathNameW(string path,StringBuilder output,uint size);
  public static string Resolve(string path) {
    var output=new StringBuilder(32768);
    uint size=GetLongPathNameW(path,output,(uint)output.Capacity);
    if(size>0&&size<output.Capacity) return output.ToString();
    int error=Marshal.GetLastWin32Error();
    if(size==0&&(error==2||error==3)) return null;
    throw new Win32Exception(size>=output.Capacity?122:error,"WINDOWS_LONG_PATH_READ");
  }
}
'@
}
