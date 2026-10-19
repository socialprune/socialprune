param([string]$Root)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$files=@{'makensis.exe'='generated compiler, never executed';'Stubs/zlib-x86-unicode'='generated stub, never executed';'Contrib/Language files/English.nlf'='generated language file'}
$archive=[IO.Compression.ZipFile]::Open((Join-Path $Root 'parent\nsis-3.13.zip'),'Create')
try {
  foreach($name in $files.Keys) {
    $entry=$archive.CreateEntry('nsis-3.13/'+$name)
    $writer=[IO.StreamWriter]::new($entry.Open())
    try { $writer.Write($files[$name]) } finally { $writer.Dispose() }
  }
} finally { $archive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $Root 'parent\nsis-3.13.zip'),(Join-Path $Root 'parent\nsis-tools'))
