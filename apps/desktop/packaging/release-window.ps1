param([int]$AppProcessId, [string]$Executable, [switch]$CloseOnly, [int]$ReadinessTimeoutMs, [string]$Receipt)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\window-readiness.ps1"
Add-Type -Path "$PSScriptRoot\windows-query.cs"
$mode = if ($CloseOnly) { 'Close' } else { 'ReviewAction' }
$ready = Wait-AppWindow -AppProcessId $AppProcessId -Mode $mode -TimeoutMs $ReadinessTimeoutMs -Receipt $Receipt
$window = $ready.window
$interactiveAt = $ready.interactiveAt
if ($CloseOnly) { $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close(); exit 0 }
Start-Sleep -Seconds 3
$processes = [DesktopQuery]::Query('processes', $Executable) | ConvertFrom-Json
$ids = @($processes | ForEach-Object { $_.ProcessId })
if (-not ($ids -contains $AppProcessId)) { throw 'RELEASE_PROCESS_MISSING' }
$workingSet = [int64]0
foreach ($id in $ids) { $workingSet += (Get-Process -Id $id).WorkingSet64 }
$listeners = (& "$PSScriptRoot\listeners.ps1" -ProcessIds $ids) | ConvertFrom-Json
$connections = (& "$PSScriptRoot\connections.ps1" -ProcessIds $ids) | ConvertFrom-Json
if ($listeners.tcp -ne 0 -or $listeners.udp -ne 0 -or @($connections).Count -ne 0) { throw 'RELEASE_APP_NETWORK' }
@{ interactiveAt = $interactiveAt; workingSetBytes = $workingSet; processCount = $ids.Count; title = $window.Current.Name; enabledReviewActionFocused = $true } | ConvertTo-Json -Compress
