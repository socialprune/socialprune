using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;

// Harness-only read-only kernel/IP Helper tables, as in network-watch.ps1.
// Identity is PID + creation time. No command lines or profiles are read.
public static class DesktopQuery {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct Entry { public uint size, usage, pid; public IntPtr heap; public uint module, threads, parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string name; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref uint size, bool order, uint family, int kind, uint reserved);
  [DllImport("iphlpapi.dll")] static extern uint GetExtendedUdpTable(IntPtr table, ref uint size, bool order, uint family, int kind, uint reserved);
  static string Json(string text) {
    var result = new StringBuilder("\"");
    foreach(char c in text) {
      if(c=='"'||c=='\\') result.Append('\\').Append(c);
      else if(c<32) result.Append("\\u").Append(((int)c).ToString("x4"));
      else result.Append(c);
    }
    return result.Append('"').ToString();
  }
  static IntPtr Open(uint pid) {
    IntPtr handle=OpenProcess(0x1000,false,pid);
    if(handle==IntPtr.Zero) {
      int error=Marshal.GetLastWin32Error();
      // Only not-found means absent. Access denied is a query failure.
      if(error!=87) throw new Win32Exception(error,"PROCESS_OPEN_FAILED");
    }
    return handle;
  }
  static long Born(IntPtr handle) {
    long a,b,c,d;
    if(!GetProcessTimes(handle,out a,out b,out c,out d)) throw new Win32Exception(Marshal.GetLastWin32Error(),"PROCESS_TIMES_FAILED");
    return a;
  }
  static HashSet<uint> Pids(string input) {
    var ids=new HashSet<uint>();
    foreach(string value in input.Split(',')) { uint pid; if(!uint.TryParse(value,out pid)||pid==0) throw new Exception("INVALID_PID"); ids.Add(pid); }
    return ids;
  }
  static string Identities(HashSet<uint> ids) {
    var rows=new List<string>();
    foreach(uint pid in ids) {
      IntPtr handle=Open(pid); if(handle==IntPtr.Zero) continue;
      try { rows.Add("{\"pid\":"+pid+",\"born\":"+Json(Born(handle).ToString())+"}"); }
      finally { CloseHandle(handle); }
    }
    return "["+string.Join(",",rows)+"]";
  }
  static string Processes(string executable) {
    var rows=new List<string>();
    IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
    if(snapshot==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error(),"PROCESS_SNAPSHOT_FAILED");
    try {
      Entry entry=new Entry(); entry.size=(uint)Marshal.SizeOf(typeof(Entry));
      bool next=Process32FirstW(snapshot,ref entry);
      while(next) {
        if(string.Equals(entry.name,"SocialPrune.exe",StringComparison.OrdinalIgnoreCase)) {
          IntPtr handle=Open(entry.pid);
          if(handle!=IntPtr.Zero) try {
            var path=new StringBuilder(32768); uint size=32768;
            if(!QueryFullProcessImageNameW(handle,0,path,ref size)) throw new Win32Exception(Marshal.GetLastWin32Error(),"PROCESS_IMAGE_FAILED");
            if(string.Equals(path.ToString(),executable,StringComparison.OrdinalIgnoreCase)) rows.Add("{\"ProcessId\":"+entry.pid+",\"ParentProcessId\":"+entry.parent+",\"ExecutablePath\":"+Json(path.ToString())+",\"born\":"+Json(Born(handle).ToString())+"}");
          } finally { CloseHandle(handle); }
        }
        next=Process32NextW(snapshot,ref entry);
      }
      int error=Marshal.GetLastWin32Error();
      if(error!=18) throw new Win32Exception(error,"PROCESS_SNAPSHOT_READ_FAILED");
    } finally { CloseHandle(snapshot); }
    return "["+string.Join(",",rows)+"]";
  }
  static void Sockets(HashSet<uint> ids, bool tcp, uint family, List<string> connections, ref int listeners, ref int udp) {
    uint size=0;
    uint code=tcp?GetExtendedTcpTable(IntPtr.Zero,ref size,false,family,5,0):GetExtendedUdpTable(IntPtr.Zero,ref size,false,family,1,0);
    if(code!=0&&code!=122) throw new Exception("NETWORK_TABLE_SIZE_FAILED:"+code);
    if(size==0) return;
    IntPtr data=Marshal.AllocHGlobal((int)size);
    try {
      code=tcp?GetExtendedTcpTable(data,ref size,false,family,5,0):GetExtendedUdpTable(data,ref size,false,family,1,0);
      if(code!=0) throw new Exception("NETWORK_TABLE_FAILED:"+code);
      int count=Marshal.ReadInt32(data), stride=tcp?(family==2?24:56):(family==2?12:28);
      for(int i=0;i<count;i++) {
        IntPtr row=IntPtr.Add(data,4+i*stride);
        uint pid=unchecked((uint)Marshal.ReadInt32(row,stride-4)); if(!ids.Contains(pid)) continue;
        if(!tcp) { udp++; continue; }
        int state=Marshal.ReadInt32(row,family==2?0:48);
        if(state==2) { listeners++; continue; }
        int offset=family==2?16:44;
        int port=(Marshal.ReadByte(row,offset)<<8)|Marshal.ReadByte(row,offset+1);
        if(port==0) continue;
        byte[] address=new byte[family==2?4:16]; Marshal.Copy(IntPtr.Add(row,family==2?12:24),address,0,address.Length);
        var ip=family==2?new IPAddress(address):new IPAddress(address,unchecked((uint)Marshal.ReadInt32(row,40)));
        connections.Add("{\"processId\":"+pid+",\"remoteAddress\":"+Json(ip.ToString())+",\"remotePort\":"+port+"}");
      }
    } finally { Marshal.FreeHGlobal(data); }
  }
  static string Network(HashSet<uint> ids, bool onlyListeners) {
    var connections=new List<string>(); int listeners=0,udp=0;
    foreach(uint family in new uint[]{2,23}) {
      Sockets(ids,true,family,connections,ref listeners,ref udp);
      if(onlyListeners) Sockets(ids,false,family,connections,ref listeners,ref udp);
    }
    return onlyListeners?"{\"tcp\":"+listeners+",\"udp\":"+udp+"}":"["+string.Join(",",connections)+"]";
  }
  public static string Query(string operation, string argument) {
    switch(operation) {
      case "processes": return Processes(argument);
      case "identities": return Identities(Pids(argument));
      case "listeners": return Network(Pids(argument),true);
      case "connections": return Network(Pids(argument),false);
      default: throw new Exception("QUERY_OPERATION_INVALID");
    }
  }
  public static int Main(string[] args) {
    try {
      if(args.Length!=2) throw new Exception("QUERY_ARGUMENTS_INVALID");
      Console.WriteLine(Query(args[0], args[1])); return 0;
    } catch(Exception error) { Console.Error.WriteLine(error); return 1; }
  }
}
