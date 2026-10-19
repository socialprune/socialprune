param([string]$RunRoot)
$ErrorActionPreference='Stop'
# RunRoot is an already-created harness scratch folder. The short form, when
# enabled on its volume, must resolve through the production normalizer.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class InventoryAccess {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetLongPathNameW(string path,StringBuilder result,uint size);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetShortPathNameW(string path,StringBuilder result,uint size);
  public static string LongPath(string path) { var value=new StringBuilder(32768); return GetLongPathNameW(path,value,(uint)value.Capacity)>0?value.ToString():path; }
  public static string ShortPath(string path) { var value=new StringBuilder(32768); return GetShortPathNameW(path,value,(uint)value.Capacity)>0?value.ToString():path; }
}
'@
. "$PSScriptRoot\..\packaging\system-reference.ps1"
$folder=Join-Path $RunRoot 'SocialPrune generated attribution'
if(Test-Path -LiteralPath $folder) { throw 'REFERENCE_CONTROL_PATH_EXISTS' }
[void][IO.Directory]::CreateDirectory($folder)
try {
  foreach($text in @('%LOCALAPPDATA%\Programs\SocialPrune\SocialPrune.exe','<Exec><Command>sOcIaLpRuNe.exe</Command></Exec>','C:\generated\UNINSTALL.EXE','C:\generated\Un.exe')) {
    if(-not (Test-InventoryAppReference $text)) { throw 'REFERENCE_CONTROL_NOT_ATTRIBUTED' }
  }
  if(Test-InventoryAppReference 'C:\Windows\system32\generated-service.exe') { throw 'REFERENCE_CONTROL_FALSE_ATTRIBUTION' }
  $short=[InventoryAccess]::ShortPath($folder)
  if(-not (Test-InventoryAppReference ($short+'\not-yet-created.exe --argument'))) { throw 'REFERENCE_SHORT_PATH_MISSED' }
  @{ expandedEnvironment=$true; mixedCase=$true; xml=$true; uninstallerNames=$true; shortPathAvailable=($short -cne $folder); shortOrLongPathAttributed=$true; foreignPathNotAttributed=$true } | ConvertTo-Json -Compress
} finally { [IO.Directory]::Delete($folder,$false) }
