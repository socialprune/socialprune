param([string]$InstallRoot, [string]$Output, [string]$RootIds)
$ErrorActionPreference = 'Stop'
# Native read-only tables avoid CIM's seconds-per-sample overhead. No command
# line, profile, file content or socket of a foreign process is recorded.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ReleaseNetwork {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct Entry { public uint size, usage, pid; public IntPtr heap; public uint module, threads, parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string name; }
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref uint size);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref uint size, bool order, uint family, int kind, uint reserved);
  [DllImport("iphlpapi.dll")] static extern uint GetExtendedUdpTable(IntPtr table, ref uint size, bool order, uint family, int kind, uint reserved);
  public static HashSet<string> Observed = new HashSet<string>();
  public static HashSet<string> Violations = new HashSet<string>();
  static Dictionary<uint,long> owned = new Dictionary<uint,long>();
  public static int Ticks;
  public static void Sample(string root, uint[] roots) {
    var current = new Dictionary<uint,Entry>();
    var births = new Dictionary<uint,long>();
    var images = new Dictionary<uint,string>();
    IntPtr snapshot = CreateToolhelp32Snapshot(2,0);
    if (snapshot == new IntPtr(-1)) throw new Exception("NETWORK_PROCESS_SNAPSHOT_FAILED");
    try {
      Entry entry = new Entry(); entry.size=(uint)Marshal.SizeOf(typeof(Entry));
      bool next=Process32FirstW(snapshot,ref entry);
      while(next) { current[entry.pid]=entry; next=Process32NextW(snapshot,ref entry); }
    } finally { CloseHandle(snapshot); }
    foreach(var pair in current) {
      IntPtr handle=OpenProcess(0x1000,false,pair.Key);
      if(handle==IntPtr.Zero) continue;
      try {
        long a,b,c,d; if(!GetProcessTimes(handle,out a,out b,out c,out d)) continue;
        births[pair.Key]=a;
        var path=new StringBuilder(32768); uint size=32768;
        if(QueryFullProcessImageNameW(handle,0,path,ref size)) images[pair.Key]=path.ToString();
      } finally { CloseHandle(handle); }
    }
    // Retain exited ancestors: a short-lived installer may have exited before
    // its temp child is sampled. Invalidate a PID only when a new creation
    // time proves reuse; sockets always require a live matching identity.
    foreach(uint pid in new List<uint>(owned.Keys))
      if(births.ContainsKey(pid)&&births[pid]!=owned[pid]) owned.Remove(pid);
    foreach(uint pid in roots) if(births.ContainsKey(pid)) owned[pid]=births[pid];
    foreach(var image in images)
      if(image.Value.StartsWith(root.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase)) owned[image.Key]=births[image.Key];
    bool changed;
    do {
      changed=false;
      foreach(var pair in current)
        if(!owned.ContainsKey(pair.Key)&&births.ContainsKey(pair.Key)&&owned.ContainsKey(pair.Value.parent)&&births[pair.Key]>=owned[pair.Value.parent]) { owned[pair.Key]=births[pair.Key]; changed=true; }
    } while(changed);
    foreach(uint pid in owned.Keys) {
      if(!current.ContainsKey(pid)||!births.ContainsKey(pid)||births[pid]!=owned[pid]) continue;
      string image; if(!images.TryGetValue(pid,out image)) image="unknown";
      Observed.Add(pid+"|"+current[pid].parent+"|"+image+"|"+births[pid]);
    }
    foreach(uint family in new uint[]{2,23}) { Table(true,family); Table(false,family); }
    Ticks++;
  }
  static void Table(bool tcp,uint family) {
    uint size=0;
    uint code=tcp?GetExtendedTcpTable(IntPtr.Zero,ref size,false,family,5,0):GetExtendedUdpTable(IntPtr.Zero,ref size,false,family,1,0);
    if(code!=0&&code!=122) throw new Exception("NETWORK_TABLE_SIZE_FAILED:"+code);
    if(size==0) return;
    IntPtr data=Marshal.AllocHGlobal((int)size);
    try {
      code=tcp?GetExtendedTcpTable(data,ref size,false,family,5,0):GetExtendedUdpTable(data,ref size,false,family,1,0);
      if(code!=0) throw new Exception("NETWORK_TABLE_FAILED:"+code);
      int count=Marshal.ReadInt32(data);
      int stride=tcp?(family==2?24:56):(family==2?12:28);
      for(int i=0;i<count;i++) {
        IntPtr row=IntPtr.Add(data,4+i*stride);
        uint pid=unchecked((uint)Marshal.ReadInt32(row,stride-4));
        if(!owned.ContainsKey(pid)) continue;
        int state=tcp?Marshal.ReadInt32(row,family==2?0:48):0;
        // TIME_WAIT no longer belongs to an open connection. Every other TCP
        // state and every UDP endpoint is rejected for an owned process.
        if(tcp&&state==11) continue;
        int offset=family==2?(tcp?8:4):20;
        int port=(Marshal.ReadByte(row,offset)<<8)|Marshal.ReadByte(row,offset+1);
        string kind=tcp?(state==2?"listener":"connection"):"udp";
        Violations.Add(kind+"|"+pid+"|"+family+"|"+port+"|state="+state);
      }
    } finally { Marshal.FreeHGlobal(data); }
  }
}
'@
$roots = [uint32[]]@($RootIds.Split(',') | Where-Object { $_ } | ForEach-Object { [uint32]$_ })
[ReleaseNetwork]::Sample($InstallRoot, $roots)
[IO.File]::WriteAllText("$Output.ready", 'ready')
$deadline = [DateTime]::UtcNow.AddMinutes(20)
while (-not [IO.File]::Exists("$Output.stop")) {
  if ([DateTime]::UtcNow -gt $deadline) { throw 'NETWORK_WATCH_DEADLINE' }
  [ReleaseNetwork]::Sample($InstallRoot, $roots)
  Start-Sleep -Milliseconds 50
}
[ReleaseNetwork]::Sample($InstallRoot, $roots)
$report = @{ ticks = [ReleaseNetwork]::Ticks; observed = @([ReleaseNetwork]::Observed | Sort-Object); violations = @([ReleaseNetwork]::Violations | Sort-Object) } | ConvertTo-Json -Depth 4 -Compress
[IO.File]::WriteAllText($Output, $report, [Text.UTF8Encoding]::new($false))
