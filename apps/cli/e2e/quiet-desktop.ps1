param([string]$Node, [string]$Entry, [string]$Directory)
$ErrorActionPreference = 'Stop'
if ($env:SP_TEST_STOP_FILE -and (Test-Path -LiteralPath $env:SP_TEST_STOP_FILE)) { exit 97 }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QuietDesktop {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {
    public int size; public string reserved,desktop,title;
    public int x,y,width,height,charsX,charsY,fill,flags; public short show,reservedSize;
    public IntPtr reservedData,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public int pid,tid; }
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateDesktop(string name,IntPtr device,IntPtr mode,int flags,uint access,IntPtr security);
  [DllImport("user32.dll",SetLastError=true)] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,string command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,int flags,IntPtr environment,string directory,ref Startup startup,out ProcessInfo process);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out int code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static int Run(string node,string entry,string directory) {
    string name="sp-test-"+Guid.NewGuid().ToString("N");
    var desktop=CreateDesktop(name,IntPtr.Zero,IntPtr.Zero,0,0x01FF,IntPtr.Zero);
    if(desktop==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();
    var startup=new Startup();startup.size=Marshal.SizeOf(startup);startup.desktop=name;
    ProcessInfo process;
    try {
      string command="\""+node+"\" \""+entry+"\" \""+directory+"\"";
      if(!CreateProcess(node,command,IntPtr.Zero,IntPtr.Zero,false,0x08000000,IntPtr.Zero,null,ref startup,out process)) throw new System.ComponentModel.Win32Exception();
      try {
        WaitForSingleObject(process.process,0xFFFFFFFF);
        int code;GetExitCodeProcess(process.process,out code);return code;
      } finally { CloseHandle(process.thread);CloseHandle(process.process); }
    } finally { if(!CloseDesktop(desktop))throw new System.ComponentModel.Win32Exception(); }
  }
}
'@
if ($env:SP_TEST_STOP_FILE -and (Test-Path -LiteralPath $env:SP_TEST_STOP_FILE)) { exit 97 }
exit [QuietDesktop]::Run($Node, $Entry, $Directory)
