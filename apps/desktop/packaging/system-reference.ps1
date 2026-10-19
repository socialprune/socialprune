# Dot-sourced by the snapshot and its test-only normalization control. Values
# stay in the PowerShell process; only booleans/digests reach evidence.
. "$PSScriptRoot\windows-readers.ps1"
function Expand-InventoryPaths([string]$Value) {
  $text = [Environment]::ExpandEnvironmentVariables($Value).Replace('/', '\')
  # Scan only 8.3-looking segments; configuration text may contain command
  # arguments or descriptions that are not filesystem path names.
  foreach($match in [regex]::Matches($text, '(?i)[a-z]:\\[^"<>|:*?\r\n]*~[^"<>|:*?\r\n]*')) {
    $candidate=$match.Value
    $candidate=($candidate -split '\s+(?=[-\\])',2)[0].TrimEnd()
    $executable=[regex]::Match($candidate,'(?i)^.+?\.(?:exe|com|cmd|bat|ps1|vbs|js|dll|lnk)(?=\s|$)')
    if($executable.Success) { $candidate=$executable.Value }
    $sourceCandidate=$candidate
    $suffix=''
    while($candidate.Length -gt 3) {
      $expanded=[WindowsReadPath]::Resolve($candidate)
      if($null -ne $expanded -and $expanded -cne $candidate) { $text=$text.Replace($sourceCandidate,$expanded+$suffix); break }
      $at=$candidate.LastIndexOf('\')
      if($at -lt 3) { break }
      $suffix=$candidate.Substring($at)+$suffix
      $candidate=$candidate.Substring(0,$at)
    }
  }
  return $text.ToLowerInvariant()
}
$inventoryLocal = [Environment]::GetFolderPath('LocalApplicationData',[Environment+SpecialFolderOption]::DoNotVerify)
$inventoryAppRoots=if($inventoryLocal) { @((Expand-InventoryPaths (Join-Path $inventoryLocal 'Programs\SocialPrune')), (Expand-InventoryPaths (Join-Path $inventoryLocal 'SocialPrune Data'))) } else { @() }
function Test-InventoryAppReference($Value) {
  if($Value -is [Collections.IDictionary]) {
    foreach($key in $Value.Keys) { if((Test-InventoryAppReference ([string]$key)) -or (Test-InventoryAppReference $Value[$key])) { return $true } }
    return $false
  }
  if($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
    foreach($entry in $Value) { if(Test-InventoryAppReference $entry) { return $true } }
    return $false
  }
  $text=Expand-InventoryPaths ([string]$Value)
  if($text -match 'socialprune|(?<![a-z0-9])(?:uninstall|un)\.exe(?![a-z0-9])') { return $true }
  foreach($root in $inventoryAppRoots) { if($text.Contains($root)) { return $true } }
  return $false
}
