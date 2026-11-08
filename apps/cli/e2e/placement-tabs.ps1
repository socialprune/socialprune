param([int]$BrowserPid)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$BrowserPid)
$windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$condition)
if($windows.Count-ne1){throw 'GENERATED_WINDOW_COUNT'}
$window=$windows.Item(0)
$tabCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::TabItem)
$tabs=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$tabCondition)
$states=@()
for($index=0;$index-lt$tabs.Count;$index++){
  $pattern=$tabs.Item($index).GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
  $states+=@{index=$index;selected=$pattern.Current.IsSelected}
}
[Console]::WriteLine((@{count=$tabs.Count;tabs=$states;offscreen=$window.Current.IsOffscreen}|ConvertTo-Json -Compress -Depth 4))
