param([string]$Scenario)
$ErrorActionPreference='Stop'
# Generated event provider in this test process only. No event log, firewall or
# AppX store is read or modified. The production script has no fake switch.
function Get-WinEvent {
  param($ListLog,$FilterXPath,$LogName,$MaxEvents,$ErrorAction)
  if($Scenario -eq 'unreadable'){throw 'GENERATED_ACCESS_DENIED'}
  if($ListLog){return [pscustomobject]@{IsEnabled=($Scenario -ne 'disabled')}}
  if($Scenario -eq 'absent'){return}
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if(-not $FilterXPath.Contains($user) -or $MaxEvents -ne 1){throw 'GENERATED_QUERY_NOT_USER_BOUNDED'}
  $id=211
  if($Scenario -eq 'late'){$id=216}
  if($Scenario -eq 'stale'){$id=240}
  if($Scenario -eq 'foreign'){$user='S-1-5-21-1-2-3-9999'}
  $provider='Microsoft-Windows-AppReadiness'
  if($Scenario -eq 'bad-provider'){$provider='Generated-Other'}
  $event=[pscustomobject]@{Id=$id;RecordId=164;TimeCreated=[DateTime]::Parse('2026-10-24T09:18:43.140Z').ToUniversalTime();ProviderName=$provider;User=$user}
  $event | Add-Member -MemberType ScriptMethod -Name ToXml -Value { '<Event><System><EventID>'+$this.Id+'</EventID></System><EventData><Data Name="User">'+$this.User+'</Data></EventData></Event>' }
  # Exercise the production XPath on generated XML, not a copied predicate.
  if($Scenario -ne 'foreign') {
    $xml=[xml]$event.ToXml()
    if($null -eq $xml.SelectSingleNode($FilterXPath)){throw 'GENERATED_XPATH_REJECTED_CURRENT_EVENT'}
    $foreign=[xml]($event.ToXml().Replace($user,'S-1-5-21-1-2-3-9999'))
    if($null -ne $foreign.SelectSingleNode($FilterXPath)){throw 'GENERATED_XPATH_ACCEPTED_FOREIGN_EVENT'}
    $irrelevant=[xml]($event.ToXml().Replace('<EventID>'+$id+'</EventID>','<EventID>241</EventID>'))
    if($null -ne $irrelevant.SelectSingleNode($FilterXPath)){throw 'GENERATED_XPATH_ACCEPTED_TASK_REMOVAL'}
  }
  return $event
}
& "$PSScriptRoot\..\packaging\app-readiness.ps1"
