param([int]$BrowserPid,[int]$ExpectedTabs)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$pidCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$BrowserPid)
$windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$pidCondition)
if($windows.Count-ne1){throw 'GENERATED_WINDOW_COUNT'}
$window=$windows.Item(0)
if($window.Current.IsOffscreen){throw 'GENERATED_WINDOW_OFFSCREEN'}
$tabCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::TabItem)
$tabs=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$tabCondition)
if($tabs.Count-ne$ExpectedTabs){throw ('GENERATED_TAB_COUNT_'+$tabs.Count)}
$last=$tabs.Item($tabs.Count-1)
$selection=$last.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
$before=$selection.Current.IsSelected
$selection.Select()
[Console]::WriteLine((@{tabs=$tabs.Count;selectedBefore=$before;selectedAfter=$selection.Current.IsSelected;offscreen=$window.Current.IsOffscreen}|ConvertTo-Json -Compress))
