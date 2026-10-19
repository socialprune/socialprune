param([ValidateSet('create','remove')][string]$Action,[string]$Name,[string]$Program)
$ErrorActionPreference='Stop'
if($Name -cnotmatch '^SocialPrune-inventory-control-[a-f0-9-]{36}$') { throw 'TASK_CONTROL_NAME_REFUSED' }
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$service=New-Object -ComObject Schedule.Service
$service.Connect()
$root=$service.GetFolder('\')
$description='SocialPrune run-owned disabled inventory control '+$Name
try {
  if($Action -eq 'create') {
    if($Program -cne (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\SocialPrune\SocialPrune.exe')) { throw 'TASK_CONTROL_PROGRAM_REFUSED' }
    # Create only, never update. Disabled, with zero triggers, and never Run().
    $definition=$service.NewTask(0)
    $definition.RegistrationInfo.Description=$description
    $definition.Principal.UserId=$identity.User.Value
    $definition.Principal.LogonType=3
    $definition.Principal.RunLevel=0
    $definition.Settings.Enabled=$false
    $definition.Actions.Create(0).Path=$Program
    $created=$root.RegisterTaskDefinition($Name,$definition,2,$identity.User.Value,$null,3,$null)
    try { if($created.Enabled -or $definition.Triggers.Count -ne 0) { throw 'TASK_CONTROL_NOT_DISABLED' } }
    finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($created) }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($definition)
    @{name=$Name;created=$true;disabled=$true;triggers=0} | ConvertTo-Json -Compress
  } else {
    $task=$root.GetTask($Name)
    try {
      $owner=$task.Definition.Principal.UserId
      $ownerSid=if($owner -match '^S-1-') { $owner } else { ([Security.Principal.NTAccount]::new($owner)).Translate([Security.Principal.SecurityIdentifier]).Value }
      if($task.Definition.RegistrationInfo.Description -cne $description -or $ownerSid -cne $identity.User.Value -or $task.Enabled -or $task.Definition.Triggers.Count -ne 0) { throw 'TASK_CONTROL_FOREIGN_REFUSED' }
      $root.DeleteTask($Name,0)
      @{name=$Name;removed=$true} | ConvertTo-Json -Compress
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($task) }
  }
} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($root); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($service); $identity.Dispose() }
