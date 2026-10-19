param([ValidateSet('grant','inspect','deny-delete','restore')][string]$Action, [string]$Root, [string]$PathsFile)
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try {
  $sid=$identity.User
  $rootItem=Get-Item -LiteralPath $Root -Force
  if(-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $rootItem.Name -notlike 'socialprune-*') { throw 'ACL_RUN_ROOT_REFUSED' }
  $rootPath=[IO.Path]::GetFullPath($rootItem.FullName).TrimEnd('\')
  $state=Join-Path $rootPath 'acl-original.json'
  if($Action -eq 'grant') {
    $acl=Get-Acl -LiteralPath $rootPath
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'Modify','ContainerInherit,ObjectInherit','None','Allow'))
    Set-Acl -LiteralPath $rootPath -AclObject $acl
  }
  if($Action -eq 'deny-delete') {
    $target=Join-Path $rootPath 'parent\nsis-tools'
    $original=@()
    foreach($path in @((Join-Path $rootPath 'parent'),$target)) {
      $acl=Get-Acl -LiteralPath $path
      $original+=@{path=$path;sddl=$acl.Sddl}
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'Delete,DeleteSubdirectoriesAndFiles','None','None','Deny'))
      Set-Acl -LiteralPath $path -AclObject $acl
    }
    $original | ConvertTo-Json -Compress | Set-Content -LiteralPath $state -Encoding UTF8
  }
  if($Action -eq 'restore') {
    $saved=Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
    foreach($row in $saved) {
      if(-not ([IO.Path]::GetFullPath($row.path)).StartsWith($rootPath+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'ACL_RESTORE_PATH_REFUSED' }
      $acl=Get-Acl -LiteralPath $row.path
      $acl.SetSecurityDescriptorSddlForm($row.sddl)
      Set-Acl -LiteralPath $row.path -AclObject $acl
    }
  }
  $paths=@(@{label='run-root';path=$rootPath})
  if($PathsFile) { $extra=Get-Content -LiteralPath $PathsFile -Raw | ConvertFrom-Json; $paths+=$extra }
  $rows=@(foreach($row in $paths) {
    if(-not [IO.Directory]::Exists($row.path) -and -not [IO.File]::Exists($row.path)) { @{pathClass=$row.label;absent=$true};continue }
    $acl=Get-Acl -LiteralPath $row.path
    @{pathClass=$row.label;absent=$false;owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;sddl=$acl.Sddl;rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object { @{sid=$_.IdentityReference.Value;rights=$_.FileSystemRights.ToString();type=$_.AccessControlType.ToString();inherited=$_.IsInherited;inheritance=$_.InheritanceFlags.ToString();propagation=$_.PropagationFlags.ToString()} })}
  })
  @{currentUserSid=$sid.Value;action=$Action;paths=$rows} | ConvertTo-Json -Depth 8 -Compress
} finally { $identity.Dispose() }
