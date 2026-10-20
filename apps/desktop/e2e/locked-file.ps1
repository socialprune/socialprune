param([string]$Path, [string]$Ready, [string]$Stop)
$ErrorActionPreference='Stop'
$handle=[IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
  [IO.File]::WriteAllText($Ready,'locked-without-delete-sharing')
  # R14 2026-10-20: the parent makes at most four buffered queries while
  # holding this generated file. No runner layout sample yet; reserve three
  # complete 60 s windows per query plus the parent's 50 ms poll interval.
  $deadline=[DateTime]::UtcNow.AddMilliseconds(720050)
  while(-not [IO.File]::Exists($Stop)) {
    if([DateTime]::UtcNow -gt $deadline) { throw 'LOCK_CONTROL_DEADLINE' }
    Start-Sleep -Milliseconds 50
  }
} finally { $handle.Dispose() }
