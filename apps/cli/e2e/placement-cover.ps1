param([string]$Bounds,[string]$Ready,[string]$Stop)
# Runner-only probe helper: an opaque, borderless generated window that fully
# covers the given bounds, the way another program in front covers the run
# window. It is shown normally in front (not topmost), like any application.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
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
  $r=$form.Bounds
  [System.IO.File]::WriteAllText($Ready,(@{handle=$form.Handle.ToInt64().ToString();x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height}|ConvertTo-Json -Compress))
  $timer.Start()
})
try{[void]$form.ShowDialog()}finally{$timer.Dispose();$form.Dispose()}
