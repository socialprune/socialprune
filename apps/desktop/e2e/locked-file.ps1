param([string]$Path, [string]$Ready, [string]$Stop)
$ErrorActionPreference='Stop'
$handle=[IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
  [IO.File]::WriteAllText($Ready,'locked-without-delete-sharing')
  $deadline=[DateTime]::UtcNow.AddSeconds(90)
  while(-not [IO.File]::Exists($Stop)) {
    if([DateTime]::UtcNow -gt $deadline) { throw 'LOCK_CONTROL_DEADLINE' }
    Start-Sleep -Milliseconds 50
  }
} finally { $handle.Dispose() }
