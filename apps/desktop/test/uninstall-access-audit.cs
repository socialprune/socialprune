using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

// Read only this query caller's token and one generated child PID supplied by
// the test. Do not change privileges, inspect command lines or touch profiles.
public static class UninstallAccessAudit {
  [StructLayout(LayoutKind.Sequential)] struct Luid { public uint low;public int high; }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long born,out long exited,out long kernel,out long user);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr data,uint size,out uint needed);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool LookupPrivilegeValueW(string system,string name,out Luid luid);
  static IntPtr Data(IntPtr token,int kind) {
    uint size;GetTokenInformation(token,kind,IntPtr.Zero,0,out size);
    if(size==0)throw new Win32Exception(Marshal.GetLastWin32Error(),"ACCESS_AUDIT_TOKEN_SIZE");
    var data=Marshal.AllocHGlobal((int)size);
    if(!GetTokenInformation(token,kind,data,size,out size)) { int error=Marshal.GetLastWin32Error();Marshal.FreeHGlobal(data);throw new Win32Exception(error,"ACCESS_AUDIT_TOKEN_READ"); }
    return data;
  }
  static string B(bool value) { return value?"true":"false"; }
  public static void Main(string[] args) {
    if(args.Length!=2)throw new Exception("ACCESS_AUDIT_ARGUMENTS");
    uint pid=uint.Parse(args[0]),callerPid=uint.Parse(args[1]);if(pid==0||callerPid==0)throw new Exception("ACCESS_AUDIT_PID");
    // This PID comes from process.pid at the invoking test, not a system scan.
    IntPtr caller=OpenProcess(0x1000,false,callerPid);
    if(caller==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"ACCESS_AUDIT_CALLER_OPEN");
    IntPtr token;
    try { if(!OpenProcessToken(caller,8,out token))throw new Win32Exception(Marshal.GetLastWin32Error(),"ACCESS_AUDIT_TOKEN_OPEN"); }
    finally { CloseHandle(caller); }
    IntPtr elevation=IntPtr.Zero,integrity=IntPtr.Zero,privileges=IntPtr.Zero,user=IntPtr.Zero;
    try {
      elevation=Data(token,20);integrity=Data(token,25);privileges=Data(token,3);user=Data(token,1);
      string sid=new SecurityIdentifier(Marshal.ReadIntPtr(user)).Value,level=new SecurityIdentifier(Marshal.ReadIntPtr(integrity)).Value;
      Luid debug;if(!LookupPrivilegeValueW(null,"SeDebugPrivilege",out debug))throw new Win32Exception(Marshal.GetLastWin32Error(),"ACCESS_AUDIT_DEBUG_LUID");
      bool present=false,enabled=false;int count=Marshal.ReadInt32(privileges);
      for(int i=0;i<count;i++) { int offset=4+i*12;if(unchecked((uint)Marshal.ReadInt32(privileges,offset))==debug.low&&Marshal.ReadInt32(privileges,offset+4)==debug.high){present=true;enabled=(Marshal.ReadInt32(privileges,offset+8)&2)!=0;} }
      IntPtr process=OpenProcess(0x1000,false,pid);int error=process==IntPtr.Zero?Marshal.GetLastWin32Error():0;long born=0,a,b,c;
      try { if(process!=IntPtr.Zero&&!GetProcessTimes(process,out born,out a,out b,out c))throw new Win32Exception(Marshal.GetLastWin32Error(),"ACCESS_AUDIT_BIRTH_READ"); }
      finally { if(process!=IntPtr.Zero)CloseHandle(process); }
      Console.WriteLine("{\"pid\":"+pid+",\"callerPid\":"+callerPid+",\"tokenSource\":\"actual-test-parent\",\"parentElevated\":"+B(Marshal.ReadInt32(elevation)!=0)+",\"rid500\":"+B(sid.EndsWith("-500",StringComparison.Ordinal))+",\"integrityRid\":"+level.Substring(level.LastIndexOf('-')+1)+",\"debugPrivilegePresent\":"+B(present)+",\"debugPrivilegeEnabled\":"+B(enabled)+",\"openSucceeded\":"+B(process!=IntPtr.Zero)+",\"openError\":"+error+",\"born\":"+(born==0?"null":"\""+born+"\"")+"}");
    } finally {
      foreach(IntPtr value in new[]{elevation,integrity,privileges,user})if(value!=IntPtr.Zero)Marshal.FreeHGlobal(value);
      CloseHandle(token);
    }
  }
}
