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
  $name=$tabs.Item($index).Current.Name
  $kind=if($name.Contains('Generated reading probe')){'reading'}elseif($name.Contains('Generated confirmation probe')){'confirmation'}else{'unrecognized'}
  $states+=@{index=$index;kind=$kind;selected=$pattern.Current.IsSelected}
}
[Console]::WriteLine((@{count=$tabs.Count;tabs=$states;offscreen=$window.Current.IsOffscreen}|ConvertTo-Json -Compress -Depth 4))
