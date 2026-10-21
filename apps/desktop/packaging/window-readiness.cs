using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;

// Harness only. UIA RootElement omits windows on a noninteractive station.
// Use the launcher's owned desktop, not the probe thread's incidental desktop.
public static class ReadinessWindows {
  delegate bool WindowCallback(IntPtr window, IntPtr argument);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenDesktopW(string name, uint flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError=true)] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", SetLastError=true)] static extern bool EnumDesktopWindows(IntPtr desktop, WindowCallback callback, IntPtr argument);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder value, int count);
  [DllImport("user32.dll", SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr handle, int kind, IntPtr value, uint size, out uint needed);
  [DllImport("kernel32.dll", EntryPoint="SetLastError")] static extern void ClearLastError(uint error);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr process,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr process);
  [UnmanagedFunctionPointer(CallingConvention.Winapi,CharSet=CharSet.Unicode)] delegate bool DesktopCallback([MarshalAs(UnmanagedType.LPWStr)] string name,IntPtr argument);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EnumDesktopsW(IntPtr station,DesktopCallback callback,IntPtr argument);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [StructLayout(LayoutKind.Sequential)] public struct Rectangle { public int left,top,right,bottom; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rectangle rectangle);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  delegate bool MonitorCallback(IntPtr monitor,IntPtr dc,ref Rectangle rectangle,IntPtr argument);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr clip,MonitorCallback callback,IntPtr argument);

  public sealed class ThreadDesktop { public int threadId;public string desktopName;public string stationName;public bool? matchesPublished;public string failedCall;public int win32Error; }
  public sealed class OwnedWindow { public string desktopName;public long hwnd;public bool visible,minimized;public Rectangle bounds; }
  public sealed class DisplayObservation { public int width,height,virtualLeft,virtualTop,virtualWidth,virtualHeight,monitorCount;public bool stationVisible; }
  public sealed class AppObservation { public int pid;public long observedAt;public bool alive;public uint? exitCode;public string processFailedCall;public int processWin32Error;public string stationName,publishedStationName,publishedDesktopName;public List<ThreadDesktop> threads=new List<ThreadDesktop>();public List<OwnedWindow> windows=new List<OwnedWindow>();public List<string> desktopNames=new List<string>();public List<string> failures=new List<string>();public DisplayObservation display; }
  public sealed class AppWatch : IDisposable {
    IntPtr process;int pid;string selected;
    internal AppWatch(int appPid,string path) { pid=appPid;selected=path;process=RequireHandle(OpenProcess(0x101000,false,pid),"OpenProcess"); }
    public AppObservation ObserveApp() {
      var value=new AppObservation{pid=pid,observedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),alive=WaitForSingleObject(process,0)==258};
      uint exit;if(GetExitCodeProcess(process,out exit)){if(!value.alive)value.exitCode=exit;}else{value.processFailedCall="GetExitCodeProcess";value.processWin32Error=Marshal.GetLastWin32Error();}
      IntPtr station=RequireHandle(GetProcessWindowStation(),"GetProcessWindowStation");value.stationName=Name(station);
      string[] parts=String.IsNullOrEmpty(selected)?new string[0]:selected.Split('\\');
      if(parts.Length==2){value.publishedStationName=parts[0];value.publishedDesktopName=parts[1];}
      if(value.alive) {
        try { using(var app=Process.GetProcessById(pid))foreach(ProcessThread thread in app.Threads)using(thread){
          var row=new ThreadDesktop{threadId=thread.Id};
          ClearLastError(0);IntPtr desktop=GetThreadDesktop((uint)thread.Id);
          if(desktop==IntPtr.Zero){row.failedCall="GetThreadDesktop";row.win32Error=Marshal.GetLastWin32Error();}
          else try{row.desktopName=Name(desktop);row.stationName=value.stationName;if(value.publishedDesktopName!=null)row.matchesPublished=String.Equals(row.desktopName,value.publishedDesktopName,StringComparison.OrdinalIgnoreCase);}catch(NativeFailure error){row.failedCall=error.Call;row.win32Error=error.NativeErrorCode;}
          value.threads.Add(row);
        }} catch(Exception error){value.failures.Add("AppThreads:"+error.GetType().Name);}
      }
      ClearLastError(0);
      if(!EnumDesktopsW(station,delegate(string name,IntPtr argument){value.desktopNames.Add(name);return true;},IntPtr.Zero)){int error=Marshal.GetLastWin32Error();if(error!=0)value.failures.Add("EnumDesktopsW:"+error);}
      foreach(string name in value.desktopNames) {
        IntPtr desktop=OpenDesktopW(name,0,false,0x41);
        if(desktop==IntPtr.Zero){value.failures.Add("OpenDesktopW:"+Marshal.GetLastWin32Error());continue;}
        try {
          ClearLastError(0);bool result=EnumDesktopWindows(desktop,delegate(IntPtr window,IntPtr argument){uint owner;GetWindowThreadProcessId(window,out owner);if(owner==pid){Rectangle bounds;GetWindowRect(window,out bounds);value.windows.Add(new OwnedWindow{desktopName=name,hwnd=window.ToInt64(),visible=IsWindowVisible(window),minimized=IsIconic(window),bounds=bounds});}return true;},IntPtr.Zero);
          int error=Marshal.GetLastWin32Error();if(!result&&error!=0)value.failures.Add("EnumDesktopWindows:"+error);
        } finally { CloseDesktop(desktop); }
      }
      int monitors=0;EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,delegate(IntPtr monitor,IntPtr dc,ref Rectangle bounds,IntPtr argument){monitors++;return true;},IntPtr.Zero);
      value.display=new DisplayObservation{width=GetSystemMetrics(0),height=GetSystemMetrics(1),virtualLeft=GetSystemMetrics(76),virtualTop=GetSystemMetrics(77),virtualWidth=GetSystemMetrics(78),virtualHeight=GetSystemMetrics(79),monitorCount=monitors,stationVisible=StationVisible()};
      return value;
    }
    public void Dispose(){if(process!=IntPtr.Zero){CloseHandle(process);process=IntPtr.Zero;}}
  }
  public static AppWatch WatchApp(int pid,string desktopPath) { return new AppWatch(pid,desktopPath); }

  public sealed class NativeFailure : Win32Exception {
    public string Call { get; private set; }
    public NativeFailure(string call, int error) : base(error, "READINESS_NATIVE_FAILED:"+call+":"+error) { Call=call; }
  }
  static IntPtr RequireHandle(IntPtr value, string call) {
    if(value==IntPtr.Zero) throw new NativeFailure(call,Marshal.GetLastWin32Error());
    return value;
  }
  static string Name(IntPtr handle) {
    IntPtr data=Marshal.AllocHGlobal(1024);
    try {
      uint needed;
      if(!GetUserObjectInformationW(handle,2,data,1024,out needed)) throw new NativeFailure("GetUserObjectInformationW",Marshal.GetLastWin32Error());
      return Marshal.PtrToStringUni(data);
    } finally { Marshal.FreeHGlobal(data); }
  }
  static string AppDesktopName(int pid) {
    using(var app=Process.GetProcessById(pid)) {
      if(app.SessionId!=Process.GetCurrentProcess().SessionId) throw new InvalidOperationException("READINESS_APP_SESSION_MISMATCH");
      foreach(ProcessThread thread in app.Threads) {
        using(thread) return Name(RequireHandle(GetThreadDesktop((uint)thread.Id),"GetThreadDesktop"));
      }
    }
    throw new InvalidOperationException("READINESS_APP_THREAD_MISSING");
  }
  public static Desktop OpenOwned(int pid, string launcherPath) {
    string station=Name(RequireHandle(GetProcessWindowStation(),"GetProcessWindowStation"));
    string desktop;
    bool fromLauncher=!String.IsNullOrEmpty(launcherPath);
    if(fromLauncher) {
      string[] parts=launcherPath.Split('\\');
      if(parts.Length!=2||parts[0].Length==0||parts[1].Length==0) throw new InvalidOperationException("READINESS_DESKTOP_PATH_INVALID");
      if(!String.Equals(parts[0],station,StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("READINESS_STATION_MISMATCH");
      desktop=parts[1];
    } else { desktop=AppDesktopName(pid); }
    // READOBJECTS (0x1) is required by EnumDesktopWindows; ENUMERATE (0x40)
    // is explicit too. No write right, ACL edit or input-desktop selection.
    IntPtr opened=RequireHandle(OpenDesktopW(desktop,0,false,0x41),"OpenDesktopW");
    try {
      if(!String.Equals(Name(opened),desktop,StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("READINESS_DESKTOP_IDENTITY_CHANGED");
      string probe=Name(RequireHandle(GetThreadDesktop(GetCurrentThreadId()),"GetThreadDesktop"));
      return new Desktop(opened,fromLauncher?"owned-launcher":"owned-process-thread",String.Equals(probe,desktop,StringComparison.OrdinalIgnoreCase));
    } catch { CloseDesktop(opened); throw; }
  }
  public sealed class Desktop : IDisposable {
    IntPtr handle;
    public string Source { get; private set; }
    public bool ProbeDesktopMatches { get; private set; }
    public bool EnumerationReturned { get; private set; }
    public int EnumerationError { get; private set; }
    public int Callbacks { get; private set; }
    internal Desktop(IntPtr desktop,string source,bool matches) { handle=desktop;Source=source;ProbeDesktopMatches=matches; }
    public IntPtr[] FindOwned(int pid) {
      var found=new List<IntPtr>();
      Callbacks=0;
      // Win32 leaves last error unchanged on an empty desktop. Distinguish
      // false+0+no callbacks from errors, never from an uninitialised stale code.
      ClearLastError(0);
      bool returned=EnumDesktopWindows(handle,delegate(IntPtr window,IntPtr argument) {
        Callbacks++;
        uint owner;GetWindowThreadProcessId(window,out owner);
        if(owner==pid) {
          var title=new StringBuilder(256);GetWindowTextW(window,title,title.Capacity);
          if(title.ToString()=="SocialPrune") found.Add(window);
        }
        return true;
      },IntPtr.Zero);
      int error=Marshal.GetLastWin32Error();
      EnumerationReturned=returned;EnumerationError=error;
      if(!returned&&(error!=0||Callbacks!=0)) throw new NativeFailure("EnumDesktopWindows",error);
      return found.ToArray();
    }
    public void Dispose() {
      if(handle==IntPtr.Zero)return;
      IntPtr owned=handle;handle=IntPtr.Zero;
      if(!CloseDesktop(owned))throw new NativeFailure("CloseDesktop",Marshal.GetLastWin32Error());
    }
  }

  public static bool StationVisible() {
    IntPtr data = Marshal.AllocHGlobal(12);
    try {
      uint needed;
      if (!GetUserObjectInformationW(RequireHandle(GetProcessWindowStation(),"GetProcessWindowStation"), 1, data, 12, out needed))
        throw new NativeFailure("GetUserObjectInformationW",Marshal.GetLastWin32Error());
      return (Marshal.ReadInt32(data, 8) & 1) != 0;
    } finally { Marshal.FreeHGlobal(data); }
  }
}
