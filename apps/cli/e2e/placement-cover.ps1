param([string]$Bounds,[string]$Ready,[string]$Stop)
# Runner-only probe helper: an opaque, borderless generated window that fully
# covers the given bounds, the way another program in front covers the run
# window. It is shown normally in front (not topmost), like any application,
# and reports whether it really is the window at the covered area's centre.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace Probe -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr WindowFromPoint(System.Drawing.Point p);
[DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr h, uint flags);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
'@ -ReferencedAssemblies System.Drawing
$b=$Bounds.Split(',')|ForEach-Object{[int]$_}
$form=New-Object System.Windows.Forms.Form
$form.Text='Generated covering window'
$form.FormBorderStyle='None'
$form.StartPosition='Manual'
$form.BackColor=[System.Drawing.Color]::Black
$form.Opacity=1.0
$form.ShowInTaskbar=$false
$form.Bounds=New-Object System.Drawing.Rectangle(($b[0]-20),($b[1]-20),($b[2]+40),($b[3]+40))
$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=20
$timer.Add_Tick({ if(Test-Path -LiteralPath $Stop){$form.Close()} })
$form.Add_Shown({
  $form.Activate()
  $form.Refresh()
  $r=$form.Bounds
  $center=New-Object System.Drawing.Point(($b[0]+[int]($b[2]/2)),($b[1]+[int]($b[3]/2)))
  $hit=[Probe.Win]::GetAncestor([Probe.Win]::WindowFromPoint($center),2)
  [System.IO.File]::WriteAllText($Ready,(@{handle=$form.Handle.ToInt64().ToString();x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height;onTopAtCenter=($hit -eq $form.Handle);foreground=([Probe.Win]::GetForegroundWindow() -eq $form.Handle)}|ConvertTo-Json -Compress))
  $timer.Start()
})
try{[void]$form.ShowDialog()}finally{$timer.Dispose();$form.Dispose()}
