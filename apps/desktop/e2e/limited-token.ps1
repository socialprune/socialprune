param([string]$Executable, [string]$ArgumentsFile, [string]$TokenReport, [int]$TimeoutSeconds = 1200)
$ErrorActionPreference = 'Stop'
# Test harness only. Same user/profile/desktop, no account creation, no UAC
# setting change. Microsoft documents LUA_TOKEN and the restricted-primary-
# token exception to CreateProcessAsUser's assign-primary-token privilege.
# https://learn.microsoft.com/windows/win32/secauthz/restricted-tokens
# https://learn.microsoft.com/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class LimitedProof {
  [StructLayout(LayoutKind.Sequential)] struct SidEntry { public IntPtr sid; public uint attributes; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved, desktop, title; public int x,y,cx,cy,xchars,ychars,fill,flags; public short show,reserved2; public IntPtr bytes,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr token,uint flags,uint count,ref SidEntry disabled,uint delete,IntPtr privileges,uint restrict,IntPtr sids,out IntPtr result);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CreateWellKnownSid(int kind,IntPtr domain,IntPtr sid,ref uint size);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSidToSidW(string text,out IntPtr sid);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetTokenInformation(IntPtr token,int kind,ref SidEntry value,uint size);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool DuplicateToken(IntPtr token,int level,out IntPtr copy);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CheckTokenMembership(IntPtr token,IntPtr sid,out bool member);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessAsUserW(IntPtr token,string app,StringBuilder args,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref Startup startup,out ProcessInfo info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
  static void Require(bool result,string operation) { if(!result) throw new Win32Exception(Marshal.GetLastWin32Error(),operation); }
  static string Quote(string value) {
    var text=new StringBuilder("\""); int slashes=0;
    foreach(char c in value) { if(c=='\\') { slashes++; continue; } if(c=='"') { text.Append('\\',slashes*2+1); text.Append('"'); } else { text.Append('\\',slashes); text.Append(c); } slashes=0; }
    text.Append('\\',slashes*2); return text.Append('"').ToString();
  }
  public static uint ChildPid;
  public static uint Run(string app,string[] args,string cwd,int timeout,string profileScript,string markerKey,string marker,string expectedSid,string profileReport) {
    IntPtr token=IntPtr.Zero,limited=IntPtr.Zero,impersonation=IntPtr.Zero,medium=IntPtr.Zero;
    IntPtr admins=Marshal.AllocHGlobal(68); uint size=68;
    ProcessInfo info=new ProcessInfo();
    try {
      Require(OpenProcessToken(GetCurrentProcess(),0x02000000,out token),"OpenProcessToken");
      Require(CreateWellKnownSid(26,IntPtr.Zero,admins,ref size),"AdministratorsSid");
      var disable=new SidEntry { sid=admins,attributes=0 };
      Require(CreateRestrictedToken(token,1|4,1,ref disable,0,IntPtr.Zero,0,IntPtr.Zero,out limited),"CreateRestrictedToken");
      Require(ConvertStringSidToSidW("S-1-16-8192",out medium),"MediumIntegritySid");
      var integrity=new SidEntry { sid=medium,attributes=0x20 };
      Require(SetTokenInformation(limited,25,ref integrity,(uint)(Marshal.SizeOf(typeof(SidEntry))+12)),"SetMediumIntegrity");
      Require(DuplicateToken(limited,2,out impersonation),"DuplicateToken");
      bool member; Require(CheckTokenMembership(impersonation,admins,out member),"CheckTokenMembership");
      if(member) throw new Exception("LIMITED_TOKEN_STILL_ADMIN");
      var command=new StringBuilder(Quote(app)); foreach(string arg in args) command.Append(" ").Append(Quote(arg));
      var startup=new Startup { cb=Marshal.SizeOf(typeof(Startup)), desktop="winsta0\\default", flags=0x100, input=GetStdHandle(-10), output=GetStdHandle(-11), error=GetStdHandle(-12) };
      // Verify the inherited user's hive from a real child of this same
      // restricted primary token. Do not call LoadUserProfile or create a hive.
      string ps=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell\\v1.0\\powershell.exe");
      var profile=new StringBuilder(Quote(ps));
      foreach(string arg in new string[]{"-NoProfile","-NonInteractive","-File",profileScript,"-MarkerKey",markerKey,"-Marker",marker,"-ExpectedSid",expectedSid,"-Report",profileReport}) profile.Append(" ").Append(Quote(arg));
      ProcessInfo proof;
      Require(CreateProcessAsUserW(limited,ps,profile,IntPtr.Zero,IntPtr.Zero,true,0,IntPtr.Zero,cwd,ref startup,out proof),"CreateProfileProofChild");
      try {
        if(WaitForSingleObject(proof.process,30000)!=0) throw new Exception("PROFILE_PROOF_TIMEOUT");
        uint proofCode; Require(GetExitCodeProcess(proof.process,out proofCode),"ProfileProofExit");
        if(proofCode!=0) throw new Exception("PROFILE_PROOF_FAILED:"+proofCode);
      } finally { CloseHandle(proof.thread); CloseHandle(proof.process); }
      Require(CreateProcessAsUserW(limited,app,command,IntPtr.Zero,IntPtr.Zero,true,0,IntPtr.Zero,cwd,ref startup,out info),"CreateProcessAsUserW");
      ChildPid=info.pid;
      uint waited=WaitForSingleObject(info.process,(uint)timeout*1000);
      if(waited!=0) throw new Exception("LIMITED_PROOF_WAIT:"+waited+";pid="+info.pid);
      uint code; Require(GetExitCodeProcess(info.process,out code),"GetExitCodeProcess"); return code;
    } finally {
      foreach(IntPtr handle in new IntPtr[]{info.thread,info.process,impersonation,limited,token}) if(handle!=IntPtr.Zero) CloseHandle(handle);
      if(medium!=IntPtr.Zero) LocalFree(medium); Marshal.FreeHGlobal(admins);
    }
  }
}
'@
$arguments = [string[]](Get-Content -LiteralPath $ArgumentsFile -Raw | ConvertFrom-Json)
$markerKey='Software\SocialPrune-test-'+[guid]::NewGuid().ToString()
$marker=[guid]::NewGuid().ToString()
$hive=[Microsoft.Win32.Registry]::CurrentUser
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($hive.OpenSubKey($markerKey,$false)) { throw 'PROFILE_MARKER_ALREADY_EXISTS' }
$key=$hive.CreateSubKey($markerKey)
try { $key.SetValue('Marker',$marker) } finally { $key.Dispose() }
try {
  $profileReport=$TokenReport+'.profile.json'
  $code = [LimitedProof]::Run($Executable, $arguments, (Get-Location).Path, $TimeoutSeconds, "$PSScriptRoot\profile-hive-proof.ps1", $markerKey, $marker, $identity.User.Value, $profileReport)
  $profile=Get-Content -LiteralPath $profileReport -Raw | ConvertFrom-Json
  @{ method = 'CreateRestrictedToken(DISABLE_MAX_PRIVILEGE|LUA_TOKEN)+CreateProcessAsUserW'; adminMember = $false; integrity = 'medium'; childPid = [LimitedProof]::ChildPid; childExit = $code; profile=$profile } | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath $TokenReport -Encoding UTF8
} finally {
  $key=$hive.OpenSubKey($markerKey,$false)
  try { if($key -and $key.GetValue('Marker') -cne $marker) { throw 'PROFILE_MARKER_IDENTITY_CHANGED' } }
  finally { if($key) { $key.Dispose() } }
  $hive.DeleteSubKeyTree($markerKey,$false)
  $identity.Dispose()
}
exit $code
