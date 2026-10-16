param([int]$AppProcessId, [string]$Executable, [int]$ExpectedItems)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppProcessId)
$deadline = [DateTime]::UtcNow.AddSeconds(30)
$window = $null
while ([DateTime]::UtcNow -lt $deadline) {
  $candidate = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
  if ($candidate -and $candidate.Current.Name -eq 'SocialPrune') {
    $names = @($candidate.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name })
    if ($names -contains [string]$ExpectedItems) { $window = $candidate; break }
  }
  Start-Sleep -Milliseconds 100
}
if (-not $window) { throw 'SMOKE_INTERACTIVE_WINDOW_MISSING' }
$interactiveAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$processes = @((Get-CimInstance Win32_Process -Filter "Name = 'SocialPrune.exe'") | Where-Object { $_.ExecutablePath -eq $Executable })
$ids = @($processes | ForEach-Object { $_.ProcessId })
$listeners = (& "$PSScriptRoot\listeners.ps1" -ProcessIds $ids) | ConvertFrom-Json
$workingSet = [int64]0
foreach ($id in $ids) { $workingSet += (Get-Process -Id $id).WorkingSet64 }
if ($listeners.tcp -ne 0 -or $listeners.udp -ne 0) { throw 'SMOKE_APP_LISTENER' }
$pattern = $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
$pattern.Close()
@{ interactiveAt = $interactiveAt; workingSetBytes = $workingSet; processCount = $ids.Count; tcpListeners = $listeners.tcp; udpEndpoints = $listeners.udp; title = 'SocialPrune'; items = $ExpectedItems } | ConvertTo-Json -Compress
