param([int[]]$ProcessIds)
$ErrorActionPreference = 'Stop'
if (-not $ProcessIds.Count -or @($ProcessIds | Where-Object { $_ -le 0 }).Count) { throw 'INVALID_PROCESS_IDS' }
$tcp = @((Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue) | Where-Object { $ProcessIds -contains $_.OwningProcess })
$udp = @((Get-NetUDPEndpoint -ErrorAction SilentlyContinue) | Where-Object { $ProcessIds -contains $_.OwningProcess })
@{ tcp = $tcp.Count; udp = $udp.Count } | ConvertTo-Json -Compress
