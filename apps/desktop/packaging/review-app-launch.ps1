param([string]$Executable,[string]$ArgumentsFile,[string]$DesktopPath,[string]$Receipt,[string]$StopFile,[int]$TimeoutMs)
$ErrorActionPreference='Stop'
Add-Type -Path "$PSScriptRoot\review-app-launch.cs"
$arguments=[string[]]([IO.File]::ReadAllText($ArgumentsFile)|ConvertFrom-Json)
$resolved=(Get-Command -Name $Executable -CommandType Application -ErrorAction Stop).Source
[ReviewAppLaunch]::Run($resolved,$arguments,$DesktopPath,$Receipt,$StopFile,$TimeoutMs)
