param([string]$Executable, [string]$ArgumentsFile, [string]$TokenReport, [int]$TimeoutSeconds = 1200, [string]$DiagnosticVariant = '')
$ErrorActionPreference = 'Stop'
# DIAGNOSTIC_MATRIX_DISPATCH_BEGIN
if ($DiagnosticVariant -eq 'runner-matrix') {
  & "$PSScriptRoot\limited-proof-matrix.ps1" -Node $Executable -ConfigurationFile $ArgumentsFile -Report $TokenReport
  exit 0
}
if ($DiagnosticVariant -ne '') { throw 'UNKNOWN_DIAGNOSTIC_VARIANT' }
# DIAGNOSTIC_MATRIX_DISPATCH_END
# Test harness only. Same user/profile/desktop, no account creation, no UAC
# setting change. Microsoft documents LUA_TOKEN and the restricted-primary-
# token exception to CreateProcessAsUser's assign-primary-token privilege.
# https://learn.microsoft.com/windows/win32/secauthz/restricted-tokens
# https://learn.microsoft.com/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken
Add-Type -TypeDefinition (@'
using System;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.IO;
using System.Collections.Generic;
using System.Security.Principal;
public static class LimitedProof {
  [StructLayout(LayoutKind.Sequential)] struct SidEntry { public IntPtr sid; public uint attributes; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved, desktop, title; public int x,y,cx,cy,xchars,ychars,fill,flags; public short show,reserved2; public IntPtr bytes,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long processTime,jobTime; public uint flags; public UIntPtr minWorkingSet,maxWorkingSet; public uint activeProcessLimit; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct JobLimits { public BasicLimits basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory; }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
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
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref JobLimits limits,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
  static void Require(bool result,string operation) { if(!result) throw new Win32Exception(Marshal.GetLastWin32Error(),operation); }
  static string Quote(string value) {
    var text=new StringBuilder("\""); int slashes=0;
    foreach(char c in value) { if(c=='\\') { slashes++; continue; } if(c=='"') { text.Append('\\',slashes*2+1); text.Append('"'); } else { text.Append('\\',slashes); text.Append(c); } slashes=0; }
    text.Append('\\',slashes*2); return text.Append('"').ToString();
  }
  public static uint ChildPid;
  public static string Phase="initialize";
  public static string DesktopEvidence="null";
  static ProcessInfo StartOwned(IntPtr token,IntPtr job,string app,StringBuilder command,string cwd,ref Startup startup) {
    ProcessInfo child;
    Require(CreateProcessAsUserW(token,app,command,IntPtr.Zero,IntPtr.Zero,true,4,IntPtr.Zero,cwd,ref startup,out child),"CreateSuspendedChild");
    try {
      // Attach before any child code executes. Closing this anonymous job can
      // terminate only these positively owned processes and their descendants.
      Require(AssignProcessToJobObject(job,child.process),"AssignOwnedChildJob");
      Require(ResumeThread(child.thread)!=0xffffffff,"ResumeOwnedChild");
      return child;
    } catch { TerminateProcess(child.process,1); WaitForSingleObject(child.process,5000); CloseHandle(child.thread); CloseHandle(child.process); throw; }
  }
  public static uint Run(string app,string[] args,string cwd,int timeout,string profileEntry,string profileScript,string markerKey,string marker,string expectedSid,string profileReport) {
    IntPtr token=IntPtr.Zero,limited=IntPtr.Zero,impersonation=IntPtr.Zero,medium=IntPtr.Zero,job=IntPtr.Zero;
    IntPtr admins=Marshal.AllocHGlobal(68); uint size=68;
    ProcessInfo info=new ProcessInfo(),proof=new ProcessInfo();
    LimitedDesktop ownedDesktop=null;
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
      ownedDesktop=new LimitedDesktop(limited,impersonation);
      DesktopEvidence=ownedDesktop.Evidence();
      job=CreateJobObjectW(IntPtr.Zero,null);Require(job!=IntPtr.Zero,"CreateOwnedChildJob");
      var limits=new JobLimits {basic=new BasicLimits {flags=0x2000}};
      Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(JobLimits))),"SetKillOwnedChildrenOnClose");
      var command=new StringBuilder(Quote(app)); foreach(string arg in args) command.Append(" ").Append(Quote(arg));
      var startup=new Startup { cb=Marshal.SizeOf(typeof(Startup)), desktop=ownedDesktop.Path, flags=0x100, input=GetStdHandle(-10), output=GetStdHandle(-11), error=GetStdHandle(-12) };
      // Verify the inherited user's hive from a real child of this same
      // restricted primary token. Do not call LoadUserProfile or create a hive.
      var profile=new StringBuilder(Quote(app));
      foreach(string arg in new string[]{profileEntry,profileScript,"-MarkerKey",markerKey,"-Marker",marker,"-ExpectedSid",expectedSid,"-Report",profileReport}) profile.Append(" ").Append(Quote(arg));
      Phase="profile";
      using(var output=new FileStream(profileReport+".stdout.txt",FileMode.Create,FileAccess.Write,FileShare.ReadWrite))
      using(var errors=new FileStream(profileReport+".stderr.txt",FileMode.Create,FileAccess.Write,FileShare.ReadWrite)) {
        var profileStartup=startup;
        profileStartup.output=output.SafeFileHandle.DangerousGetHandle();
        profileStartup.error=errors.SafeFileHandle.DangerousGetHandle();
        Require(SetHandleInformation(profileStartup.output,1,1),"InheritProfileOutput");
        Require(SetHandleInformation(profileStartup.error,1,1),"InheritProfileError");
        proof=StartOwned(limited,job,app,profile,cwd,ref profileStartup);
        try {
        // R16 2026-10-20: compile max over both runner artifacts 45974 ms;
        // 3x+100 => 138022 query window, plus 15 s Node start/settlement.
        var profileClock=System.Diagnostics.Stopwatch.StartNew();
        if(WaitForSingleObject(proof.process,153022)!=0) throw new Exception("PROFILE_PROOF_TIMEOUT;killed=true;signal=job-close;timeoutMs=153022;durationMs="+profileClock.ElapsedMilliseconds);
        uint proofCode; Require(GetExitCodeProcess(proof.process,out proofCode),"ProfileProofExit");
        if(proofCode!=0) throw new Exception("PROFILE_PROOF_FAILED:"+proofCode);
        } finally { CloseHandle(proof.thread); proof.thread=IntPtr.Zero; }
      }
      Phase="child";
      info=StartOwned(limited,job,app,command,cwd,ref startup);
      ChildPid=info.pid;
      var childClock=System.Diagnostics.Stopwatch.StartNew();
      uint waited=WaitForSingleObject(info.process,(uint)timeout*1000);
      if(waited!=0) throw new Exception("LIMITED_PROOF_WAIT:"+waited+";pid="+info.pid+";killed=true;signal=job-close;timeoutMs="+(timeout*1000)+";durationMs="+childClock.ElapsedMilliseconds);
      uint code; Require(GetExitCodeProcess(info.process,out code),"GetExitCodeProcess"); return code;
    } finally {
      if(job!=IntPtr.Zero) { CloseHandle(job); job=IntPtr.Zero; }
      foreach(IntPtr process in new IntPtr[]{info.process,proof.process}) if(process!=IntPtr.Zero) WaitForSingleObject(process,5000);
      foreach(IntPtr handle in new IntPtr[]{info.thread,info.process,proof.thread,proof.process,impersonation,limited,token}) if(handle!=IntPtr.Zero) CloseHandle(handle);
      if(ownedDesktop!=null)ownedDesktop.Dispose();
      if(medium!=IntPtr.Zero) LocalFree(medium); Marshal.FreeHGlobal(admins);
    }
  }
}
'@ + [IO.File]::ReadAllText("$PSScriptRoot\limited-desktop.cs"))
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
  $code = [LimitedProof]::Run($Executable, $arguments, (Get-Location).Path, $TimeoutSeconds, "$PSScriptRoot\profile-hive-child.ts", "$PSScriptRoot\profile-hive-proof.ps1", $markerKey, $marker, $identity.User.Value, $profileReport)
  $profile=Get-Content -LiteralPath $profileReport -Raw | ConvertFrom-Json
  @{ method = 'CreateRestrictedToken(DISABLE_MAX_PRIVILEGE|LUA_TOKEN)+CreateProcessAsUserW'; adminMember = $false; integrity = 'medium'; childPid = [LimitedProof]::ChildPid; childExit = $code; profile=$profile; desktop=([LimitedProof]::DesktopEvidence|ConvertFrom-Json); lifecycle='owned-job-kill-on-close' } | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath $TokenReport -Encoding UTF8
} catch {
  $failure=$_.Exception.ToString()
  $closed=if($failure.Contains('LIMITED_PROOF_WAIT:')){'LIMITED_PROOF_WAIT'}elseif($failure.Contains('PROFILE_PROOF_TIMEOUT')){'PROFILE_PROOF_TIMEOUT'}elseif($failure.Contains('PROFILE_PROOF_FAILED')){'PROFILE_PROOF_FAILED'}else{'LIMITED_LAUNCH_FAILED'}
  @{state='failed';phase=[LimitedProof]::Phase;failure=@{code=$closed};childPid=[LimitedProof]::ChildPid;desktop=([LimitedProof]::DesktopEvidence|ConvertFrom-Json);lifecycle='owned-job-kill-on-close'} | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath $TokenReport -Encoding UTF8
  throw
} finally {
  $key=$hive.OpenSubKey($markerKey,$false)
  try { if($key -and $key.GetValue('Marker') -cne $marker) { throw 'PROFILE_MARKER_IDENTITY_CHANGED' } }
  finally { if($key) { $key.Dispose() } }
  $hive.DeleteSubKeyTree($markerKey,$false)
  $identity.Dispose()
}
exit $code
