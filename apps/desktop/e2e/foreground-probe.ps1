param([string]$Ready,[string]$Stop)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class ForegroundProbe{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();}'
$initial=[ForegroundProbe]::GetForegroundWindow();$changed=$false;$samples=0
if($Ready -and $Stop){
  [IO.File]::WriteAllText($Ready,'ready')
  $clock=[Diagnostics.Stopwatch]::StartNew()
  while(-not [IO.File]::Exists($Stop) -and $clock.ElapsedMilliseconds -lt 10000){
    if([ForegroundProbe]::GetForegroundWindow() -ne $initial){$changed=$true}
    $samples++;[Threading.Thread]::Sleep(5)
  }
}
@{handle=$initial.ToInt64().ToString();changed=$changed;samples=$samples;final=[ForegroundProbe]::GetForegroundWindow().ToInt64().ToString()}|ConvertTo-Json -Compress
