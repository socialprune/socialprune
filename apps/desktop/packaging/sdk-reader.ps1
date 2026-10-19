. "$PSScriptRoot\windows-readers.ps1"
function Find-WindowsMakeAppx([string]$SdkRoot='C:\Program Files (x86)\Windows Kits\10\bin',[scriptblock]$FindCommand={ Get-Command makeappx.exe -ErrorAction Stop }) {
  $command=$null
  try { $command=& $FindCommand }
  catch [Management.Automation.CommandNotFoundException] { }
  $path=if($command) { $command.Source } else { $null }
  $absent=@()
  if(-not $path) {
    if(-not (Get-WindowsFileSystemItem $SdkRoot)) { $absent+='sdk-root' }
    foreach($version in @(Get-WindowsFolderEntries $SdkRoot | Where-Object { $_.PSIsContainer -and $_.Name -match '^10\.0\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending)) {
      $candidate=Join-Path $version.FullName 'x64\makeappx.exe'
      if(Get-WindowsFileSystemItem $candidate) { $path=$candidate; break }
    }
  }
  if($path) { return @{path=$path;version=[Diagnostics.FileVersionInfo]::GetVersionInfo($path).FileVersion;absent=@($absent)} }
  return @{path=$null;version=$null;absent=@($absent)+@('makeappx')}
}
