param([int[]]$ProcessIds)
$ErrorActionPreference = 'Stop'
if (-not $ProcessIds.Count -or @($ProcessIds | Where-Object { $_ -le 0 }).Count) { throw 'INVALID_PROCESS_IDS' }
$rows = @((Get-NetTCPConnection -ErrorAction SilentlyContinue) | Where-Object { $ProcessIds -contains $_.OwningProcess -and $_.State -ne 'Listen' -and $_.RemotePort -ne 0 } | ForEach-Object { @{ processId = $_.OwningProcess; remoteAddress = $_.RemoteAddress; remotePort = $_.RemotePort } })
ConvertTo-Json -InputObject $rows -Compress
