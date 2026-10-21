param([int]$AppProcessId, [string]$Language, [string]$Receipt)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\packaging\window-readiness.ps1"
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class StartupNativeChildren {
  delegate bool Callback(IntPtr window,IntPtr argument);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr window,Callback callback,IntPtr argument);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window,StringBuilder text,int size);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr window,StringBuilder text,int size);
  [DllImport("user32.dll")] static extern IntPtr SendMessageW(IntPtr window,uint message,IntPtr wparam,IntPtr lparam);
  public sealed class Child { public long hwnd;public string kind,text; }
  public static Child[] Read(IntPtr window) {
    var rows=new List<Child>();
    EnumChildWindows(window,delegate(IntPtr child,IntPtr argument){var text=new StringBuilder(1024);var kind=new StringBuilder(256);GetWindowTextW(child,text,text.Capacity);GetClassNameW(child,kind,kind.Capacity);rows.Add(new Child{hwnd=child.ToInt64(),kind=kind.ToString(),text=text.ToString()});return true;},IntPtr.Zero);
    return rows.ToArray();
  }
  public static void Click(IntPtr window) { SendMessageW(window,0xF5,IntPtr.Zero,IntPtr.Zero); }
}
'@
$message=if($Language -eq 'de'){'SocialPrune konnte nicht starten'}else{'SocialPrune could not start'}
$button=if($Language -eq 'de'){'Beenden'}else{'Quit'}
$desktop=[ReadinessWindows]::OpenOwned($AppProcessId,$env:SP_PROOF_DESKTOP)
$watch=[ReadinessWindows]::WatchApp($AppProcessId,$env:SP_PROOF_DESKTOP)
$clock=[Diagnostics.Stopwatch]::StartNew()
$last=@()
try {
  do {
    $last=@()
    foreach($owned in $watch.ObserveApp().windows) {
      $handle=[IntPtr]$owned.hwnd
      try {
        $root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
        $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
        $names=@($all | ForEach-Object { $_.Current.Name })
        $native=@([StartupNativeChildren]::Read($handle))
        $last+=@{root=$root.Current.Name;names=$names;native=$native;hwnd=$owned.hwnd}
        if(@($native | Where-Object {$_.text -ceq $button -and $_.kind -eq 'Button'}).Count -gt 0) {
          $actions=@($native | Where-Object {$_.kind -eq 'Button' -and $_.text -ceq $button})
          if($actions.Count -ne 1 -or @($native | Where-Object {$_.kind -eq 'Button'}).Count -ne 1) { throw 'STARTUP_NATIVE_BUTTONS' }
          $evidence=@{buttons=@($button);nativeDialog=$true;disposableDesktop=$true;elapsedMs=$clock.ElapsedMilliseconds;invoked=$true;readback='native-button-text';messageReadback='recorded-call; DirectUI text unavailable on non-input desktop'}
          [StartupNativeChildren]::Click([IntPtr]$actions[0].hwnd)
          [IO.File]::WriteAllText($Receipt,($evidence|ConvertTo-Json -Compress))
          exit 0
        }
        if($names -notcontains $message) { continue }
        $buttons=@($all | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -notin @('Close','Schließen') })
        if($buttons.Count -ne 1 -or $buttons[0].Current.Name -cne $button) { throw 'STARTUP_NATIVE_BUTTONS' }
        $evidence=@{message=$message;buttons=@($button);nativeDialog=$true;disposableDesktop=$true;elapsedMs=$clock.ElapsedMilliseconds;invoked=$true}
        $action=$buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $action.Invoke()
        [IO.File]::WriteAllText($Receipt,($evidence|ConvertTo-Json -Compress))
        exit 0
      } catch [System.Windows.Automation.ElementNotAvailableException] { }
    }
    Start-Sleep -Milliseconds 50
  } while($clock.ElapsedMilliseconds -lt 30000)
  [Console]::Error.WriteLine('STARTUP_NATIVE_OBSERVATION '+(@{windows=$last;app=$watch.ObserveApp()}|ConvertTo-Json -Depth 8 -Compress))
  throw 'STARTUP_NATIVE_MESSAGE_MISSING'
} finally { $watch.Dispose();$desktop.Dispose() }
