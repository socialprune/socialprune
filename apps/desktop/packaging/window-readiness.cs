using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

// Harness only. UIA RootElement omits windows on a noninteractive station.
// Enumerate only this thread's desktop, then bind UIA to the owned PID's HWND.
public static class ReadinessWindows {
  delegate bool WindowCallback(IntPtr window, IntPtr argument);
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll", SetLastError=true)] static extern bool EnumDesktopWindows(IntPtr desktop, WindowCallback callback, IntPtr argument);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder value, int count);
  [DllImport("user32.dll", SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr handle, int kind, IntPtr value, uint size, out uint needed);

  public static IntPtr[] FindOwned(int pid) {
    var found = new List<IntPtr>();
    if (!EnumDesktopWindows(GetThreadDesktop(GetCurrentThreadId()), delegate(IntPtr window, IntPtr argument) {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner == pid) {
        var title = new StringBuilder(256);
        GetWindowTextW(window, title, title.Capacity);
        if (title.ToString() == "SocialPrune") found.Add(window);
      }
      return true;
    }, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error(), "READINESS_DESKTOP_ENUMERATION_FAILED");
    return found.ToArray();
  }

  public static bool StationVisible() {
    IntPtr data = Marshal.AllocHGlobal(12);
    try {
      uint needed;
      if (!GetUserObjectInformationW(GetProcessWindowStation(), 1, data, 12, out needed))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "READINESS_STATION_FLAGS_FAILED");
      return (Marshal.ReadInt32(data, 8) & 1) != 0;
    } finally { Marshal.FreeHGlobal(data); }
  }
}
