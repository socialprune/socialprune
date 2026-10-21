param([int]$AppProcessId, [int]$ReadinessTimeoutMs, [string]$Receipt, [string]$DesktopPath = $env:SP_PROOF_DESKTOP)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\..\packaging\window-readiness.ps1"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class InactiveWindowProbe {
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern bool IsIconic(IntPtr window);
}
'@
$ready=Wait-AppWindow -AppProcessId $AppProcessId -Mode ObserveAction -TimeoutMs $ReadinessTimeoutMs -Receipt $Receipt -DesktopPath $DesktopPath
# Observe settled launch state without activating or changing bounds.
Start-Sleep -Seconds 2
$handle=[IntPtr]$ready.window.Current.NativeWindowHandle
@{readyAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();foreground=([InactiveWindowProbe]::GetForegroundWindow()-eq$handle);minimized=[InactiveWindowProbe]::IsIconic($handle);actionOffscreen=$ready.action.Current.IsOffscreen;actionFocused=$ready.action.Current.HasKeyboardFocus}|ConvertTo-Json -Compress
