param([string]$TempRoot,[string]$Ready,[string]$Poll)
$ErrorActionPreference='Stop'
[IO.File]::WriteAllText($Ready,'watching')
# Test-only ordering seam: the outer and its child exit before the first poll.
while(-not [IO.File]::Exists($Poll)) { [Threading.Thread]::Sleep(5) }
$codes=@(); $seen=$false
$deadline=[DateTime]::UtcNow.AddMilliseconds(200)
while([DateTime]::UtcNow -lt $deadline) {
  foreach($process in [Diagnostics.Process]::GetProcessesByName('Un')) {
    try {
      if($process.MainModule.FileName.StartsWith($TempRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) {
        $seen=$true
        $handle=$process.Handle
        if(-not $process.WaitForExit(67130)) { throw 'NSIS_COPY_DID_NOT_EXIT' }
        $codes += $process.ExitCode
      }
    } catch [InvalidOperationException] { } finally { $process.Dispose() }
  }
  if($seen) { break }
  Start-Sleep -Milliseconds 5
}
if(-not $seen) { throw 'NSIS_COPY_NOT_OBSERVED' }
@{exitCodes=@($codes);remaining=0}|ConvertTo-Json -Compress
