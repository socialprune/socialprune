param([ValidateSet('unrestricted-owned','restricted-session-desktop')][string]$Mode,[string]$Executable,[string]$ArgumentsFile,[string]$TokenReport,[int]$TimeoutSeconds)
$ErrorActionPreference='Stop'
# Diagnostic-only normal-token comparison uses the same owned objects and
# descriptor, but does not assert that this intentionally normal token is LUA.
$desktopSource=[IO.File]::ReadAllText("$PSScriptRoot\limited-desktop.cs")
$tokenInvariant='if(!hasRestrictions||!mediumIntegrityVerified)throw new Exception("LIMITED_DESKTOP_TOKEN_INVARIANT");'
if(-not$desktopSource.Contains($tokenInvariant)){throw 'DIAGNOSE_DESKTOP_SOURCE_DRIFT'}
$desktopSource=$desktopSource.Replace($tokenInvariant,'// Diagnostic normal-token comparison only; no token weakening in release launcher.')
Add-Type -TypeDefinition (@'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.ComponentModel;
using System.Collections.Generic;
public static class DiagnoseLaunch {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct Startup{public int cb;public string reserved,desktop,title;public int x,y,cx,cy,xchars,ychars,fill,flags;public short show,reserved2;public IntPtr bytes,input,output,error;}
 [StructLayout(LayoutKind.Sequential)]struct Info{public IntPtr process,thread;public uint pid,tid;}
 [StructLayout(LayoutKind.Sequential)]struct SidEntry{public IntPtr sid;public uint attributes;}
 [StructLayout(LayoutKind.Sequential)]struct Basic{public long a,b;public uint flags;public UIntPtr c,d;public uint e;public UIntPtr f;public uint g,h;}
 [StructLayout(LayoutKind.Sequential)]struct Io{public ulong a,b,c,d,e,f;}
 [StructLayout(LayoutKind.Sequential)]struct Limits{public Basic basic;public Io io;public UIntPtr a,b,c,d;}
 [DllImport("kernel32.dll")]static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
 [DllImport("kernel32.dll")]static extern IntPtr GetStdHandle(int id);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool CreateWellKnownSid(int kind,IntPtr domain,IntPtr sid,ref uint size);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool CreateRestrictedToken(IntPtr token,uint flags,uint count,ref SidEntry deny,uint dc,IntPtr dp,uint rc,IntPtr rs,out IntPtr limited);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool DuplicateToken(IntPtr token,int level,out IntPtr impersonation);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool ConvertStringSidToSidW(string text,out IntPtr sid);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool SetTokenInformation(IntPtr token,int kind,ref SidEntry value,uint size);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool ImpersonateLoggedOnUser(IntPtr token);
 [DllImport("advapi32.dll")]static extern bool RevertToSelf();
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcessAsUserW(IntPtr token,string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup start,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcessW(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup start,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateJobObjectW(IntPtr a,string name);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(IntPtr j,int kind,ref Limits value,uint size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
 [DllImport("kernel32.dll")]static extern uint ResumeThread(IntPtr t);
 [DllImport("kernel32.dll")]static extern uint WaitForSingleObject(IntPtr p,uint ms);
 [DllImport("kernel32.dll")]static extern bool GetExitCodeProcess(IntPtr p,out uint code);
 [DllImport("kernel32.dll")]static extern bool TerminateProcess(IntPtr p,uint code);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr p);
 [DllImport("user32.dll")]static extern IntPtr GetProcessWindowStation();
 [DllImport("user32.dll")]static extern IntPtr GetThreadDesktop(uint thread);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr OpenDesktopW(string name,uint flags,bool inherit,uint access);
 [DllImport("user32.dll")]static extern bool CloseDesktop(IntPtr desktop);
 [DllImport("user32.dll",SetLastError=true)]static extern bool GetUserObjectInformationW(IntPtr h,int kind,IntPtr data,uint size,out uint needed);
 public static string DesktopEvidence="null";
 static void Check(bool value,string call){if(!value)throw new Win32Exception(Marshal.GetLastWin32Error(),"DIAGNOSE_LAUNCH:"+call+":"+Marshal.GetLastWin32Error());}
 static string Name(IntPtr h){IntPtr p=Marshal.AllocHGlobal(1024);try{uint needed;Check(GetUserObjectInformationW(h,2,p,1024,out needed),"GetUserObjectInformationW");return Marshal.PtrToStringUni(p);}finally{Marshal.FreeHGlobal(p);}}
 static string Quote(string s){return "\""+s.Replace("\"","\\\"")+"\"";}
 public static uint Run(string mode,string executable,string[] args,int timeout){IntPtr token=IntPtr.Zero,limited=IntPtr.Zero,imp=IntPtr.Zero,medium=IntPtr.Zero,job=IntPtr.Zero;IntPtr admins=Marshal.AllocHGlobal(68);Info child=new Info();LimitedDesktop owned=null;string previous=Environment.GetEnvironmentVariable("SP_PROOF_DESKTOP");try{
  Check(OpenProcessToken(GetCurrentProcess(),0x02000000,out token),"OpenProcessToken");IntPtr selected=token;
  if(mode=="restricted-session-desktop"){uint size=68;Check(CreateWellKnownSid(26,IntPtr.Zero,admins,ref size),"AdministratorsSid");var deny=new SidEntry{sid=admins};Check(CreateRestrictedToken(token,1|4,1,ref deny,0,IntPtr.Zero,0,IntPtr.Zero,out limited),"CreateRestrictedToken");Check(ConvertStringSidToSidW("S-1-16-8192",out medium),"MediumSid");var integrity=new SidEntry{sid=medium,attributes=0x20};Check(SetTokenInformation(limited,25,ref integrity,(uint)(Marshal.SizeOf(typeof(SidEntry))+12)),"SetMediumIntegrity");selected=limited;}
  Check(DuplicateToken(selected,2,out imp),"DuplicateToken");string desktop;
  if(mode=="unrestricted-owned"){owned=new LimitedDesktop(selected,imp);desktop=owned.Path;DesktopEvidence=owned.Evidence();}
  else{string station=Name(GetProcessWindowStation()),name=Name(GetThreadDesktop(GetCurrentThreadId()));Check(ImpersonateLoggedOnUser(imp),"ImpersonateSessionCheck");try{IntPtr opened=OpenDesktopW(name,0,false,0x43);Check(opened!=IntPtr.Zero,"OpenSessionDesktop");CloseDesktop(opened);}finally{Check(RevertToSelf(),"RevertSessionCheck");}desktop=station+"\\"+name;Environment.SetEnvironmentVariable("SP_PROOF_DESKTOP",desktop);DesktopEvidence="{\"selection\":\"session-desktop\",\"requestedAccess\":67,\"aclChanged\":false}";}
  job=CreateJobObjectW(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"CreateJobObjectW");var limits=new Limits{basic=new Basic{flags=0x2000}};Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))),"SetKillOnClose");var command=new StringBuilder(Quote(executable));foreach(string arg in args)command.Append(' ').Append(Quote(arg));var start=new Startup{cb=Marshal.SizeOf(typeof(Startup)),desktop=desktop,flags=0x100,input=GetStdHandle(-10),output=GetStdHandle(-11),error=GetStdHandle(-12)};
  Check(mode=="unrestricted-owned"?CreateProcessW(executable,command,IntPtr.Zero,IntPtr.Zero,true,4,IntPtr.Zero,Environment.CurrentDirectory,ref start,out child):CreateProcessAsUserW(limited,executable,command,IntPtr.Zero,IntPtr.Zero,true,4,IntPtr.Zero,Environment.CurrentDirectory,ref start,out child),"CreateOwnedChild");Check(AssignProcessToJobObject(job,child.process),"AssignOwnedJob");Check(ResumeThread(child.thread)!=0xffffffff,"ResumeChild");if(WaitForSingleObject(child.process,(uint)timeout*1000)!=0)throw new Exception("DIAGNOSE_CHILD_TIMEOUT");uint code;Check(GetExitCodeProcess(child.process,out code),"GetExitCodeProcess");return code;
 }finally{Environment.SetEnvironmentVariable("SP_PROOF_DESKTOP",previous);if(job!=IntPtr.Zero)CloseHandle(job);if(child.process!=IntPtr.Zero){if(WaitForSingleObject(child.process,5000)!=0){TerminateProcess(child.process,1);WaitForSingleObject(child.process,5000);}}foreach(IntPtr h in new[]{child.thread,child.process,imp,limited,token})if(h!=IntPtr.Zero)CloseHandle(h);if(owned!=null)owned.Dispose();if(medium!=IntPtr.Zero)LocalFree(medium);Marshal.FreeHGlobal(admins);}}
}
'@ + $desktopSource)
try {
 $arguments=[string[]]([IO.File]::ReadAllText($ArgumentsFile)|ConvertFrom-Json)
 $code=[DiagnoseLaunch]::Run($Mode,$Executable,$arguments,$TimeoutSeconds)
 $normalAdmin=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 @{diagnosticOnly=$true;acceptance=$false;variant=$Mode;state='returned';tokenSelection=$(if($Mode-eq'unrestricted-owned'){'normal-inherited'}else{'LUA-medium-admin-deny-only'});parentAdminMember=$normalAdmin;childExit=$code;desktop=([DiagnoseLaunch]::DesktopEvidence|ConvertFrom-Json);lifecycle='owned-job-kill-on-close'}|ConvertTo-Json -Depth 7 -Compress|Set-Content -LiteralPath $TokenReport -Encoding UTF8
 exit $code
}catch {
 $cause=$_.Exception;while($cause.InnerException){$cause=$cause.InnerException}
 @{diagnosticOnly=$true;acceptance=$false;variant=$Mode;state='blocked';reason=$cause.Message;win32Error=$cause.NativeErrorCode;desktop=([DiagnoseLaunch]::DesktopEvidence|ConvertFrom-Json)}|ConvertTo-Json -Depth 7 -Compress|Set-Content -LiteralPath $TokenReport -Encoding UTF8
 exit 2
}
