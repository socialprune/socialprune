$ErrorActionPreference = 'Stop'
# Only digests, ownership flags, entry names and field names leave this process.
# Opening a handle for a write right is an access check, never a write.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
public static class InventoryAccess {
  [StructLayout(LayoutKind.Sequential)] struct Mapping { public uint read,write,execute,all; }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool DuplicateToken(IntPtr token,int level,out IntPtr result);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool AccessCheck(byte[] descriptor,IntPtr token,uint desired,ref Mapping mapping,IntPtr privileges,ref uint length,out uint granted,out bool allowed);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenSCManagerW(string machine,string database,uint access);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenServiceW(IntPtr manager,string name,uint access);
  [DllImport("advapi32.dll")] static extern bool CloseServiceHandle(IntPtr handle);
  public static bool ServiceWritable(string name) {
    IntPtr manager=OpenSCManagerW(null,null,1); if(manager==IntPtr.Zero) throw new Exception("INVENTORY_SCM_ACCESS");
    try {
      IntPtr service=OpenServiceW(manager,name,2|0x10000|0x40000|0x80000);
      if(service!=IntPtr.Zero) { CloseServiceHandle(service); return true; }
      int error=Marshal.GetLastWin32Error();
      if(error!=5) throw new Exception("INVENTORY_SERVICE_ACCESS:"+error);
      // Check the individual rights too: denial of the compound set alone
      // does not prove that every mutation right is denied.
      foreach(uint right in new uint[]{2,0x10000,0x40000,0x80000}) {
        service=OpenServiceW(manager,name,right);
        if(service!=IntPtr.Zero) { CloseServiceHandle(service); return true; }
        if(Marshal.GetLastWin32Error()!=5) throw new Exception("INVENTORY_SERVICE_ACCESS");
      }
      return false;
    } finally { CloseServiceHandle(manager); }
  }
  public static bool Writable(string sddl) {
    var sd=new RawSecurityDescriptor(sddl); byte[] bytes=new byte[sd.BinaryLength]; sd.GetBinaryForm(bytes,0);
    IntPtr token=IntPtr.Zero,copy=IntPtr.Zero,privileges=Marshal.AllocHGlobal(4096);
    try {
      if(!OpenProcessToken(GetCurrentProcess(),10,out token)||!DuplicateToken(token,2,out copy)) throw new Exception("INVENTORY_TOKEN_ACCESS");
      var mapping=new Mapping {read=0x120089,write=0x120116,execute=0x1200a0,all=0x1f01ff};
      foreach(uint right in new uint[]{2,4,0x40,0x10000,0x40000,0x80000}) {
        uint length=4096,granted; bool allowed;
        if(!AccessCheck(bytes,copy,right,ref mapping,privileges,ref length,out granted,out allowed)) throw new Exception("INVENTORY_ACCESS_CHECK");
        if(allowed) return true;
      }
      return false;
    } finally { if(copy!=IntPtr.Zero) CloseHandle(copy); if(token!=IntPtr.Zero) CloseHandle(token); Marshal.FreeHGlobal(privileges); }
  }
}
'@
function Digest([string]$Value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function JsonDigest($Value) { return Digest (ConvertTo-Json -InputObject $Value -Depth 20 -Compress) }
. "$PSScriptRoot\system-reference.ps1"
$absent=[Collections.Generic.List[string]]::new()
if(-not $inventoryLocal) { $absent.Add('known-folder:LocalApplicationData') }
function Row([string]$Name, $Values, [bool]$Strict) {
  $fields=[ordered]@{}
  foreach($field in $Values.Keys) { $fields[$field]=JsonDigest $Values[$field] }
  return @{ name=$Name; count=1; strict=$Strict; appReference=((Test-InventoryAppReference $Values) -or (Test-InventoryAppReference $Name)); fields=$fields }
}
function RegistryWritable($Base,[string]$Path) {
  foreach($right in @([Security.AccessControl.RegistryRights]::SetValue,[Security.AccessControl.RegistryRights]::CreateSubKey,[Security.AccessControl.RegistryRights]::ChangePermissions,[Security.AccessControl.RegistryRights]::TakeOwnership,[Security.AccessControl.RegistryRights]::Delete)) {
    $key=$null
    try { $key=$Base.OpenSubKey($Path,[Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,$right); if($key) { return $true } }
    catch [UnauthorizedAccessException] { }
    catch [Security.SecurityException] { }
    finally { if($key) { $key.Dispose() } }
  }
  return $false
}
$serviceRegistry=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
$services = @(Get-CimInstance Win32_Service | ForEach-Object {
  # Configuration, not transient running state. No service executable is read.
  Row $_.Name ([ordered]@{ PathName=$_.PathName; StartMode=$_.StartMode; StartName=$_.StartName; ServiceType=$_.ServiceType; DesktopInteract=$_.DesktopInteract; DisplayName=$_.DisplayName; Description=$_.Description; ErrorControl=$_.ErrorControl }) (([InventoryAccess]::ServiceWritable($_.Name)) -or (RegistryWritable $serviceRegistry "SYSTEM\CurrentControlSet\Services\$($_.Name)"))
} | Sort-Object name)
$serviceRegistry.Dispose()
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$currentSids=@($identity.User.Value)+@($identity.Groups | ForEach-Object { $_.Value })
$scheduler=New-WindowsOptionalCom 'Schedule.Service'
$tasks=@()
if(-not $scheduler) { $absent.Add('com:Schedule.Service') }
else {
$scheduler.Connect()
$tasks = @(Get-ScheduledTask | ForEach-Object {
  $task=$_
  try { [xml]$xml = Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction Stop }
  catch { if(Test-WindowsNotFound $_.Exception) { $absent.Add("task:$($task.TaskPath)$($task.TaskName)"); return }; throw }
  $values=[ordered]@{}
  foreach($child in $xml.DocumentElement.ChildNodes) {
    if($child.NodeType -eq [Xml.XmlNodeType]::Element) { $values[$child.LocalName]=$child.OuterXml }
  }
  $strict=$true
  $folderPath=$task.TaskPath.TrimEnd('\')
  if(-not $folderPath) { $folderPath='\' }
  $folder=Get-WindowsTaskFolder $scheduler $folderPath
  if(-not $folder) { $absent.Add("task-folder:$folderPath"); return }
  $registered=Get-WindowsRegisteredTask $folder $task.TaskName
  if(-not $registered) { $absent.Add("task:$($task.TaskPath)$($task.TaskName)"); Close-WindowsCom $folder; return }
  try {
    $sddl=$registered.GetSecurityDescriptor(7)
    $values['SecurityDescriptor']=$sddl
    $strict=[InventoryAccess]::Writable($sddl)
    $principal=if($task.Principal.UserId) { $task.Principal.UserId } else { $task.Principal.GroupId }
    if(-not $principal) { $strict=$true }
    else {
      try {
        $sid=if($principal -match '^S-1-') { $principal } else { ([Security.Principal.NTAccount]::new($principal)).Translate([Security.Principal.SecurityIdentifier]).Value }
        if($currentSids -contains $sid) { $strict=$true }
      } catch [Security.Principal.IdentityNotMappedException] { $strict=$true }
    }
    Row "$($task.TaskPath)$($task.TaskName)" $values $strict
  } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($registered); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($folder) }
} | Sort-Object name)
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($scheduler)
}
$identity.Dispose()
$runKeys = @()
foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    try {
      foreach ($path in @('Software\Microsoft\Windows\CurrentVersion\Run', 'Software\Microsoft\Windows\CurrentVersion\RunOnce', 'Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run')) {
        $key=Open-WindowsRegistryKey $base $path
        if(-not $key) { $absent.Add("run-key:$hive|$view|$path"); continue }
        $key.Dispose()
        foreach($entry in @(Get-WindowsRegistryValues $base $path)) {
          $runKeys += Row "$hive|$view|$path|$($entry.name)" ([ordered]@{ Kind=$entry.kind; Value=$entry.value; SecurityDescriptor=$entry.securityDescriptor }) (($hive -eq [Microsoft.Win32.RegistryHive]::CurrentUser) -or (RegistryWritable $base $path))
        }
      }
    } finally { $base.Dispose() }
  }
}
# INetFwPolicy2 is Windows' read-only rule enumeration available to a standard
# user. The CIM port-filter provider requires elevation on some machines.
$policy = New-WindowsOptionalCom 'HNetCfg.FwPolicy2'
$firewall=@()
if(-not $policy) { $absent.Add('com:HNetCfg.FwPolicy2') }
else {
. "$PSScriptRoot\firewall-inventory.ps1"
$machine=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
$firewallWritable=RegistryWritable $machine 'SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules'
$machine.Dispose()
try {
  $rules=@(Get-FirewallInventoryInput $policy.Rules)
  $firewall=@(ConvertTo-FirewallInventoryRows $rules $firewallWritable)
} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($policy) }
}
$tcp = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object { "tcp|$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)" })
# UDP endpoints have no Listen state (ordinary DNS clients acquire ephemeral
# ports). The app's own TCP and UDP endpoints are checked separately.
$startup = @()
$userStartup=[Environment]::GetFolderPath('Startup',[Environment+SpecialFolderOption]::DoNotVerify)
$commonStartup=[Environment]::GetFolderPath('CommonStartup',[Environment+SpecialFolderOption]::DoNotVerify)
foreach ($folder in @($userStartup, $commonStartup)) {
  if ($null -ne (Get-WindowsFileSystemItem $folder)) {
    $parentWritable=[InventoryAccess]::Writable((Get-Acl -LiteralPath $folder).Sddl)
    $startup += @(Get-WindowsFolderEntries $folder | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
      $values=[ordered]@{ Content=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash; Attributes=[string]$_.Attributes; SecurityDescriptor=(Get-Acl -LiteralPath $_.FullName).Sddl }
      $strict=($folder -eq $userStartup) -or $parentWritable -or [InventoryAccess]::Writable((Get-Acl -LiteralPath $_.FullName).Sddl)
      if($_.Extension -ieq '.lnk') {
        $shell=New-Object -ComObject WScript.Shell
        $shortcut=$null
        try { $shortcut=$shell.CreateShortcut($_.FullName); $values.TargetPath=$shortcut.TargetPath; $values.Arguments=$shortcut.Arguments; $values.WorkingDirectory=$shortcut.WorkingDirectory }
        finally { Close-WindowsCom $shortcut; Close-WindowsCom $shell }
      }
      elseif($_.Extension.ToLowerInvariant() -in @('.bat','.cmd','.ps1','.vbs','.js','.wsf','.url','.hta','.txt')) { $values.TextContent=[IO.File]::ReadAllText($_.FullName) }
      else { $strict=$true } # Unknown formats cannot be proved unattributed.
      Row "$(if($folder -eq $userStartup) {'user'} else {'common'})|$($_.Name)" $values $strict
    })
  } else { $absent.Add("startup:$(if($folder -eq $userStartup) {'user'} else {'common'})") }
}
@{ version=2; services = @($services); tasks = @($tasks); runKeys = @($runKeys | Sort-Object name); firewall = @($firewall); listeners = @($tcp | Sort-Object -Unique); startup = @($startup | Sort-Object name); absent=@($absent|Sort-Object -Unique) } | ConvertTo-Json -Depth 8 -Compress
