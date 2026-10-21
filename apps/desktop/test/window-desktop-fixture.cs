// Synthetic native windows on two disposable desktops, never an input desktop.
public static class WindowDesktopFixture {
  [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)] static extern System.IntPtr CreateDesktopW(string name,System.IntPtr device,System.IntPtr mode,uint flags,uint access,System.IntPtr attributes);
  [System.Runtime.InteropServices.DllImport("user32.dll",SetLastError=true)] static extern bool SetThreadDesktop(System.IntPtr desktop);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool CloseDesktop(System.IntPtr desktop);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr GetProcessWindowStation();
  [System.Runtime.InteropServices.DllImport("user32.dll",SetLastError=true)] static extern bool GetUserObjectInformationW(System.IntPtr handle,int kind,System.IntPtr value,uint size,out uint needed);
  [System.Runtime.InteropServices.DllImport("kernel32.dll",EntryPoint="SetLastError")] static extern void NativeSetLastError(uint error);
  [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)] static extern System.IntPtr CreateWindowExW(uint extended,string kind,string title,uint style,int x,int y,int width,int height,System.IntPtr parent,System.IntPtr menu,System.IntPtr instance,System.IntPtr parameter);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool DestroyWindow(System.IntPtr window);
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct Message { public System.IntPtr hwnd;public uint message;public System.UIntPtr wparam;public System.IntPtr lparam;public uint time;public int x,y; }
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool PeekMessageW(out Message message,System.IntPtr window,uint first,uint last,uint remove);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr DispatchMessageW(ref Message message);
  delegate bool WindowCallback(System.IntPtr window,System.IntPtr argument);
  [System.Runtime.InteropServices.DllImport("user32.dll",SetLastError=true)] static extern bool EnumDesktopWindows(System.IntPtr desktop,WindowCallback callback,System.IntPtr argument);
  static string StationName() {
    System.IntPtr data=System.Runtime.InteropServices.Marshal.AllocHGlobal(1024);
    try { uint needed;if(!GetUserObjectInformationW(GetProcessWindowStation(),2,data,1024,out needed))throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error());return System.Runtime.InteropServices.Marshal.PtrToStringUni(data); }
    finally { System.Runtime.InteropServices.Marshal.FreeHGlobal(data); }
  }
  public static string Run() {
    string appName="SocialPrune-test-"+System.Guid.NewGuid().ToString(),probeName="SocialPrune-test-"+System.Guid.NewGuid().ToString(),station=StationName();
    System.IntPtr app=CreateDesktopW(appName,System.IntPtr.Zero,System.IntPtr.Zero,0,0xF01FF,System.IntPtr.Zero),probe=CreateDesktopW(probeName,System.IntPtr.Zero,System.IntPtr.Zero,0,0xF01FF,System.IntPtr.Zero);
    if(app==System.IntPtr.Zero||probe==System.IntPtr.Zero)throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error());
    var ready=new System.Threading.ManualResetEventSlim();var stop=new System.Threading.ManualResetEventSlim();
    System.Exception appFailure=null; System.Threading.Thread appThread=null;
    try {
      int pid=System.Diagnostics.Process.GetCurrentProcess().Id;
      NativeSetLastError(0);int oldCallbacks=0;
      bool legacy=EnumDesktopWindows(app,delegate(System.IntPtr h,System.IntPtr a){oldCallbacks++;return true;},System.IntPtr.Zero);
      int oldError=System.Runtime.InteropServices.Marshal.GetLastWin32Error();
      if(legacy||oldError!=0||oldCallbacks!=0)throw new System.Exception("EMPTY_DESKTOP_PROBE_CHANGED");
      bool emptyReturned;int emptyError;
      using(var selected=ReadinessWindows.OpenOwned(pid,station+"\\"+appName)) {
        NativeSetLastError(5);
        emptyReturned=selected.FindOwned(pid).Length==0;
        emptyError=selected.EnumerationError;
        if(selected.EnumerationReturned||emptyError!=0||selected.Callbacks!=0)throw new System.Exception("EMPTY_ENUMERATION_NOT_RECORDED");
      }
      string enumerationCall=null;int enumerationError=-1;
      // Invalid native input exercises the nonzero-error branch without ACL
      // edits or relying on an elevated parent's access-denial precondition.
      var invalidHandle=new ReadinessWindows.Desktop(new System.IntPtr(0x12345678),"owned-fixture",false);
      try { invalidHandle.FindOwned(pid); }
      catch(ReadinessWindows.NativeFailure failure){enumerationCall=failure.Call;enumerationError=failure.NativeErrorCode;}
      appThread=new System.Threading.Thread(()=>{
        System.IntPtr window=System.IntPtr.Zero;
        try {
          if(!SetThreadDesktop(app))throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error());
          window=CreateWindowExW(0,"STATIC","SocialPrune",0,0,0,100,100,System.IntPtr.Zero,System.IntPtr.Zero,System.IntPtr.Zero,System.IntPtr.Zero);
          if(window==System.IntPtr.Zero)throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error());
          ready.Set();
          // GetWindowTextW sends WM_GETTEXT for a same-process window. Its
          // owning thread must dispatch messages while the other thread probes.
          while(!stop.Wait(10)) { Message message;while(PeekMessageW(out message,System.IntPtr.Zero,0,0,1)){TranslateMessage(ref message);DispatchMessageW(ref message);} }
        }catch(System.Exception error){appFailure=error;ready.Set();}
        finally { if(window!=System.IntPtr.Zero)DestroyWindow(window); }
      });
      appThread.Start();ready.Wait();if(appFailure!=null)throw appFailure;
      bool found=false,matched=true;System.Exception probeFailure=null;
      var probeThread=new System.Threading.Thread(()=>{
        try {
          if(!SetThreadDesktop(probe))throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error());
          using(var selected=ReadinessWindows.OpenOwned(pid,station+"\\"+appName)){found=selected.FindOwned(pid).Length==1;matched=selected.ProbeDesktopMatches;}
        }catch(System.Exception error){probeFailure=error;}
      });
      probeThread.Start();probeThread.Join();if(probeFailure!=null)throw probeFailure;
      string invalidCall=null;int invalidError=-1;
      try { using(var absent=ReadinessWindows.OpenOwned(pid,station+"\\SocialPrune-test-"+System.Guid.NewGuid().ToString())){} }
      catch(ReadinessWindows.NativeFailure failure){invalidCall=failure.Call;invalidError=failure.NativeErrorCode;}
      return "{\"legacyEmptyReturned\":"+legacy.ToString().ToLowerInvariant()+",\"legacyError\":"+oldError+",\"legacyCallbacks\":"+oldCallbacks+",\"emptyReturned\":"+emptyReturned.ToString().ToLowerInvariant()+",\"emptyError\":"+emptyError+",\"enumerationCall\":\""+enumerationCall+"\",\"enumerationError\":"+enumerationError+",\"wrongThreadFoundOwnedWindow\":"+found.ToString().ToLowerInvariant()+",\"probeDesktopMatches\":"+matched.ToString().ToLowerInvariant()+",\"invalidCall\":\""+invalidCall+"\",\"invalidError\":"+invalidError+"}";
    } finally {
      stop.Set();if(appThread!=null)appThread.Join();stop.Dispose();ready.Dispose();CloseDesktop(probe);CloseDesktop(app);
    }
  }
}
