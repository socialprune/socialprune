# Keep the effective COM inventory, including policy rules. Copy each property
# once, then normalize/hash the rows in-process instead of starting a PowerShell
# JSON/grouping pipeline for every field. No registry approximation is used.
Add-Type -AssemblyName System.Web.Extensions
if(-not ('FirewallInventoryBulk' -as [type])) {
  $references=@('System.dll','System.Core.dll','System.Web.Extensions.dll',[Management.Automation.PSObject].Assembly.Location)
  Add-Type -TypeDefinition ([IO.File]::ReadAllText("$PSScriptRoot\firewall-inventory.cs")) -ReferencedAssemblies $references
}
function Get-FirewallInventoryInput($Rules) {
  foreach($rule in $Rules) {
    $values=[ordered]@{}
    foreach($field in @('Description','ApplicationName','ServiceName','Protocol','LocalPorts','RemotePorts','LocalAddresses','RemoteAddresses','IcmpTypesAndCodes','Direction','Interfaces','InterfaceTypes','Enabled','Grouping','Profiles','EdgeTraversal','Action','LocalAppPackageId','LocalUserOwner','LocalUserAuthorizedList','RemoteUserAuthorizedList','RemoteMachineAuthorizedList','SecureFlags')) { $values[$field]=$rule.$field }
    @{name=$rule.Name;values=$values}
  }
}
function ConvertTo-FirewallInventoryRows([object[]]$Rows,[bool]$MachineWritable) {
  [FirewallInventoryBulk]::Normalize($Rows,$MachineWritable,[Func[string,bool]]{param($value) Test-InventoryAppReference $value})
}
