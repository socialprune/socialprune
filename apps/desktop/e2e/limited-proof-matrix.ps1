param([string]$Node,[string]$ConfigurationFile,[string]$Report)
$ErrorActionPreference='Stop'
# Opt-in diagnostics only. The default launcher and its proof callsites never
# enter here. Extract its native API definitions without executing its proofs.
$config=Get-Content -LiteralPath $ConfigurationFile -Raw | ConvertFrom-Json
$source=[IO.File]::ReadAllText("$PSScriptRoot\limited-token.ps1")
$native=[regex]::Match($source,"(?s)Add-Type -TypeDefinition \(@'\r?\n(.*?)\r?\n'@ \+").Groups[1].Value
if(-not $native) { throw 'MATRIX_NATIVE_SOURCE_DRIFT' }
$native=$native.Replace('public static class LimitedProof {','public static partial class LimitedProof {')
Add-Type -TypeDefinition ($native+[IO.File]::ReadAllText("$PSScriptRoot\limited-desktop.cs")+[IO.File]::ReadAllText("$PSScriptRoot\limited-proof-matrix.cs"))
$scratch=[IO.Path]::GetDirectoryName($ConfigurationFile)
$shell=(Get-Command $config.shell -CommandType Application -ErrorAction Stop).Source
$rows=@()
function Invoke-MatrixRow([string]$id,[string]$app,[string[]]$arguments,[string]$token='restricted',[uint32]$flags=0,[bool]$job=$true) {
  try {
    $row=[LimitedProof]::MatrixRow($id,$app,$arguments,$scratch,$token,$flags,$job,[uint32]$config.rowTimeoutMs) | ConvertFrom-Json
  } catch {
    $row=[pscustomobject]@{id=$id;diagnosticOnly=$true;replacesRestrictedProof=$false;state='collector-failed';tokenVariant=$token;weakerDiagnostic=($token -ne 'restricted' -or -not $job);creationFlags=($flags -bor 4);ownedJobRequested=$job;ownedJobAttached=$null;parent=$null;childToken=$null;childAssignedDesktop=$null;exitCode=$null;durationMs=$null;stderr='';failureType=$_.Exception.GetType().Name}
  }
  $row | Add-Member -NotePropertyName requestedArguments -NotePropertyValue $arguments
  $row | Add-Member -NotePropertyName creationApi -NotePropertyValue 'CreateProcessAsUserW'
  if($id.StartsWith('d-shell-version-')) {
    $actual=[regex]::Match($row.stdout,'(?m)^([0-9]+\.[0-9]+)\.').Groups[1].Value
    $requested=$id.Substring('d-shell-version-'.Length)
    $row | Add-Member -NotePropertyName engineVersion -NotePropertyValue @{requested=$requested;actual=$(if($actual){$actual}else{$null});requestedVersionPresent=$(if($actual){$actual -eq $requested}else{$null})}
  }
  $script:rows+=,$row
  # Persist after EVERY row so interruption never erases earlier observations.
  @{version=1;diagnosticOnly=$true;replacesRestrictedProof=$false;nodeImports=$config.nodeImports;rows=$script:rows} | ConvertTo-Json -Depth 12 -Compress | Set-Content -LiteralPath $Report -Encoding UTF8
  [Console]::WriteLine('LIMITED_PROOF_MATRIX '+(@{id=$row.id;state=$row.state;exitCode=$row.exitCode;durationMs=$row.durationMs;token=$row.tokenVariant;creationFlags=$row.creationFlags;ownedJobAttached=$row.ownedJobAttached;weakerDiagnostic=$row.weakerDiagnostic}|ConvertTo-Json -Compress))
}
Invoke-MatrixRow 'a-cmd-ver' ([Environment]::GetEnvironmentVariable('ComSpec')) @('/d','/c','ver')
Invoke-MatrixRow 'c-shell-command' $shell @('-NoProfile','-NonInteractive','-Command','exit 0')
Invoke-MatrixRow 'f-no-window' $shell @('-NoProfile','-NonInteractive','-Command','exit 0') 'restricted' 0x08000000
Invoke-MatrixRow 'f-detached' $shell @('-NoProfile','-NonInteractive','-Command','exit 0') 'restricted' 8
Invoke-MatrixRow 'f-new-console' $shell @('-NoProfile','-NonInteractive','-Command','exit 0') 'restricted' 16
