param([int]$RootId,[string]$Output)
$ErrorActionPreference='Stop'
# Read-only observation. No titles, input, activation, placement or foreign
# process command lines are read. Only windows in the owned root's tree leave
# this sampler; identity includes PID and process creation time.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class OwnedWindowFocus {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Entry {public uint size,usage,pid;public IntPtr heap;public uint module,threads,parent;public int priority;public uint flags;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string name;}
 [DllImport("kernel32.dll")]static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool Process32FirstW(IntPtr snapshot,ref Entry entry);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool Process32NextW(IntPtr snapshot,ref Entry entry);
 [DllImport("kernel32.dll")]static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll")]static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 delegate bool EnumProc(IntPtr window,IntPtr data);
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc callback,IntPtr data);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]static extern bool IsIconic(IntPtr window);
  [StructLayout(LayoutKind.Sequential)]struct Rect{public int left,top,right,bottom;}
  [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr window,out Rect rect);
 static readonly Dictionary<uint,long> owned=new Dictionary<uint,long>();
 static readonly Dictionary<uint,string> images=new Dictionary<uint,string>();
  public static readonly List<object> Windows=new List<object>(),Foreground=new List<object>();
  public static readonly List<object> Intrusions=new List<object>();
  static readonly HashSet<string> intrusions=new HashSet<string>();
 static readonly HashSet<string> seen=new HashSet<string>();
 static IntPtr previous=IntPtr.Zero;
 public static int Samples;
 static long Born(uint pid){IntPtr p=OpenProcess(0x1000,false,pid);if(p==IntPtr.Zero)return 0;try{long a,b,c,d;return GetProcessTimes(p,out a,out b,out c,out d)?a:0;}finally{CloseHandle(p);}}
 public static void Processes(uint root){
  var current=new Dictionary<uint,Entry>();IntPtr snapshot=CreateToolhelp32Snapshot(2,0);if(snapshot==new IntPtr(-1))throw new Exception("WINDOW_PROCESS_SNAPSHOT_FAILED");
  try{Entry e=new Entry();e.size=(uint)Marshal.SizeOf(typeof(Entry));bool next=Process32FirstW(snapshot,ref e);while(next){current[e.pid]=e;next=Process32NextW(snapshot,ref e);}}finally{CloseHandle(snapshot);}
  foreach(uint pid in new List<uint>(owned.Keys)){long born=Born(pid);if(born!=0&&born!=owned[pid]){owned.Remove(pid);images.Remove(pid);}}
  if(current.ContainsKey(root)&&!owned.ContainsKey(root)){long born=Born(root);if(born!=0){owned[root]=born;images[root]=current[root].name;}}
  bool changed;do{changed=false;foreach(var row in current){if(owned.ContainsKey(row.Key)||!owned.ContainsKey(row.Value.parent))continue;long born=Born(row.Key);if(born!=0&&born>=owned[row.Value.parent]){owned[row.Key]=born;images[row.Key]=row.Value.name;changed=true;}}}while(changed);
 }
  static object Row(IntPtr window,uint pid){return new {pid=pid,born=owned[pid],window=window.ToInt64().ToString("x"),image=images[pid],at=DateTime.UtcNow.ToString("o"),minimized=IsIconic(window)};}
  public static void Sample(){
   IntPtr foreground=GetForegroundWindow();bool above=true;Rect foregroundRect;bool hasForegroundRect=GetWindowRect(foreground,out foregroundRect);
   EnumWindows((window,data)=>{if(window==foreground)above=false;uint pid;GetWindowThreadProcessId(window,out pid);if(owned.ContainsKey(pid)&&Born(pid)==owned[pid]&&IsWindowVisible(window)){string id=pid+"|"+owned[pid]+"|"+window; if(seen.Add(id))Windows.Add(Row(window,pid));Rect rect;if(above&&!IsIconic(window)&&hasForegroundRect&&GetWindowRect(window,out rect)&&rect.left<foregroundRect.right&&rect.right>foregroundRect.left&&rect.top<foregroundRect.bottom&&rect.bottom>foregroundRect.top&&intrusions.Add(id))Intrusions.Add(Row(window,pid));}return true;},IntPtr.Zero);
   if(foreground!=previous){uint pid;GetWindowThreadProcessId(foreground,out pid);if(owned.ContainsKey(pid)&&Born(pid)==owned[pid])Foreground.Add(Row(foreground,pid));previous=foreground;}
  Samples++;
 }
}
'@
[OwnedWindowFocus]::Processes([uint32]$RootId)
[IO.File]::WriteAllText($Output+'.ready','ready')
$clock=[Diagnostics.Stopwatch]::StartNew();$nextProcesses=0
while(-not [IO.File]::Exists($Output+'.stop')) {
  if($clock.ElapsedMilliseconds-ge$nextProcesses){[OwnedWindowFocus]::Processes([uint32]$RootId);$nextProcesses=$clock.ElapsedMilliseconds+50}
  [OwnedWindowFocus]::Sample()
  [Threading.Thread]::Sleep(10)
}
[OwnedWindowFocus]::Processes([uint32]$RootId);[OwnedWindowFocus]::Sample()
@{root=$RootId;durationMs=$clock.ElapsedMilliseconds;samples=[OwnedWindowFocus]::Samples;visibleWindows=@([OwnedWindowFocus]::Windows.ToArray());foregroundChanges=@([OwnedWindowFocus]::Foreground.ToArray());intrusions=@([OwnedWindowFocus]::Intrusions.ToArray());method='EnumWindows+GetForegroundWindow/10ms, owned process tree/50ms, PID+creation time; intrusion=unminimized owned window above and intersecting foreground'}|ConvertTo-Json -Depth 6 -Compress|Set-Content -LiteralPath $Output -Encoding UTF8
