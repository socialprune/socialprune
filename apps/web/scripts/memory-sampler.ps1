param([Parameter(Mandatory = $true)][string]$ProcessIds)
$ErrorActionPreference = 'Stop'
$ids = @($ProcessIds.Split(',') | ForEach-Object { [int]$_ })
# This stdout-only probe samples just the CDP-identified disposable browser.
# The measurement runner owns its lifetime. It never enumerates user profiles.
for ($sample = 0; $sample -lt 3000; $sample++) {
    $processes = @(Get-Process -Id $ids -ErrorAction SilentlyContinue)
    $working = [long]0
    $private = [long]0
    foreach ($process in $processes) {
        $working += $process.WorkingSet64
        $private += $process.PrivateMemorySize64
    }
    [Console]::WriteLine((@{
        at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        workingBytes = $working
        privateBytes = $private
        processes = @($processes | ForEach-Object { $_.Id })
    } | ConvertTo-Json -Compress))
    Start-Sleep -Milliseconds 100
}
