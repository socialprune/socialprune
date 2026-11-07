param([string]$Ready,[string]$Activate,[string]$Stop)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$form=New-Object System.Windows.Forms.Form
$form.Text='Generated foreground sentinel'
$form.Width=420
$form.Height=260
$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=20
$script:last=''
$timer.Add_Tick({
  if(Test-Path -LiteralPath $Stop){$form.Close();return}
  if(Test-Path -LiteralPath $Activate){
    $value=[System.IO.File]::ReadAllText($Activate)
    if($value-ne$script:last){$script:last=$value;$form.Activate()}
  }
})
$form.Add_Shown({
  $form.Activate()
  $area=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  [System.IO.File]::WriteAllText($Ready,(@{handle=$form.Handle.ToInt64().ToString();area=@{x=$area.X;y=$area.Y;width=$area.Width;height=$area.Height}}|ConvertTo-Json -Compress))
  $timer.Start()
})
try{[void]$form.ShowDialog()}finally{$timer.Dispose();$form.Dispose()}
