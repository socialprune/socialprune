param([string]$Executable, [string]$ArgumentsFile, [string]$Receipt, [ValidateSet(4,7)][int]$ShowCommand = 4)
$ErrorActionPreference = 'Stop'
# Launch the unchanged release. STARTUPINFO is an OS request, not a switch or
# environment selector in the app. The anonymous job owns only this child tree.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class InactiveRelease {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {public int cb; public string reserved,desktop,title; public int x,y,cx,cy,xchars,ychars,fill,flags; public short show,reserved2; public IntPtr bytes,input,output,error;}
  [StructLayout(LayoutKind.Sequential)] struct Info {public IntPtr process,thread;public uint pid,tid;}
  [StructLayout(LayoutKind.Sequential)] struct Basic {public long processTime,jobTime;public uint flags;public UIntPtr min,max;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
  [StructLayout(LayoutKind.Sequential)] struct Io {public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;}
  [StructLayout(LayoutKind.Sequential)] struct Limits {public Basic basic;public Io io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcessW(string app,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out Info info);
  [DllImport("kernel32.dll")]static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateJobObjectW(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetInformationJobObject(IntPtr job,int kind,ref Limits limits,uint size);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)]static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)]static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)]static extern bool TerminateProcess(IntPtr process,uint code);
  static void Require(bool result,string operation){if(!result)throw new Win32Exception(Marshal.GetLastWin32Error(),operation);}
  static string Quote(string value){var text=new StringBuilder("\"");int slashes=0;foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"')text.Append('\\',slashes*2+1).Append('"');else text.Append('\\',slashes).Append(c);slashes=0;}return text.Append('\\',slashes*2).Append('"').ToString();}
  public static uint Run(string app,string[] args,string receipt,short show){
    var command=new StringBuilder(Quote(app));foreach(string arg in args)command.Append(" ").Append(Quote(arg));
    var startup=new Startup{cb=Marshal.SizeOf(typeof(Startup)),flags=0x101,show=show,input=GetStdHandle(-10),output=GetStdHandle(-11),error=GetStdHandle(-12)};
    Info child=new Info();IntPtr job=IntPtr.Zero;bool assigned=false;
    try{
      job=CreateJobObjectW(IntPtr.Zero,null);Require(job!=IntPtr.Zero,"CreateInactiveJob");
      var limits=new Limits{basic=new Basic{flags=0x2000}};
      Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))),"LimitInactiveJob");
      Require(CreateProcessW(app,command,IntPtr.Zero,IntPtr.Zero,true,4,IntPtr.Zero,null,ref startup,out child),"CreateInactiveChild");
      Require(AssignProcessToJobObject(job,child.process),"AssignInactiveChild");assigned=true;
      Require(ResumeThread(child.thread)!=0xffffffff,"ResumeInactiveChild");
      System.IO.File.WriteAllText(receipt,"{\"pid\":"+child.pid+",\"showCommand\":"+show+",\"startupFlags\":257,\"ownedJob\":true}");
      if(WaitForSingleObject(child.process,180000)!=0)throw new Exception("INACTIVE_CHILD_TIMEOUT");
      uint code;Require(GetExitCodeProcess(child.process,out code),"InactiveChildExit");return code;
    }finally{
      if(!assigned&&child.process!=IntPtr.Zero)TerminateProcess(child.process,1);
      if(job!=IntPtr.Zero)CloseHandle(job);
      if(child.process!=IntPtr.Zero)WaitForSingleObject(child.process,5000);
      if(child.thread!=IntPtr.Zero)CloseHandle(child.thread);
      if(child.process!=IntPtr.Zero)CloseHandle(child.process);
    }
  }
}
'@
$arguments = [string[]](Get-Content -LiteralPath $ArgumentsFile -Raw | ConvertFrom-Json)
exit [InactiveRelease]::Run($Executable,$arguments,$Receipt,[int16]$ShowCommand)
