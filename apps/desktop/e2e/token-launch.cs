// Diagnostic only. The baseline creation order mirrors limited-token.ps1.
public static class TokenLaunch {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved,desktop,title; public int x,y,cx,cy,xchars,ychars,fill,flags;
    public short show,reserved2; public IntPtr bytes,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct Info { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct SidEntry { public IntPtr sid; public uint attributes; }
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long a,b; public uint flags; public UIntPtr c,d; public uint e; public UIntPtr f; public uint g,h; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public Basic basic; public Io io; public UIntPtr a,b,c,d; }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CreateWellKnownSid(int kind,IntPtr domain,IntPtr sid,ref uint size);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr token,uint flags,uint count,ref SidEntry deny,uint dc,IntPtr dp,uint rc,IntPtr rs,out IntPtr limited);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool DuplicateToken(IntPtr token,int level,out IntPtr impersonation);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool CheckTokenMembership(IntPtr token,IntPtr sid,out bool member);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSidToSidW(string text,out IntPtr sid);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetTokenInformation(IntPtr token,int kind,ref SidEntry value,uint size);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessAsUserW(IntPtr token,string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup start,out Info info);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup start,out Info info);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr a,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j,int kind,ref Limits value,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr p,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr p,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  public static string DesktopEvidence="null";
  static void Check(bool value,string call) { if(!value) { int code=Marshal.GetLastWin32Error(); throw new Win32Exception(code,"TOKEN_LAUNCH:"+call+":"+code); } }
  static string Quote(string value) {
    var text=new StringBuilder("\"");int slashes=0;
    foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){text.Append('\\',slashes*2+1);text.Append('"');}else{text.Append('\\',slashes);text.Append(c);}slashes=0;}
    text.Append('\\',slashes*2);return text.Append('"').ToString();
  }
  static void Record(string receipt,string fields) {
    File.AppendAllText(receipt,"{\"version\":1,\"diagnosticOnly\":true,\"acceptance\":false,"+fields+"}\n",new UTF8Encoding(false));
  }
  static int Remaining(long deadline) { long value=deadline-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();if(value<=0)throw new Exception("DIAGNOSE_WORK_DEADLINE");return (int)Math.Min(value,Int32.MaxValue); }
  static uint WaitUntilExit(IntPtr process,long deadline) {
    uint waited;
    do { waited=WaitForSingleObject(process,(uint)Remaining(deadline)); }
    while(waited==258 && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()<deadline);
    return waited;
  }
  static uint Start(IntPtr token,IntPtr job,string exe,string[] args,string desktop,long deadline,string receipt) {
    Info child=new Info();var command=new StringBuilder(Quote(exe));foreach(string arg in args)command.Append(' ').Append(Quote(arg));
    var startup=new Startup{cb=Marshal.SizeOf(typeof(Startup)),desktop=desktop,flags=0x100,input=GetStdHandle(-10),output=GetStdHandle(-11),error=GetStdHandle(-12)};
    Remaining(deadline);
    Check(token==IntPtr.Zero?CreateProcessW(exe,command,IntPtr.Zero,IntPtr.Zero,true,4,IntPtr.Zero,Environment.CurrentDirectory,ref startup,out child):CreateProcessAsUserW(token,exe,command,IntPtr.Zero,IntPtr.Zero,true,4,IntPtr.Zero,Environment.CurrentDirectory,ref startup,out child),"CreateSuspendedChild");
    try {
      Check(AssignProcessToJobObject(job,child.process),"AssignOwnedJob");
      Remaining(deadline);Check(ResumeThread(child.thread)!=0xffffffff,"ResumeChild");
      Record(receipt,"\"event\":\"child-start\",\"pid\":"+child.pid);
      uint waited=WaitUntilExit(child.process,deadline);
      if(waited!=0){Record(receipt,"\"event\":\"deadline\",\"state\":\"timeout\",\"pid\":"+child.pid);throw new Exception("DIAGNOSE_WORK_DEADLINE");}
      uint code;Check(GetExitCodeProcess(child.process,out code),"ChildExit");Record(receipt,"\"event\":\"child-return\",\"exitCode\":"+code);return code;
    } finally { if(WaitForSingleObject(child.process,0)!=0){TerminateProcess(child.process,75);WaitForSingleObject(child.process,5000);}CloseHandle(child.thread);CloseHandle(child.process); }
  }
  public static uint Run(string mode,string executable,string[] args,string probe,string scratch,long deadline) {
    IntPtr token=IntPtr.Zero,limited=IntPtr.Zero,imp=IntPtr.Zero,medium=IntPtr.Zero,job=IntPtr.Zero;
    IntPtr admins=Marshal.AllocHGlobal(68);LimitedDesktop owned=null;string receipt=System.IO.Path.Combine(scratch,"release-token-launch.ndjson");
    bool normal=mode=="unrestricted-owned";uint flags=mode=="token-E-no-lua"?1u:5u;
    try {
      Record(receipt,"\"event\":\"begin\",\"flags\":"+flags+",\"normal\":"+normal.ToString().ToLowerInvariant()+",\"profileLoaded\":false");
      Check(OpenProcessToken(GetCurrentProcess(),0x02000000,out token),"OpenProcessToken");
      IntPtr selected=token;
      if(!normal) {
        uint size=68;Check(CreateWellKnownSid(26,IntPtr.Zero,admins,ref size),"AdministratorsSid");
        var deny=new SidEntry{sid=admins};Check(CreateRestrictedToken(token,flags,1,ref deny,0,IntPtr.Zero,0,IntPtr.Zero,out limited),"CreateRestrictedToken");
        Check(ConvertStringSidToSidW("S-1-16-8192",out medium),"MediumSid");var integrity=new SidEntry{sid=medium,attributes=0x20};
        Check(SetTokenInformation(limited,25,ref integrity,(uint)(Marshal.SizeOf(typeof(SidEntry))+12)),"SetMediumIntegrity");selected=limited;
      }
      job=CreateJobObjectW(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"CreateOwnedJob");var limits=new Limits{basic=new Basic{flags=0x2000}};
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))),"SetKillOnClose");
      Check(SetHandleInformation(selected,1,1),"InheritDerivedForOwnerProbe");
      string mutation=mode=="token-B-default-dacl"?"B":mode=="token-C-object-dacl"?"C":mode=="token-D-object-label"?"D":"none";
      uint ownerCode;
      try {ownerCode=Start(IntPtr.Zero,job,probe,new[]{"owner",System.IO.Path.Combine(scratch,"release-token-owner.ndjson"),selected.ToInt64().ToString(),mutation},null,deadline,receipt);}
      finally {Check(SetHandleInformation(selected,1,0),"ClearDerivedInheritance");}
      if(ownerCode==3){Record(receipt,"\"event\":\"variant\",\"state\":\"not-applicable\"");return 3;}
      if(ownerCode!=0)throw new Exception("TOKEN_OWNER_PROBE_FAILED");
      Check(DuplicateToken(selected,2,out imp),"DuplicateToken");
      if(!normal){bool member;Check(CheckTokenMembership(imp,admins,out member),"CheckTokenMembership");if(member)throw new Exception("LIMITED_TOKEN_STILL_ADMIN");}
      owned=new LimitedDesktop(selected,imp);DesktopEvidence=owned.Evidence();
      Record(receipt,"\"event\":\"desktop\",\"effective\":"+DesktopEvidence);
      uint probeCode=Start(normal?IntPtr.Zero:selected,job,probe,new[]{"helper",System.IO.Path.Combine(scratch,"release-token-helper.ndjson"),"0","none"},owned.Path,deadline,receipt);
      if(probeCode!=0)throw new Exception("TOKEN_RESTRICTED_PROBE_FAILED");
      if(mode=="token-chain")return 0;
      return Start(normal?IntPtr.Zero:selected,job,executable,args,owned.Path,deadline,receipt);
    } finally {
      if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}
      foreach(IntPtr h in new[]{imp,limited,token})if(h!=IntPtr.Zero)CloseHandle(h);
      if(owned!=null)owned.Dispose();if(medium!=IntPtr.Zero)LocalFree(medium);Marshal.FreeHGlobal(admins);
      Record(receipt,"\"event\":\"settled\",\"ownedJobClosed\":true");
    }
  }
}
