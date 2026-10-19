param([int]$AppProcessId)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class InactiveWindowProbe {
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern bool IsIconic(IntPtr window);
}
'@
$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$AppProcessId)
$deadline=[DateTime]::UtcNow.AddSeconds(45)
while([DateTime]::UtcNow-lt$deadline){
 $candidate=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,$condition)
 if($candidate){
  $keep=@($candidate.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object{$_.Current.Name-match'^Keep(\s|$)'-and$_.Current.ControlType-eq[System.Windows.Automation.ControlType]::Button-and$_.Current.IsEnabled})
  if($keep.Count){
   # The accessibility tree can precede Electron's explicit show. Observe the
   # settled launch state without activating, restoring or changing its bounds.
   Start-Sleep -Seconds 2
   $handle=[IntPtr]$candidate.Current.NativeWindowHandle
   @{readyAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();foreground=([InactiveWindowProbe]::GetForegroundWindow()-eq$handle);minimized=[InactiveWindowProbe]::IsIconic($handle);actionOffscreen=$keep[0].Current.IsOffscreen;actionFocused=$keep[0].Current.HasKeyboardFocus}|ConvertTo-Json -Compress
   exit 0
  }
 }
 Start-Sleep -Milliseconds 50
}
throw 'INACTIVE_RELEASE_ACTION_MISSING'
