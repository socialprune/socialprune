# Dot-sourced by the snapshot and its test-only normalization control. Values
# stay in the PowerShell process; only booleans/digests reach evidence.
function Expand-InventoryPaths([string]$Value) {
  $text = [Environment]::ExpandEnvironmentVariables($Value).Replace('/', '\')
  foreach($match in [regex]::Matches($text, '(?i)[a-z]:\\[^"<>|\r\n]*')) {
    $candidate=$match.Value
    $suffix=''
    while($candidate.Length -gt 3) {
      $expanded=[InventoryAccess]::LongPath($candidate)
      if($expanded -cne $candidate) { $text=$text.Replace($match.Value,$expanded+$suffix); break }
      $at=$candidate.LastIndexOf('\')
      if($at -lt 3) { break }
      $suffix=$candidate.Substring($at)+$suffix
      $candidate=$candidate.Substring(0,$at)
    }
  }
  return $text.ToLowerInvariant()
}
$inventoryLocal = [Environment]::GetFolderPath('LocalApplicationData')
$inventoryAppRoots=@((Expand-InventoryPaths (Join-Path $inventoryLocal 'Programs\SocialPrune')), (Expand-InventoryPaths (Join-Path $inventoryLocal 'SocialPrune Data')))
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
