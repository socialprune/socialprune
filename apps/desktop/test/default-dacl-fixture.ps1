param([string]$Launcher, [string]$DesktopSource)
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText($Launcher)
$inline = [regex]::Match($source, "(?s)Add-Type -TypeDefinition \(@'\r?\n(.*?)\r?\n'@").Groups[1].Value
if (-not $inline) { throw 'LIMITED_PROOF_SOURCE_MISSING' }
Add-Type -TypeDefinition ($inline + [IO.File]::ReadAllText($DesktopSource))

$user = [Security.Principal.SecurityIdentifier]::new('S-1-5-21-101-202-303-1001')
$admins = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$guests = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-546')
$acl = [Security.AccessControl.RawAcl]::new(2, 3)
$acl.InsertAce(0, [Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]::None, [Security.AccessControl.AceQualifier]::AccessDenied, 0x00020000, $guests, $false, $null))
$acl.InsertAce(1, [Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]::None, [Security.AccessControl.AceQualifier]::AccessAllowed, 0x10000000, $admins, $false, $null))
$acl.InsertAce(2, [Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]::ContainerInherit, [Security.AccessControl.AceQualifier]::AccessAllowed, 0x10000000, $system, $false, $null))
function AceBytes($ace) {
  $bytes = [byte[]]::new($ace.BinaryLength)
  $ace.GetBinaryForm($bytes, 0)
  [Convert]::ToBase64String($bytes)
}
function ReadAcl([IntPtr]$pointer) {
  $length = [uint16][Runtime.InteropServices.Marshal]::ReadInt16($pointer, 2)
  $bytes = [byte[]]::new($length)
  [Runtime.InteropServices.Marshal]::Copy($pointer, $bytes, 0, $length)
  ,([Security.AccessControl.RawAcl]::new($bytes, 0))
}
function HasUserAce($value) {
  foreach ($ace in $value) {
    if ($ace -is [Security.AccessControl.CommonAce] -and $ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and ($ace.AccessMask -band 0x10000000) -eq 0x10000000 -and $ace.SecurityIdentifier.Equals($user)) { return $true }
  }
  return $false
}
$aclBytes = [byte[]]::new($acl.BinaryLength)
$acl.GetBinaryForm($aclBytes, 0)
$sidBytes = [byte[]]::new($user.BinaryLength)
$user.GetBinaryForm($sidBytes, 0)
$original = [Runtime.InteropServices.Marshal]::AllocHGlobal($aclBytes.Length)
$sid = [Runtime.InteropServices.Marshal]::AllocHGlobal($sidBytes.Length)
$merged = [IntPtr]::Zero
$again = [IntPtr]::Zero
try {
  [Runtime.InteropServices.Marshal]::Copy($aclBytes, 0, $original, $aclBytes.Length)
  [Runtime.InteropServices.Marshal]::Copy($sidBytes, 0, $sid, $sidBytes.Length)
  $before = HasUserAce $acl
  $merged = [LimitedProof]::MergeUserDefaultDacl($original, $sid)
  $result = ReadAcl $merged
  $existing = @($acl | ForEach-Object { AceBytes $_ })
  $actual = @($result | ForEach-Object { AceBytes $_ })
  $preserved = @($existing | Where-Object { $actual -cnotcontains $_ }).Count -eq 0
  $again = [LimitedProof]::MergeUserDefaultDacl($merged, $sid)
  $repeated = ReadAcl $again
  $repeatedBytes = @($repeated | ForEach-Object { AceBytes $_ })
  $idempotent = $actual.Count -eq $repeatedBytes.Count -and [string]::Join('|', $actual) -ceq [string]::Join('|', $repeatedBytes)
  $receipt = @{
    inputUserAcePresent = $before
    userAcePresent = (HasUserAce $result)
    existingAcesPreserved = $preserved
    addedAceCount = $result.Count - $acl.Count
    idempotent = $idempotent
    trusteeClass = 'user'
    access = 'GENERIC_ALL'
  }
  if ($before -or -not $receipt.userAcePresent -or -not $preserved -or $receipt.addedAceCount -ne 1 -or -not $idempotent) { throw 'DEFAULT_DACL_MERGE_INVARIANT' }
  $receipt | ConvertTo-Json -Compress
} finally {
  if ($again -ne [IntPtr]::Zero) { [LimitedProof]::FreeMergedDefaultDacl($again) }
  if ($merged -ne [IntPtr]::Zero) { [LimitedProof]::FreeMergedDefaultDacl($merged) }
  [Runtime.InteropServices.Marshal]::FreeHGlobal($original)
  [Runtime.InteropServices.Marshal]::FreeHGlobal($sid)
}
