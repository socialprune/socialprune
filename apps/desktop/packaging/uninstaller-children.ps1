param([string]$TempRoot, [string]$Ready)
$ErrorActionPreference='Stop'
$codes=@()
# CI 39395902168 (2026-10-20): process query max 22375 ms.
# 3 complete observations plus the 5 ms poll interval; native Process reads stay.
$deadline=[DateTime]::UtcNow.AddMilliseconds(67130)
[IO.File]::WriteAllText($Ready,'watching')
$seen=$false
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
@{ exitCodes=@($codes); remaining=0 } | ConvertTo-Json -Compress
