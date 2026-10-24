param([int]$Seconds=1200)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows') { throw 'APPX_DIAGNOSTIC_RUNNER_REQUIRED' }
if($Seconds -lt 1 -or $Seconds -gt 1200) { throw 'APPX_DIAGNOSTIC_BOUND_REFUSED' }
$started=[DateTime]::UtcNow
$clock=[Diagnostics.Stopwatch]::StartNew()
$sha=[Security.Cryptography.SHA256]::Create()
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$currentSid=$identity.User.Value
$identity.Dispose()
function Digest([string]$value) { ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-','').ToLowerInvariant() }
function Emit($value) { $value | ConvertTo-Json -Depth 12 -Compress; [Console]::Out.Flush() }
function Owner([string]$value) { if(-not $value){'empty'}elseif($value -eq $currentSid){'runner-user'}elseif($value -eq 'S-1-5-18'){'system'}else{'other'} }
function Package([string]$value) { if($value -match 'Microsoft.Windows.NarratorQuickStart'){'NarratorQuickStart'}elseif($value -match 'Microsoft.WindowsFeedbackHub'){'FeedbackHub'}else{'other'} }
function Image([string]$value) {
  if(-not $value){return 'unknown'}
  if($value -match '(?i)SocialPrune|socialprune'){return 'socialprune'}
  if($value.StartsWith($env:windir,[StringComparison]::OrdinalIgnoreCase)){return 'windows/'+[IO.Path]::GetFileName($value)}
  if($value -match '(?i)\\WindowsApps\\'){return 'windows-app/'+[IO.Path]::GetFileName($value)}
  return 'other/'+[IO.Path]::GetFileName($value)
}
$channels=@('Microsoft-Windows-AppXDeploymentServer/Operational','Microsoft-Windows-AppReadiness/Admin','Microsoft-Windows-AppReadiness/Operational','Microsoft-Windows-Windows Firewall With Advanced Security/Firewall','Microsoft-Windows-User Profile Service/Operational','Security')
$available=@{}
foreach($channel in $channels) {
  try {
    $log=Get-WinEvent -ListLog $channel -ErrorAction Stop
    $available[$channel]=[bool]$log.IsEnabled
    Emit @{kind='channel';channel=$channel;enabled=[bool]$log.IsEnabled;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
  } catch { Emit @{kind='observation-error';operation='channel';channel=$channel;error=$_.Exception.GetType().Name;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} }
}
$policy=$null
try {
  $os=Get-CimInstance Win32_OperatingSystem
  Emit @{kind='identity';diagnosticOnly=$true;acceptanceProof=$false;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();session=[Diagnostics.Process]::GetCurrentProcess().SessionId;userHash=(Digest $currentSid);bootAt=$os.LastBootUpTime.ToUniversalTime().ToString('o');image=$env:ImageOS;imageVersion=$env:ImageVersion;sha=$env:GITHUB_SHA;runId=$env:GITHUB_RUN_ID;attempt=$env:GITHUB_RUN_ATTEMPT}
  $policy=New-Object -ComObject HNetCfg.FwPolicy2
  $iteration=0
  $previous=@{}
  while($clock.Elapsed.TotalSeconds -lt $Seconds) {
    $sampleStart=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    try {
      $rows=@{}
      foreach($rule in $policy.Rules) {
        $name=[string]$rule.Name
        $fields=[ordered]@{}
        foreach($field in @('Description','ApplicationName','ServiceName','Protocol','LocalPorts','RemotePorts','LocalAddresses','RemoteAddresses','IcmpTypesAndCodes','Direction','Interfaces','InterfaceTypes','Enabled','Grouping','Profiles','EdgeTraversal','Action','LocalAppPackageId','LocalUserOwner','LocalUserAuthorizedList','RemoteUserAuthorizedList','RemoteMachineAuthorizedList','SecureFlags')){$fields[$field]=$rule.$field}
        $row=[ordered]@{nameHash=(Digest $name);configurationHash=(Digest ($fields | ConvertTo-Json -Depth 5 -Compress));package=(Package $name);nameReferencesApp=($name -match '(?i)SocialPrune');application=(Image ([string]$rule.ApplicationName));packageSidHash=(Digest ([string]$rule.LocalAppPackageId));owner=(Owner ([string]$rule.LocalUserOwner));ownerHash=(Digest ([string]$rule.LocalUserOwner));direction=[int]$rule.Direction;protocol=[int]$rule.Protocol;action=[int]$rule.Action;enabled=[bool]$rule.Enabled;profiles=[int]$rule.Profiles;serviceHash=(Digest ([string]$rule.ServiceName))}
        $key=Digest ($row | ConvertTo-Json -Compress)
        if(-not $rows.ContainsKey($key)){$rows[$key]=@{key=$key;count=0;row=$row}}
        $rows[$key].count++
      }
      $changes=@()
      foreach($key in @($rows.Keys)) {if(-not $previous.ContainsKey($key) -or $previous[$key].count -ne $rows[$key].count){$changes+=@{reason=if($previous.ContainsKey($key)){'count'}else{'added'};entry=$rows[$key]}}}
      foreach($key in @($previous.Keys)) {if(-not $rows.ContainsKey($key)){$changes+=@{reason='removed';entry=$previous[$key]}}}
      Emit @{kind='firewall';at=$sampleStart;endedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();initial=($iteration -eq 0);rules=@($policy.Rules).Count;groups=$rows.Count;changes=@($changes)}
      $previous=$rows
    } catch { Emit @{kind='observation-error';operation='firewall';error=$_.Exception.GetType().Name;at=$sampleStart} }
    if(($iteration % 5) -eq 0) {
      try {
        $packages=@(foreach($name in @('Microsoft.Windows.NarratorQuickStart','Microsoft.WindowsFeedbackHub')) {
          foreach($p in @(Get-AppxPackage -AllUsers -Name $name -ErrorAction Stop)) {
            @{package=(Package $p.Name);fullName=$p.PackageFullName;family=$p.PackageFamilyName;publisher=$p.PublisherId;signatureKind=[string]$p.SignatureKind;status=[string]$p.Status;installTime='not-exposed-by-Get-AppxPackage';users=@($p.PackageUserInformation | ForEach-Object { @{owner=(Owner ([string]$_.UserSecurityId));ownerHash=(Digest ([string]$_.UserSecurityId));state=[string]$_.InstallState} })}
          }
        })
        Emit @{kind='packages';at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();packages=$packages}
      } catch { Emit @{kind='observation-error';operation='packages';error=$_.Exception.GetType().Name;at=$sampleStart} }
      try {
        $processes=@(Get-CimInstance Win32_Process | ForEach-Object { @{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;session=[int]$_.SessionId;born=$_.CreationDate.ToUniversalTime().ToString('o');image=(Image ([string]$_.ExecutablePath));name=[string]$_.Name} })
        Emit @{kind='processes';at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();processes=$processes}
      } catch { Emit @{kind='observation-error';operation='processes';error=$_.Exception.GetType().Name;at=$sampleStart} }
      try {
        $sessions=@(Get-CimInstance Win32_LogonSession | ForEach-Object { @{idHash=(Digest ([string]$_.LogonId));type=[int]$_.LogonType;startedAt=if($_.StartTime){$_.StartTime.ToUniversalTime().ToString('o')}else{$null};authentication=[string]$_.AuthenticationPackage} })
        Emit @{kind='sessions';at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();sessions=$sessions}
      } catch { Emit @{kind='observation-error';operation='sessions';error=$_.Exception.GetType().Name;at=$sampleStart} }
    }
    $iteration++
    Start-Sleep -Milliseconds 2000
  }
} finally {
  # Never enable logs, change audit policy or modify the rule/package stores.
  foreach($channel in $channels) {
    if(-not $available[$channel]){continue}
    try {
      $filter=@{LogName=$channel;StartTime=$started.AddMinutes(-20)}
      if($channel -eq 'Security'){$filter.Id=@(4624,4946,4947,4948)}
      $events=@(Get-WinEvent -FilterHashtable $filter -MaxEvents 1001 -ErrorAction Stop)
      Emit @{kind='event-coverage';channel=$channel;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();count=$events.Count;capped=($events.Count -gt 1000);lookbackMinutes=20}
      foreach($event in @($events | Select-Object -First 1000)) {
        $xml=[xml]$event.ToXml()
        $fields=@(foreach($field in @($xml.Event.EventData.Data)) {
          if($null -eq $field){continue}
          $text=[string]$field.InnerText
          @{name=[string]$field.Name;hash=(Digest $text);package=(Package $text);owner=(Owner $text);number=if([string]$field.Name -match '(?i)^(ProcessId|ModifyingProcessId|ClientProcessId|SessionId|LogonType)$' -and $text -match '^(\d{1,10}|0x[a-fA-F0-9]{1,8})$'){$text}else{$null};image=if([string]$field.Name -match '(?i)Application|ProcessName|Image|Path'){Image $text}else{'not-path'}}
        })
        Emit @{kind='event';channel=$channel;id=$event.Id;recordId=$event.RecordId;at=([DateTimeOffset]$event.TimeCreated).ToUnixTimeMilliseconds();pid=[string]$xml.Event.System.Execution.ProcessID;activity=[string]$xml.Event.System.Correlation.ActivityID;fields=$fields}
      }
    } catch { Emit @{kind='observation-error';operation='events';channel=$channel;error=$_.Exception.GetType().Name;errorId=[string]$_.FullyQualifiedErrorId;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} }
  }
  if($policy){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($policy)}
  $sha.Dispose()
  Emit @{kind='settled';diagnosticOnly=$true;acceptanceProof=$false;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();durationMs=$clock.ElapsedMilliseconds}
}
