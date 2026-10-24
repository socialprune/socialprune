$ErrorActionPreference='Stop'
$result=@{version=1;state='unreadable';userHash=$null;eventId=$null;recordId=$null;eventAt=$null}
try {
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  try {$sid=$identity.User.Value} finally {$identity.Dispose()}
  if($sid -notmatch '^S-1-\d+(?:-\d+)+$'){throw 'APP_READINESS_IDENTITY'}
  $sha=[Security.Cryptography.SHA256]::Create()
  try {$result.userHash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($sid)))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
  $channel='Microsoft-Windows-AppReadiness/Admin'
  $log=Get-WinEvent -ListLog $channel -ErrorAction Stop
  if(-not $log.IsEnabled){throw 'APP_READINESS_LOG_DISABLED'}
  # 211 is completion, not removal of one task (241) or service idle (105).
  # New processing, queued work, suspension or failure invalidates an old 211.
  # No time lookback: retained completion from long ago is valid until newer work.
  $xpath="*[System[(EventID=200 or EventID=205 or EventID=206 or EventID=210 or EventID=211 or EventID=214 or EventID=215 or EventID=216 or EventID=218 or EventID=240)] and EventData[(Data[@Name='User']='$sid') or (Data[@Name='Username']='$sid')]]"
  $events=@()
  try {$events=@(Get-WinEvent -LogName $channel -FilterXPath $xpath -MaxEvents 1 -ErrorAction Stop)}
  catch {if($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*'){throw}}
  $result.state='pending'
  if($events.Count -gt 0){
    $event=$events[0]
    $xml=[xml]$event.ToXml()
    $owners=@($xml.Event.EventData.Data | Where-Object { $_.Name -eq 'User' -or $_.Name -eq 'Username' })
    if($event.ProviderName -cne 'Microsoft-Windows-AppReadiness' -or $owners.Count -ne 1 -or $owners[0].InnerText -cne $sid){throw 'APP_READINESS_EVENT_IDENTITY'}
    if($event.RecordId -le 0 -or $null -eq $event.TimeCreated){throw 'APP_READINESS_EVENT_METADATA'}
    $result.eventId=[int]$event.Id
    $result.recordId=[long]$event.RecordId
    $result.eventAt=$event.TimeCreated.ToUniversalTime().ToString('o')
    if($event.Id -eq 211){$result.state='completed'}
  }
} catch {
  # Closed receipt only. Never emit raw event contents, identities or errors.
  $result.state='unreadable';$result.eventId=$null;$result.recordId=$null;$result.eventAt=$null
}
$result | ConvertTo-Json -Compress
