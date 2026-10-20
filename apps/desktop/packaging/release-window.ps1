param([int]$AppProcessId, [string]$Executable, [switch]$CloseOnly)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -Path "$PSScriptRoot\windows-query.cs"
$pidCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppProcessId)
$nameCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'SocialPrune')
$condition = New-Object System.Windows.Automation.AndCondition($pidCondition, $nameCondition)
$deadline = [DateTime]::UtcNow.AddSeconds(45)
$window = $null
$interactiveAt = $null
while ([DateTime]::UtcNow -lt $deadline) {
  $candidate = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
  if ($candidate) {
    if ($CloseOnly) { $window = $candidate; break }
    $keep = @($candidate.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name -match '^Keep(\s|$)' -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.IsEnabled })
    if ($keep.Count) {
      # An enabled review action on generated data, not just a window title or
      # static navigation. Focus is read back without writing a decision.
      $keep[0].SetFocus()
      if ($keep[0].Current.HasKeyboardFocus -and -not $keep[0].Current.IsOffscreen) {
        $interactiveAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $window = $candidate
        break
      }
    }
  }
  Start-Sleep -Milliseconds 50
}
if (-not $window) { throw 'RELEASE_INTERACTIVE_FRAME_MISSING' }
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
