param([int]$AppProcessId, [string]$Executable, [int]$ExpectedItems, [int]$ReadinessTimeoutMs, [string]$Receipt)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\window-readiness.ps1"
Add-Type -Path "$PSScriptRoot\windows-query.cs"
$connections = @{}
$observeNetwork = {
  $processes = [DesktopQuery]::Query('processes', $Executable) | ConvertFrom-Json
  $ids = @($processes | ForEach-Object { $_.ProcessId })
  # Assign before enumeration: @('[]' | ConvertFrom-Json) has one empty-array
  # element on Windows PowerShell 5.1 and would invent a remote endpoint.
  $tcpConnections = (& "$PSScriptRoot\connections.ps1" -ProcessIds $ids) | ConvertFrom-Json
  foreach ($tcp in $tcpConnections) { $connections["$($tcp.processId)|$($tcp.remoteAddress)|$($tcp.remotePort)"] = $true }
  if ($connections.Count) { throw ('SMOKE_APP_OUTBOUND_TCP ' + ($connections.Keys -join ',')) }
}
# Preserve network observation throughout readiness as well as after it.
$ready = Wait-AppWindow -AppProcessId $AppProcessId -Mode Navigation -TimeoutMs $ReadinessTimeoutMs -Receipt $Receipt -OnPoll $observeNetwork
$window = $ready.window
$interactiveAt = $ready.interactiveAt
$observeUntil = [DateTime]::UtcNow.AddSeconds(3)
do {
  & $observeNetwork
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $observeUntil)
$processes = [DesktopQuery]::Query('processes', $Executable) | ConvertFrom-Json
$ids = @($processes | ForEach-Object { $_.ProcessId })
$listeners = (& "$PSScriptRoot\listeners.ps1" -ProcessIds $ids) | ConvertFrom-Json
$workingSet = [int64]0
foreach ($id in $ids) { $workingSet += (Get-Process -Id $id).WorkingSet64 }
if ($listeners.tcp -ne 0 -or $listeners.udp -ne 0) { throw 'SMOKE_APP_LISTENER' }
$pattern = $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
$pattern.Close()
@{ interactiveAt = $interactiveAt; workingSetBytes = $workingSet; processCount = $ids.Count; tcpListeners = $listeners.tcp; tcpConnections = $connections.Count; udpEndpoints = $listeners.udp; title = 'SocialPrune'; items = $ExpectedItems } | ConvertTo-Json -Compress
