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
