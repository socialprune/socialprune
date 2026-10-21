param([string]$Node, [string]$Entry, [int]$TimeoutMs)
$ErrorActionPreference = 'Stop'
if ($TimeoutMs -le 0) { throw 'FIXTURE_TIMEOUT_REQUIRED' }
# Synthetic UIA probe only. The anonymous station belongs to this test, needs
# no elevation, never becomes the input station and closes its child job first.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class WindowStationFixture {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved,desktop,title; public int x,y,cx,cy,xchars,ychars,fill,flags;
    public short show,reserved2; public IntPtr bytes,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct Info { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public long processTime,jobTime; public uint flags; public UIntPtr minWorkingSet,maxWorkingSet;
    public uint activeProcessLimit; public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct JobLimits { public Limits basic; public Io io; public UIntPtr a,b,c,d; }
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateWindowStationW(string name,uint flags,uint access,IntPtr sa);
  [DllImport("user32.dll",SetLastError=true)] static extern bool SetProcessWindowStation(IntPtr handle);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateDesktopW(string name,IntPtr device,IntPtr mode,uint flags,uint access,IntPtr sa);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr handle,int kind,IntPtr data,uint size,out uint needed);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr handle);
  [DllImport("user32.dll")] static extern bool CloseWindowStation(IntPtr handle);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr environment,string cwd,ref Startup startup,out Info info);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr handle);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr handle,uint code);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref JobLimits limits,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  static void Require(bool value,string code) { if(!value) throw new Win32Exception(Marshal.GetLastWin32Error(),code); }
  public static uint Run(string node,string entry,int timeoutMs) {
    IntPtr original=GetProcessWindowStation(),station=IntPtr.Zero,desktop=IntPtr.Zero,job=IntPtr.Zero;
    var info=new Info();
    try {
      station=CreateWindowStationW(null,0,0xF037F,IntPtr.Zero);
      Require(station!=IntPtr.Zero,"FIXTURE_STATION_CREATE");
      IntPtr data=Marshal.AllocHGlobal(1024); string name;
      try { uint needed; Require(GetUserObjectInformationW(station,2,data,1024,out needed),"FIXTURE_STATION_NAME"); name=Marshal.PtrToStringUni(data); }
      finally { Marshal.FreeHGlobal(data); }
      Require(SetProcessWindowStation(station),"FIXTURE_STATION_SELECT");
      string desk="SocialPrune-test-"+Guid.NewGuid().ToString();
      desktop=CreateDesktopW(desk,IntPtr.Zero,IntPtr.Zero,0,0xF01FF,IntPtr.Zero);
      Require(desktop!=IntPtr.Zero,"FIXTURE_DESKTOP_CREATE");
      Require(SetProcessWindowStation(original),"FIXTURE_STATION_RESTORE");
      job=CreateJobObjectW(IntPtr.Zero,null);
      var limits=new JobLimits { basic=new Limits { flags=0x2000 } };
      Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(JobLimits))),"FIXTURE_JOB_LIMIT");
      var startup=new Startup { cb=Marshal.SizeOf(typeof(Startup)),desktop=name+"\\"+desk,flags=0x100,input=GetStdHandle(-10),output=GetStdHandle(-11),error=GetStdHandle(-12) };
      Require(CreateProcessW(node,new StringBuilder("\""+node+"\" \""+entry+"\""),IntPtr.Zero,IntPtr.Zero,true,4,IntPtr.Zero,Environment.CurrentDirectory,ref startup,out info),"FIXTURE_CHILD_CREATE");
      Require(AssignProcessToJobObject(job,info.process),"FIXTURE_JOB_ASSIGN");
      Require(ResumeThread(info.thread)!=0xffffffff,"FIXTURE_CHILD_RESUME");
      if(WaitForSingleObject(info.process,(uint)timeoutMs)!=0) throw new Exception("FIXTURE_CHILD_TIMEOUT");
      uint code; Require(GetExitCodeProcess(info.process,out code),"FIXTURE_CHILD_EXIT"); return code;
    } finally {
      SetProcessWindowStation(original);
      if(job!=IntPtr.Zero) CloseHandle(job);
      if(info.process!=IntPtr.Zero) {
        if(WaitForSingleObject(info.process,5000)!=0) { TerminateProcess(info.process,1); WaitForSingleObject(info.process,5000); }
        CloseHandle(info.process);
      }
      if(info.thread!=IntPtr.Zero) CloseHandle(info.thread);
      if(desktop!=IntPtr.Zero) CloseDesktop(desktop);
      if(station!=IntPtr.Zero) CloseWindowStation(station);
    }
  }
}
'@
exit ([WindowStationFixture]::Run($Node, $Entry, $TimeoutMs))
