param([Parameter(Mandatory=$true)][string]$TempRoot,
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$ArgumentsFile,
  [Parameter(Mandatory=$true)][string]$Receipt)
$ErrorActionPreference='Stop'
$save=[Action[object]] { param($value)
  [IO.File]::WriteAllText($Receipt,($value | ConvertTo-Json -Depth 12 -Compress))
}
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'uninstaller-capture.cs')
  $arguments=[string[]](ConvertFrom-Json ([IO.File]::ReadAllText($ArgumentsFile)))
  $result=[UninstallerCapture]::Run($Executable,$arguments,$TempRoot,$save)
} catch {
  if([IO.File]::Exists($Receipt)) {
    $result=ConvertFrom-Json ([IO.File]::ReadAllText($Receipt))
    $result.state='failed'
    $result.failure='NSIS_CAPTURE_FAILED'
  } else {
    $result=@{version=1;mechanism='debug-process-events';state='failed';failure='NSIS_CAPTURE_INITIALIZATION_FAILED';queryErrors=@('NSIS_CAPTURE_INITIALIZATION_FAILED')}
  }
  $save.Invoke($result)
}
$json=[IO.File]::ReadAllText($Receipt)
[Console]::WriteLine('NSIS_COPY_RECEIPT '+$json)
if($result.state -ne 'passed') { throw $result.failure }
