param([string]$Scratch)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\..\packaging\system-reference.ps1"
. "$PSScriptRoot\..\packaging\firewall-inventory.ps1"
$fields=@('Description','ApplicationName','ServiceName','Protocol','LocalPorts','RemotePorts','LocalAddresses','RemoteAddresses','IcmpTypesAndCodes','Direction','Interfaces','InterfaceTypes','Enabled','Grouping','Profiles','EdgeTraversal','Action','LocalAppPackageId','LocalUserOwner','LocalUserAuthorizedList','RemoteUserAuthorizedList','RemoteMachineAuthorizedList','SecureFlags')
function Digest([string]$Value){$sha=[Security.Cryptography.SHA256]::Create();try{return([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
function JsonDigest($Value){return Digest(ConvertTo-Json -InputObject $Value -Depth 20 -Compress)}
function Legacy($InputRows,[bool]$MachineWritable){
  $rows=@(foreach($row in $InputRows){$values=$row.values;$digests=[ordered]@{};foreach($field in $values.Keys){$digests[$field]=JsonDigest $values[$field]};@{name=$row.name;strict=($MachineWritable-or-not[string]::IsNullOrEmpty($values.LocalUserOwner));appReference=((Test-InventoryAppReference $values)-or(Test-InventoryAppReference $row.name));fields=$digests}})
  return @($rows|Group-Object -Property {$_.name}|ForEach-Object{$group=$_.Group;$digests=[ordered]@{};foreach($field in $group[0].fields.Keys){$digests[$field]=JsonDigest @($group|ForEach-Object{$_.fields[$field]}|Sort-Object)};@{name=$_.Name;count=$group.Count;strict=(@($group|Where-Object{$_.strict}).Count-gt 0);appReference=(@($group|Where-Object{$_.appReference}).Count-gt 0);fields=$digests}}|Sort-Object name)
}
function CheckEqual($Old,$New){
  $Old=@($Old|Sort-Object -Property {$_.name});$New=@($New|Sort-Object -Property {$_.name})
  if($Old.Count-ne$New.Count){throw 'FIREWALL_ROW_COUNT_CHANGED'}
  for($index=0;$index-lt$Old.Count;$index++){
    foreach($flag in @('name','count','strict','appReference')){if($Old[$index][$flag]-cne$New[$index][$flag]){throw "FIREWALL_FLAGS_CHANGED:$index|$flag|$($Old[$index][$flag])|$($New[$index][$flag])"}}
    if($Old[$index].fields.Count-ne$New[$index].fields.Count){throw 'FIREWALL_FIELDS_CHANGED'}
    foreach($field in $Old[$index].fields.Keys){if($Old[$index].fields[$field]-cne$New[$index].fields[$field]){throw "FIREWALL_DIGEST_CHANGED:$index|$field"}}
  }
}
$cases=@($null,'','text',"a`"b\c`n`r`t",[string][char]0,[string][char]1,[string][char]8,[string][char]12,"<>&'",'generated unicode äöß漢字',[string][char]0x2028,$true,$false,6,2147483647,@(),@('a'),@('b','a'),@($null,'a'))
$inputRows=@(for($index=0;$index-lt$cases.Count;$index++){
  $values=[ordered]@{};foreach($field in $fields){$values[$field]=$null}
  $values.Description=$cases[$index];$values.Protocol=6;$values.Enabled=($index%2-eq 0);$values.Profiles=2147483647;$values.Interfaces=@('generated network','generated other');$values.LocalUserOwner=if($index%3-eq 0){'S-1-5-21-generated'}else{$null}
  if($index-eq 3){$values.ApplicationName='C:\Generated\SocialPrune.exe'}
  if($index-eq 4){$values.ApplicationName='C:\Generated\Uninstall.exe'}
  @{name="Generated-$($index%5)";values=$values}
})
foreach($writable in @($false,$true)){
  $old=Legacy $inputRows $writable
  $fakeRules=@(foreach($row in $inputRows){$properties=[ordered]@{Name=$row.name};foreach($field in $fields){$properties[$field]=$row.values[$field]};[pscustomobject]$properties})
  $copied=@(Get-FirewallInventoryInput $fakeRules)
  $new=@(ConvertTo-FirewallInventoryRows $copied $writable)
  CheckEqual $old $new
}
# The test cannot create a per-user firewall rule without administrator rights.
# Plant its own generated row through the exact production normalizer instead.
$values=[ordered]@{};foreach($field in $fields){$values[$field]=$null};$values.ApplicationName='C:\Generated\SocialPrune\probe.exe';$values.LocalUserOwner='S-1-5-21-generated'
$control=@(ConvertTo-FirewallInventoryRows @(@{name='SocialPrune-test-generated';values=$values}) $false)
if($control.Count-ne 1-or-not$control[0].strict-or-not$control[0].appReference){throw 'FIREWALL_PLANTED_ROW_MISSED'}
$before=$control[0].fields.ApplicationName
$values.ApplicationName='C:\Generated\SocialPrune\changed.exe'
$changed=@(ConvertTo-FirewallInventoryRows @(@{name='SocialPrune-test-generated';values=$values}) $false)
if($changed[0].fields.ApplicationName-ceq$before){throw 'FIREWALL_PLANTED_CHANGE_MISSED'}
foreach($bad in @(@{name='generated';values=@{Unknown='generated'}},@{name='generated';values=([ordered]@{Description=[DateTime]::UtcNow})})){
  $refused=$false;try{$null=ConvertTo-FirewallInventoryRows @($bad) $false}catch{$refused=$true};if(-not$refused){throw 'FIREWALL_UNKNOWN_FIELD_ADMITTED'}
}
$values.Description=[DateTime]::UtcNow
$refused=$false;try{$null=ConvertTo-FirewallInventoryRows @(@{name='generated';values=$values}) $false}catch{$refused=$true};if(-not$refused){throw 'FIREWALL_UNKNOWN_TYPE_ADMITTED'}
@{generatedRows=$inputRows.Count;normalizedRows=5;fieldsPerRule=$fields.Count;digestsEqual=$true;strictnessEqual=$true;attributionEqual=$true;machineWritableBranches=2;plantedUserRuleCaught=$true;plantedMutationCaught=$true;unknownFieldsRefused=$true;unknownTypesRefused=$true;controlRow=$control[0];changedRow=$changed[0]}|ConvertTo-Json -Depth 6 -Compress
