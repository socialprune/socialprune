param([int[]]$ProcessIds)
$ErrorActionPreference = 'Stop'
if (-not $ProcessIds.Count -or @($ProcessIds | Where-Object { $_ -le 0 }).Count) { throw 'INVALID_PROCESS_IDS' }
if (-not ('DesktopQuery' -as [type])) { Add-Type -Path "$PSScriptRoot\windows-query.cs" }
[DesktopQuery]::Query('listeners', ($ProcessIds -join ','))
