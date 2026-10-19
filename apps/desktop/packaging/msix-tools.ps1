param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
if ($OutputDirectory) {
  Add-Type -AssemblyName System.Drawing
  [void][IO.Directory]::CreateDirectory($OutputDirectory)
  foreach ($entry in @(@('StoreLogo.png', 50), @('Square44x44Logo.png', 44), @('Square150x150Logo.png', 150))) {
    $size = [int]$entry[1]
    $bitmap = New-Object Drawing.Bitmap($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $font = New-Object Drawing.Font('Segoe UI', ($size * 0.38), [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object Drawing.SolidBrush([Drawing.Color]::White)
    $format = New-Object Drawing.StringFormat
    try {
      $graphics.Clear([Drawing.Color]::FromArgb(20, 44, 55))
      $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
      $format.Alignment = [Drawing.StringAlignment]::Center
      $format.LineAlignment = [Drawing.StringAlignment]::Center
      $graphics.DrawString('SP', $font, $brush, (New-Object Drawing.RectangleF(0, 0, $size, $size)), $format)
      $bitmap.Save((Join-Path $OutputDirectory $entry[0]), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $format.Dispose(); $brush.Dispose(); $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
  }
}
$command = Get-Command makeappx.exe -ErrorAction SilentlyContinue
$path = if ($command) { $command.Source } else { $null }
if (-not $path) {
  $sdk = 'C:\Program Files (x86)\Windows Kits\10\bin'
  if (Test-Path -LiteralPath $sdk) {
    $versions = @(Get-ChildItem -LiteralPath $sdk -Directory | Where-Object { $_.Name -match '^10\.0\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending)
    foreach ($version in $versions) {
      $candidate = Join-Path $version.FullName 'x64\makeappx.exe'
      if (Test-Path -LiteralPath $candidate) { $path = $candidate; break }
    }
  }
}
if ($path) { @{ path = $path; version = [Diagnostics.FileVersionInfo]::GetVersionInfo($path).FileVersion } | ConvertTo-Json -Compress }
else { @{ path = $null; version = $null } | ConvertTo-Json -Compress }
