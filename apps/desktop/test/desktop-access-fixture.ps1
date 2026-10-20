param([string]$Scratch,[string]$Shell,[int]$QueryTimeoutMs)
$ErrorActionPreference='Stop'
$source=[IO.File]::ReadAllText("$PSScriptRoot\..\e2e\limited-token.ps1")
$native=[regex]::Match($source,"(?s)Add-Type -TypeDefinition \(@'\r?\n(.*?)\r?\n'@ \+").Groups[1].Value
if(-not $native) { throw 'DESKTOP_FIXTURE_SOURCE_DRIFT' }
$method=@'
  public static uint DesktopQueryTimeoutMs;
  public static string DesktopAccessProof(string scratch,string node,string shell,uint queryTimeoutMs) {
    DesktopQueryTimeoutMs=queryTimeoutMs;
    IntPtr token=IntPtr.Zero,limited=IntPtr.Zero,impersonation=IntPtr.Zero,medium=IntPtr.Zero,job=IntPtr.Zero;
    IntPtr admins=Marshal.AllocHGlobal(68);uint size=68;LimitedDesktop owned=null;
    try {
      Require(OpenProcessToken(GetCurrentProcess(),0x02000000,out token),"OpenProcessToken");
      Require(CreateWellKnownSid(26,IntPtr.Zero,admins,ref size),"AdministratorsSid");
      var disable=new SidEntry{sid=admins};
      Require(CreateRestrictedToken(token,1|4,1,ref disable,0,IntPtr.Zero,0,IntPtr.Zero,out limited),"CreateRestrictedToken");
      Require(ConvertStringSidToSidW("S-1-16-8192",out medium),"MediumIntegritySid");
      var integrity=new SidEntry{sid=medium,attributes=0x20};
      Require(SetTokenInformation(limited,25,ref integrity,(uint)(Marshal.SizeOf(typeof(SidEntry))+12)),"SetMediumIntegrity");
      Require(DuplicateToken(limited,2,out impersonation),"DuplicateToken");bool admin;
      Require(CheckTokenMembership(impersonation,admins,out admin),"CheckTokenMembership");
      if(admin)throw new Exception("LIMITED_TOKEN_STILL_ADMIN");
      job=CreateJobObjectW(IntPtr.Zero,null);Require(job!=IntPtr.Zero,"CreateJob");
      var limits=new JobLimits{basic=new BasicLimits{flags=0x2000}};
      Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(JobLimits))),"JobLimit");
      owned=new LimitedDesktop(limited,impersonation);
      var start=new Startup{cb=Marshal.SizeOf(typeof(Startup)),desktop=owned.Path,flags=1,show=0};
      DesktopDeny.Apply(owned.DesktopHandle);
      bool accessDenied=false;try{owned.Verify(impersonation);}catch{accessDenied=true;}
      uint denied=DesktopDeny.Execute(limited,job,shell,ref start);
      owned.RestoreOwnedAccess(impersonation);
      uint granted=DesktopDeny.Execute(limited,job,shell,ref start);
      // Match the runner boundary: Node is already initialized, then its
      // PowerShell grandchild must connect to the desktop for the first time.
      string script=Path.Combine(scratch,"nested.mjs");
      File.WriteAllText(script,@"import {writeFileSync,renameSync,existsSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {setTimeout as wait} from 'node:timers/promises';import {createHash} from 'node:crypto';const root=process.argv[2];const shell=process.argv[3];const limit=Number(process.argv[4]);const digest=()=>createHash('sha256').update(JSON.stringify(Object.entries(process.env).sort())).digest('hex');const before=digest();writeFileSync(root+'/ready','ready');for(const phase of ['denied','granted']){while(!existsSync(root+'/'+phase+'-go'))await wait(10);let code=0;try{execFileSync(shell,['-NoProfile','-NonInteractive','-Command','exit 0'],{windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:limit});}catch(error){code=error.status;}writeFileSync(root+'/'+phase+'.tmp',JSON.stringify({code,environmentUnchanged:digest()===before}));renameSync(root+'/'+phase+'.tmp',root+'/'+phase+'.json');}");
      var nodeStart=start;var nested=StartOwned(limited,job,node,new StringBuilder(Quote(node)+" "+Quote(script)+" "+Quote(scratch)+" "+Quote(shell)+" "+queryTimeoutMs),Environment.CurrentDirectory,ref nodeStart);
      string deniedResult,grantedResult;
      try {
        DesktopDeny.WaitFile(Path.Combine(scratch,"ready"));
        DesktopDeny.Apply(owned.DesktopHandle);File.WriteAllText(Path.Combine(scratch,"denied-go"),"go");
        DesktopDeny.WaitFile(Path.Combine(scratch,"denied.json"));deniedResult=File.ReadAllText(Path.Combine(scratch,"denied.json"));
        owned.RestoreOwnedAccess(impersonation);File.WriteAllText(Path.Combine(scratch,"granted-go"),"go");
        DesktopDeny.WaitFile(Path.Combine(scratch,"granted.json"));grantedResult=File.ReadAllText(Path.Combine(scratch,"granted.json"));
        if(WaitForSingleObject(nested.process,queryTimeoutMs)!=0)throw new Exception("NESTED_PROBE_TIMEOUT");
      }finally{CloseHandle(nested.thread);CloseHandle(nested.process);}
      bool environment=Environment.GetEnvironmentVariable("SystemRoot")!=null && Environment.GetEnvironmentVariable("windir")!=null && Environment.GetEnvironmentVariable("PATHEXT")!=null;
      string evidence=owned.Evidence();owned.Dispose();bool closed=owned.ObjectsClosed;owned=null;
      return "{\"denied\":"+denied+",\"granted\":"+granted+",\"nestedDenied\":"+deniedResult+",\"nestedGranted\":"+grantedResult+",\"accessDenied\":"+accessDenied.ToString().ToLowerInvariant()+",\"desktopObjectsClosed\":"+closed.ToString().ToLowerInvariant()+",\"environmentInherited\":"+environment.ToString().ToLowerInvariant()+",\"restricted\":true,\"medium\":true,\"adminMember\":false,\"jobKillOnClose\":true,\"heapRecreated\":false,\"access\":"+evidence+"}";
    }finally{if(job!=IntPtr.Zero)CloseHandle(job);if(owned!=null)owned.Dispose();foreach(IntPtr handle in new IntPtr[]{impersonation,limited,token})if(handle!=IntPtr.Zero)CloseHandle(handle);if(medium!=IntPtr.Zero)LocalFree(medium);Marshal.FreeHGlobal(admins);}
  }
  static class DesktopDeny {
    public static void WaitFile(string path){var clock=System.Diagnostics.Stopwatch.StartNew();while(!File.Exists(path)){if(clock.ElapsedMilliseconds>DesktopQueryTimeoutMs+1000)throw new Exception("OWNED_NESTED_READY_TIMEOUT");System.Threading.Thread.Sleep(10);}}
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text,uint rev,out IntPtr sd,out uint size);
    [DllImport("user32.dll",SetLastError=true)]static extern bool SetUserObjectSecurity(IntPtr obj,ref uint info,IntPtr sd);
    public static void Apply(IntPtr desktop) {IntPtr sd;uint size;Require(ConvertStringSecurityDescriptorToSecurityDescriptorW("D:(A;;GA;;;SY)(A;;GA;;;BA)",1,out sd,out size),"DenyDescriptor");try{uint info=4;Require(SetUserObjectSecurity(desktop,ref info,sd),"DenyOwnedDesktop");}finally{LocalFree(sd);}}
    public static uint Execute(IntPtr token,IntPtr job,string shell,ref Startup start) {var command=new StringBuilder(Quote(shell)+" -NoProfile -NonInteractive -Command \"exit 0\"");var child=StartOwned(token,job,shell,command,Environment.CurrentDirectory,ref start);try{if(WaitForSingleObject(child.process,DesktopQueryTimeoutMs)!=0)throw new Exception("OWNED_DESKTOP_PROBE_TIMEOUT");uint code;Require(GetExitCodeProcess(child.process,out code),"ProbeExit");return code;}finally{CloseHandle(child.thread);CloseHandle(child.process);}}
  }
'@
$native=$native.Replace('  public static uint Run(', $method+"`n  public static uint Run(")
Add-Type -TypeDefinition ($native+[IO.File]::ReadAllText("$PSScriptRoot\..\e2e\limited-desktop.cs"))
[LimitedProof]::DesktopAccessProof($Scratch,(Get-Command node.exe).Source,(Get-Command $Shell).Source,$QueryTimeoutMs)
