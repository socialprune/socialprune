param([string]$Probe,[string]$ExpectedParent)
$ErrorActionPreference='Stop'
& $Probe $ExpectedParent
exit $LASTEXITCODE
