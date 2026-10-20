// Harness only. Never grant access on an existing window object. The runner's
// elevated parent can create a private station; a normal desktop parent uses
// its current station only after checking the restricted token can access it.
public sealed class LimitedDesktop : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int size; public IntPtr sd; public int inherit; }
  [StructLayout(LayoutKind.Sequential)] struct Sid { public IntPtr sid; public uint attributes; }
  [StructLayout(LayoutKind.Sequential)] struct Mapping { public uint read,write,execute,all; }
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll",SetLastError=true)] static extern bool SetProcessWindowStation(IntPtr station);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateWindowStationW(string name,uint flags,uint access,ref SA attributes);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenWindowStationW(string name,bool inherit,uint access);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenDesktopW(string name,uint flags,bool inherit,uint access);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateDesktopW(string name,IntPtr device,IntPtr mode,uint flags,uint access,ref SA attributes);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr obj,int kind,IntPtr data,uint size,out uint needed);
  [DllImport("user32.dll",SetLastError=true)] static extern bool GetUserObjectSecurity(IntPtr obj,ref uint info,IntPtr sd,uint size,out uint needed);
  [DllImport("user32.dll",SetLastError=true)] static extern bool SetUserObjectSecurity(IntPtr obj,ref uint info,IntPtr sd);
  [DllImport("user32.dll",SetLastError=true)] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll",SetLastError=true)] static extern bool CloseWindowStation(IntPtr station);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text,uint revision,out IntPtr sd,out uint size);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr data,uint size,out uint needed);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool AccessCheck(IntPtr sd,IntPtr token,uint desired,ref Mapping mapping,IntPtr privileges,ref uint size,out uint granted,out bool allowed);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  IntPtr original,station,desktop,descriptor;
  public string Path { get; private set; }
  public IntPtr DesktopHandle { get { return desktop; } }
  public bool OwnStation { get { return station!=IntPtr.Zero; } }
  public int RestrictingSidCount { get; private set; }
  public bool AccessVerified { get; private set; }
  public bool ObjectsClosed { get; private set; }
  bool inheritedStationAccess,inheritedDesktopAccess;
  bool previousTargetStationAccess,previousTargetDesktopAccess,hasRestrictions,mediumIntegrityVerified;
  uint inheritedHeapKb,ownedHeapKb;
  static uint Heap(IntPtr handle) {IntPtr data=Marshal.AllocHGlobal(4);try{uint needed;if(!GetUserObjectInformationW(handle,5,data,4,out needed))return 0;return unchecked((uint)Marshal.ReadInt32(data));}finally{Marshal.FreeHGlobal(data);}}
  static void Require(bool value,string name) { if(!value) { int code=Marshal.GetLastWin32Error();throw new Win32Exception(code,name+":"+code); } }
  static IntPtr TokenData(IntPtr token,int kind) {
    uint size;GetTokenInformation(token,kind,IntPtr.Zero,0,out size);
    if(size==0) throw new Win32Exception(Marshal.GetLastWin32Error(),"DESKTOP_TOKEN_SIZE");
    IntPtr data=Marshal.AllocHGlobal((int)size);
    try {Require(GetTokenInformation(token,kind,data,size,out size),"DESKTOP_TOKEN_READ");return data;}catch{Marshal.FreeHGlobal(data);throw;}
  }
  static string Name(IntPtr handle) {
    uint size;GetUserObjectInformationW(handle,2,IntPtr.Zero,0,out size);IntPtr data=Marshal.AllocHGlobal((int)size);
    try {Require(GetUserObjectInformationW(handle,2,data,size,out size),"DESKTOP_OBJECT_NAME");return Marshal.PtrToStringUni(data);}finally{Marshal.FreeHGlobal(data);}
  }
  static void Check(IntPtr handle,IntPtr impersonation,bool isStation) {
    uint info=7,size;GetUserObjectSecurity(handle,ref info,IntPtr.Zero,0,out size);IntPtr data=Marshal.AllocHGlobal((int)size),privileges=Marshal.AllocHGlobal(4096);
    try {
      Require(GetUserObjectSecurity(handle,ref info,data,size,out size),"DESKTOP_SECURITY_READ");
      var map=new Mapping {read=0x20000,write=0x20000,execute=0x20000,all=isStation?0xF037Fu:0xF01FFu};
      uint bytes=4096,granted;bool allowed;Require(AccessCheck(data,impersonation,isStation?0x37Fu:0x1FFu,ref map,privileges,ref bytes,out granted,out allowed),"DESKTOP_ACCESS_CHECK");
      if(!allowed) throw new Exception(isStation?"RESTRICTED_STATION_ACCESS_DENIED":"RESTRICTED_DESKTOP_ACCESS_DENIED");
    } finally {Marshal.FreeHGlobal(data);Marshal.FreeHGlobal(privileges);}
  }
  public LimitedDesktop(IntPtr token,IntPtr impersonation) {
    original=GetProcessWindowStation();
    IntPtr inherited=GetThreadDesktop(GetCurrentThreadId());
    try {Check(original,impersonation,true);inheritedStationAccess=true;}catch {inheritedStationAccess=false;}
    try {Check(inherited,impersonation,false);inheritedDesktopAccess=true;}catch {inheritedDesktopAccess=false;}
    inheritedHeapKb=Heap(inherited);
    try {
      var principals=new HashSet<string>();
      IntPtr user=TokenData(token,1);string owner;
      try {owner=new SecurityIdentifier(Marshal.PtrToStructure<Sid>(user).sid).Value;principals.Add(owner);}finally{Marshal.FreeHGlobal(user);}
      IntPtr restrictions=TokenData(token,21),integrity=TokenData(token,25);
      try {hasRestrictions=Marshal.ReadInt32(restrictions)!=0;mediumIntegrityVerified=new SecurityIdentifier(Marshal.PtrToStructure<Sid>(integrity).sid).Value=="S-1-16-8192";}
      finally{Marshal.FreeHGlobal(restrictions);Marshal.FreeHGlobal(integrity);}
      if(!hasRestrictions||!mediumIntegrityVerified)throw new Exception("LIMITED_DESKTOP_TOKEN_INVARIANT");
      // Read-only access check of the OLD hardcoded target. The runner is a
      // service, so its current station need not be that interactive target.
      IntPtr previousStation=OpenWindowStationW("winsta0",false,0xF037F),previousDesktop=IntPtr.Zero;
      try {
        if(previousStation!=IntPtr.Zero) {
          try {Check(previousStation,impersonation,true);previousTargetStationAccess=true;}catch{previousTargetStationAccess=false;}
          if(SetProcessWindowStation(previousStation)) {
            try {previousDesktop=OpenDesktopW("default",0,false,0xF01FF);if(previousDesktop!=IntPtr.Zero){try{Check(previousDesktop,impersonation,false);previousTargetDesktopAccess=true;}catch{previousTargetDesktopAccess=false;}}}
            finally{Require(SetProcessWindowStation(original),"RESTORE_AFTER_PREVIOUS_TARGET_READ");}
          }
        }
      } finally {if(previousDesktop!=IntPtr.Zero)CloseDesktop(previousDesktop);if(previousStation!=IntPtr.Zero)CloseWindowStation(previousStation);}
      foreach(int kind in new int[]{2,11}) {
        IntPtr data=TokenData(token,kind);
        try {
          int count=Marshal.ReadInt32(data),offset=IntPtr.Size;int stride=Marshal.SizeOf(typeof(Sid));
          if(kind==11) RestrictingSidCount=count;
          for(int i=0;i<count;i++) {
            var entry=Marshal.PtrToStructure<Sid>(IntPtr.Add(data,offset+i*stride));
            if(kind==11 || ((entry.attributes&0xC0000000)==0xC0000000 && (entry.attributes&4)!=0))principals.Add(new SecurityIdentifier(entry.sid).Value);
          }
        }finally{Marshal.FreeHGlobal(data);}
      }
      string sddl="O:"+owner+"D:P(A;;GA;;;SY)";
      foreach(string sid in principals)sddl+="(A;;GA;;;"+sid+")";
      // Objects must remain accessible after an elevated runner drops to medium.
      sddl+="S:(ML;;NW;;;ME)";uint length;
      Require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl,1,out descriptor,out length),"OWNED_DESKTOP_DESCRIPTOR");
      var sa=new SA {size=Marshal.SizeOf(typeof(SA)),sd=descriptor};
      string stationName="SocialPrune-test-"+Guid.NewGuid().ToString(),desktopName="SocialPrune-test-"+Guid.NewGuid().ToString();
      station=CreateWindowStationW(stationName,1,0xF037F,ref sa);
      if(station==IntPtr.Zero) {
        int error=Marshal.GetLastWin32Error();if(error!=5)throw new Win32Exception(error,"CREATE_OWNED_STATION");
        // Non-admins cannot name stations. No fallback may alter its ACL.
        Check(original,impersonation,true);stationName=Name(original);
      } else {Require(SetProcessWindowStation(station),"SELECT_OWNED_STATION");Check(station,impersonation,true);}
      try {desktop=CreateDesktopW(desktopName,IntPtr.Zero,IntPtr.Zero,0,0xF01FF,ref sa);Require(desktop!=IntPtr.Zero,"CREATE_OWNED_DESKTOP");}
      finally {Require(SetProcessWindowStation(original),"RESTORE_ORIGINAL_STATION");}
      Path=stationName+"\\"+desktopName;ownedHeapKb=Heap(desktop);Verify(impersonation);
    } catch {SetProcessWindowStation(original);Dispose();throw;}
  }
  public void Verify(IntPtr impersonation) {Check(station!=IntPtr.Zero?station:original,impersonation,true);Check(desktop,impersonation,false);AccessVerified=true;}
  public void RestoreOwnedAccess(IntPtr impersonation) {
    if(desktop==IntPtr.Zero||descriptor==IntPtr.Zero)throw new Exception("OWNED_DESKTOP_CLOSED");
    uint info=4;Require(SetUserObjectSecurity(desktop,ref info,descriptor),"RESTORE_OWNED_DESKTOP_ACCESS");Verify(impersonation);
  }
  public string Evidence() {return "{\"ownedDesktop\":true,\"ownedStation\":"+OwnStation.ToString().ToLowerInvariant()+",\"restrictedAccessVerified\":"+AccessVerified.ToString().ToLowerInvariant()+",\"hasRestrictions\":"+hasRestrictions.ToString().ToLowerInvariant()+",\"mediumIntegrityVerified\":"+mediumIntegrityVerified.ToString().ToLowerInvariant()+",\"restrictingSidCount\":"+RestrictingSidCount+",\"previousTargetStationAccess\":"+previousTargetStationAccess.ToString().ToLowerInvariant()+",\"previousTargetDesktopAccess\":"+previousTargetDesktopAccess.ToString().ToLowerInvariant()+",\"inheritedStationAccess\":"+inheritedStationAccess.ToString().ToLowerInvariant()+",\"inheritedDesktopAccess\":"+inheritedDesktopAccess.ToString().ToLowerInvariant()+",\"inheritedHeapKb\":"+inheritedHeapKb+",\"ownedHeapKb\":"+ownedHeapKb+",\"environmentNullMeansParent\":true,\"systemRootPresent\":"+(!String.IsNullOrEmpty(Environment.GetEnvironmentVariable("SystemRoot"))).ToString().ToLowerInvariant()+",\"windirPresent\":"+(!String.IsNullOrEmpty(Environment.GetEnvironmentVariable("windir"))).ToString().ToLowerInvariant()+",\"pathExtPresent\":"+(!String.IsNullOrEmpty(Environment.GetEnvironmentVariable("PATHEXT"))).ToString().ToLowerInvariant()+",\"existingDaclChanged\":false}";}
  public void Dispose() {
    if(desktop!=IntPtr.Zero){Require(CloseDesktop(desktop),"CLOSE_OWNED_DESKTOP");desktop=IntPtr.Zero;}
    if(station!=IntPtr.Zero){Require(CloseWindowStation(station),"CLOSE_OWNED_STATION");station=IntPtr.Zero;}
    if(descriptor!=IntPtr.Zero){LocalFree(descriptor);descriptor=IntPtr.Zero;}ObjectsClosed=true;
  }
}
