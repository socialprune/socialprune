$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\install-readers.ps1"
Get-InstallLayout | ConvertTo-Json -Depth 4 -Compress
