// Harness-only variants. None are admission criteria or replacements for the
// unchanged restricted proof. Never change an existing station or desktop ACL.
public static partial class LimitedProof {
  [StructLayout(LayoutKind.Sequential)] struct MatrixLuid { public uint low; public int high; }
  [StructLayout(LayoutKind.Sequential)] struct MatrixStats {
    public MatrixLuid tokenId,authenticationId;public long expiration;public int type,level;
    public uint charged,available,groups,privileges;public MatrixLuid modified;
  }
  [StructLayout(LayoutKind.Sequential)] struct MatrixText { public ushort length,maximum;public IntPtr text; }
  [StructLayout(LayoutKind.Sequential)] struct MatrixLogon {
    public uint size;public MatrixLuid id;public MatrixText user,domain,package;public uint type,session;
  }
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr data,uint bytes,out uint needed);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool DuplicateTokenEx(IntPtr token,uint access,IntPtr attributes,int level,int kind,out IntPtr result);
  [DllImport("secur32.dll")] static extern uint LsaGetLogonSessionData(ref MatrixLuid id,out IntPtr data);
  [DllImport("secur32.dll")] static extern uint LsaFreeReturnBuffer(IntPtr data);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int kind,IntPtr data,uint size,out uint needed);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process,IntPtr address,byte[] data,UIntPtr size,out UIntPtr read);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr handle,int kind,IntPtr data,uint size,out uint needed);
  static string MJ(string text) {
    if(text==null)return "null";var result=new StringBuilder("\"");
    foreach(char c in text){switch(c){case '"':result.Append("\\\"");break;case '\\':result.Append("\\\\");break;case '\n':result.Append("\\n");break;case '\r':result.Append("\\r");break;case '\t':result.Append("\\t");break;default:if(c<32)result.Append("\\u"+((int)c).ToString("x4"));else result.Append(c);break;}}
    return result.Append('"').ToString();
  }
  static string MB(bool value){return value?"true":"false";}
  static IntPtr MatrixTokenData(IntPtr token,int kind) {
    uint size;GetTokenInformation(token,kind,IntPtr.Zero,0,out size);
    if(size==0)throw new Win32Exception(Marshal.GetLastWin32Error(),"MatrixTokenSize");
    IntPtr data=Marshal.AllocHGlobal((int)size);
    try{Require(GetTokenInformation(token,kind,data,size,out size),"MatrixTokenRead");return data;}catch{Marshal.FreeHGlobal(data);throw;}
  }
  static int MatrixInt(IntPtr token,int kind){IntPtr data=MatrixTokenData(token,kind);try{return Marshal.ReadInt32(data);}finally{Marshal.FreeHGlobal(data);}}
  static string MatrixSid(IntPtr token,int kind){IntPtr data=MatrixTokenData(token,kind);try{return new SecurityIdentifier(Marshal.PtrToStructure<SidEntry>(data).sid).Value;}finally{Marshal.FreeHGlobal(data);}}
  static string MatrixToken(IntPtr token,string parentSid) {
    string sid=MatrixSid(token,1),integrity=MatrixSid(token,25);bool enabled=false,deny=false;int restricting=0;
    IntPtr groups=MatrixTokenData(token,2),restricted=MatrixTokenData(token,11),stats=MatrixTokenData(token,10),logon=IntPtr.Zero;
    try {
      int count=Marshal.ReadInt32(groups),offset=IntPtr.Size,stride=Marshal.SizeOf(typeof(SidEntry));
      for(int i=0;i<count;i++){var entry=Marshal.PtrToStructure<SidEntry>(IntPtr.Add(groups,offset+i*stride));if(new SecurityIdentifier(entry.sid).Value=="S-1-5-32-544"){enabled=(entry.attributes&4)!=0;deny=(entry.attributes&16)!=0;}}
      restricting=Marshal.ReadInt32(restricted);var statistics=Marshal.PtrToStructure<MatrixStats>(stats);uint status=LsaGetLogonSessionData(ref statistics.authenticationId,out logon);
      string logonType="null";if(status==0 && logon!=IntPtr.Zero)logonType=Marshal.PtrToStructure<MatrixLogon>(logon).type.ToString();
      return "{\"sameUserAsParent\":"+MB(sid==parentSid)+",\"rid500\":"+MB(sid.EndsWith("-500",StringComparison.Ordinal))+",\"elevated\":"+MB(MatrixInt(token,20)!=0)+",\"elevationType\":"+MatrixInt(token,18)+",\"integrity\":"+MJ(integrity)+",\"session\":"+MatrixInt(token,12)+",\"tokenType\":"+MatrixInt(token,8)+",\"hasRestrictions\":"+MB(MatrixInt(token,21)!=0)+",\"restrictingSidCount\":"+restricting+",\"administratorsEnabled\":"+MB(enabled)+",\"administratorsDenyOnly\":"+MB(deny)+",\"logonType\":"+logonType+",\"logonQueryStatus\":"+status+"}";
    } finally {Marshal.FreeHGlobal(groups);Marshal.FreeHGlobal(restricted);Marshal.FreeHGlobal(stats);if(logon!=IntPtr.Zero)LsaFreeReturnBuffer(logon);}
  }
  static string MatrixDesktop(uint thread,string requested) {
    IntPtr desktop=GetThreadDesktop(thread);int error=Marshal.GetLastWin32Error();
    if(desktop==IntPtr.Zero)return "{\"station\":null,\"desktop\":null,\"source\":\"GetThreadDesktop-unavailable\",\"lastErrorNotAuthoritative\":"+error+",\"requested\":"+MJ(requested)+"}";
    uint needed;GetUserObjectInformationW(desktop,2,IntPtr.Zero,0,out needed);IntPtr name=Marshal.AllocHGlobal((int)needed);
    try {
      if(!GetUserObjectInformationW(desktop,2,name,needed,out needed))return "{\"station\":null,\"desktop\":null,\"source\":\"GetUserObjectInformation-unavailable\",\"win32Error\":"+Marshal.GetLastWin32Error()+",\"requested\":"+MJ(requested)+"}";
      string actual=Marshal.PtrToStringUni(name);int separator=requested.LastIndexOf('\\');bool matches=separator>=0 && requested.Substring(separator+1)==actual;
      // A random owned desktop name binds the observed thread desktop to the
      // station where this invocation created it. Never assert a requested
      // desktop is an observed one if the API could not read it.
      return "{\"station\":"+(matches?MJ(requested.Substring(0,separator)):"null")+",\"desktop\":"+MJ(actual)+",\"source\":\"GetThreadDesktop-owned-name-match\",\"ownedNameMatched\":"+MB(matches)+",\"requested\":"+MJ(requested)+"}";
    } finally {Marshal.FreeHGlobal(name);}
  }
  static string MatrixExcerpt(string path) {
    if(!File.Exists(path))return "";
    try{using(var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite)){byte[] bytes=new byte[4096];int count=file.Read(bytes,0,bytes.Length);bool wide=count>=4&&bytes[1]==0&&bytes[3]==0;return (wide?Encoding.Unicode:Encoding.UTF8).GetString(bytes,0,count);}}
    catch(Exception error){return "MATRIX_EXCERPT_READ_FAILED:"+error.GetType().Name;}
  }
  static byte[] MatrixMemory(IntPtr process,long address,int count) {
    byte[] bytes=new byte[count];UIntPtr read;
    Require(ReadProcessMemory(process,new IntPtr(address),bytes,(UIntPtr)count,out read)&&read.ToUInt64()==(ulong)count,"MatrixOwnedMemoryRead");return bytes;
  }
  static long MatrixPointer(byte[] bytes,int offset,bool wide){return wide?BitConverter.ToInt64(bytes,offset):BitConverter.ToUInt32(bytes,offset);}
  static string MatrixAssignedDesktop(IntPtr process) {
    IntPtr data=Marshal.AllocHGlobal(48);uint needed;
    try {
      int status=NtQueryInformationProcess(process,26,data,(uint)IntPtr.Size,out needed);bool wide=true;long peb=0;
      if(status==0){peb=Marshal.ReadIntPtr(data).ToInt64();if(peb!=0)wide=false;}
      if(peb==0){status=NtQueryInformationProcess(process,0,data,48,out needed);if(status!=0)return "{\"station\":null,\"desktop\":null,\"source\":\"owned-PEB-unavailable\",\"ntstatus\":"+status+"}";peb=Marshal.ReadIntPtr(data,IntPtr.Size).ToInt64();}
      long parameters=MatrixPointer(MatrixMemory(process,peb+(wide?0x20:0x10),wide?8:4),0,wide);
      byte[] descriptor=MatrixMemory(process,parameters+(wide?0xc0:0x78),wide?16:8);int size=BitConverter.ToUInt16(descriptor,0);
      if(size>4096)throw new Exception("MATRIX_DESKTOP_STRING_BOUND");
      string name=Encoding.Unicode.GetString(MatrixMemory(process,MatrixPointer(descriptor,wide?8:4,wide),size));int separator=name.LastIndexOf('\\');
      return "{\"station\":"+(separator>=0?MJ(name.Substring(0,separator)):"null")+",\"desktop\":"+MJ(separator>=0?name.Substring(separator+1):name)+",\"source\":\"actual-child-process-parameters\",\"guiConnectionObserved\":false,\"pointerBits\":"+(wide?64:32)+"}";
    } catch(Exception error){return "{\"station\":null,\"desktop\":null,\"source\":\"owned-PEB-read-failed\",\"errorType\":"+MJ(error.GetType().Name)+"}";}
    finally{Marshal.FreeHGlobal(data);}
  }
  public static string MatrixRow(string id,string app,string[] args,string scratch,string variant,uint flags,bool attachJob,uint timeoutMs) {
    var clock=System.Diagnostics.Stopwatch.StartNew();IntPtr parent=IntPtr.Zero,baseline=IntPtr.Zero,chosen=IntPtr.Zero,impersonation=IntPtr.Zero,medium=IntPtr.Zero,job=IntPtr.Zero,childToken=IntPtr.Zero;
    IntPtr admins=Marshal.AllocHGlobal(68);uint size=68;LimitedDesktop desktop=null;ProcessInfo child=new ProcessInfo();
    string parentEvidence="null",childEvidence="null",desktopEvidence="null",state="failed",exit="null",failure="null",cleanupFailure="null",start="null",assignedDesktop="null";
    string stderr=Path.Combine(scratch,id+".stderr"),stdout=Path.Combine(scratch,id+".stdout");bool assigned=false,inJob=false,weaker=variant!="restricted"||!attachJob,timedOut=false;
    try {
      Require(OpenProcessToken(GetCurrentProcess(),0x02000000,out parent),"MatrixParentToken");string parentSid=MatrixSid(parent,1);parentEvidence=MatrixToken(parent,parentSid);
      if(String.IsNullOrEmpty(app)||!File.Exists(app)){state="absent";return MatrixResult(id,state,variant,flags,attachJob,assigned,inJob,weaker,timedOut,parentEvidence,childEvidence,desktopEvidence,start,assignedDesktop,exit,clock.ElapsedMilliseconds,failure,cleanupFailure,"","");}
      Require(CreateWellKnownSid(26,IntPtr.Zero,admins,ref size),"MatrixAdministratorsSid");var disable=new SidEntry{sid=admins};
      Require(CreateRestrictedToken(parent,1|4,1,ref disable,0,IntPtr.Zero,0,IntPtr.Zero,out baseline),"MatrixBaselineToken");
      Require(ConvertStringSidToSidW("S-1-16-8192",out medium),"MatrixMediumSid");var integrity=new SidEntry{sid=medium,attributes=0x20};
      Require(SetTokenInformation(baseline,25,ref integrity,(uint)(Marshal.SizeOf(typeof(SidEntry))+12)),"MatrixBaselineMedium");
      Require(DuplicateToken(baseline,2,out impersonation),"MatrixImpersonation");desktop=new LimitedDesktop(baseline,impersonation);
      if(variant=="restricted")chosen=baseline;
      else if(variant=="no-lua-medium") {
        Require(CreateRestrictedToken(parent,1,1,ref disable,0,IntPtr.Zero,0,IntPtr.Zero,out chosen),"MatrixNoLuaToken");
        Require(SetTokenInformation(chosen,25,ref integrity,(uint)(Marshal.SizeOf(typeof(SidEntry))+12)),"MatrixNoLuaMedium");
      } else if(variant=="parent-full")Require(DuplicateTokenEx(parent,0x02000000,IntPtr.Zero,2,1,out chosen),"MatrixParentDuplicate");
      else throw new Exception("MATRIX_UNKNOWN_TOKEN");
      if(attachJob){job=CreateJobObjectW(IntPtr.Zero,null);Require(job!=IntPtr.Zero,"MatrixOwnedJob");var limits=new JobLimits{basic=new BasicLimits{flags=0x2000}};Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(JobLimits))),"MatrixKillOnClose");}
      using(var output=new FileStream(stdout,FileMode.Create,FileAccess.Write,FileShare.ReadWrite))
      using(var errors=new FileStream(stderr,FileMode.Create,FileAccess.Write,FileShare.ReadWrite)) {
        var startup=new Startup{cb=Marshal.SizeOf(typeof(Startup)),desktop=desktop.Path,flags=0x100,input=GetStdHandle(-10),output=output.SafeFileHandle.DangerousGetHandle(),error=errors.SafeFileHandle.DangerousGetHandle()};
        Require(SetHandleInformation(startup.output,1,1),"MatrixInheritOutput");Require(SetHandleInformation(startup.error,1,1),"MatrixInheritError");
        var command=new StringBuilder(Quote(app));
        // cmd interprets the remainder after /c itself, not CommandLineToArgvW.
        if(id=="a-cmd-ver")command.Append(" /d /c ver");
        else foreach(string arg in args)command.Append(" ").Append(Quote(arg));
        Require(CreateProcessAsUserW(chosen,app,command,IntPtr.Zero,IntPtr.Zero,true,4|flags,IntPtr.Zero,Environment.CurrentDirectory,ref startup,out child),"MatrixCreateSuspendedChild");
        Require(OpenProcessToken(child.process,8,out childToken),"MatrixActualChildToken");childEvidence=MatrixToken(childToken,parentSid);
        assignedDesktop=MatrixAssignedDesktop(child.process);
        if(attachJob){Require(AssignProcessToJobObject(job,child.process),"MatrixAssignOwnedJob");assigned=true;}
        Require(IsProcessInJob(child.process,IntPtr.Zero,out inJob),"MatrixActualJob");
        start=MatrixDesktop(child.tid,desktop.Path);Require(ResumeThread(child.thread)!=0xffffffff,"MatrixResume");
        uint waited=WaitForSingleObject(child.process,timeoutMs);
        if(waited==258){timedOut=true;state="timeout";Require(TerminateProcess(child.process,124),"MatrixTerminateOwnedTimeout");WaitForSingleObject(child.process,5000);}
        else {Require(waited==0,"MatrixWait");state="exited";}
        desktopEvidence=MatrixDesktop(child.tid,desktop.Path);
        uint code;Require(GetExitCodeProcess(child.process,out code),"MatrixChildExit");exit=code.ToString();
      }
    } catch(Exception error) {state="failed";var native=error as Win32Exception;failure="{\"type\":"+MJ(error.GetType().Name)+",\"operation\":"+(native==null?"null":MJ(native.Message))+",\"win32Error\":"+(native==null?"null":native.NativeErrorCode.ToString())+"}";}
    finally {
      if(child.process!=IntPtr.Zero){uint code;if(GetExitCodeProcess(child.process,out code)&&code==259){TerminateProcess(child.process,125);WaitForSingleObject(child.process,5000);}}
      if(job!=IntPtr.Zero)CloseHandle(job);
      foreach(IntPtr handle in new IntPtr[]{childToken,child.thread,child.process,impersonation})if(handle!=IntPtr.Zero)CloseHandle(handle);
      if(chosen!=IntPtr.Zero&&chosen!=baseline)CloseHandle(chosen);if(baseline!=IntPtr.Zero)CloseHandle(baseline);if(parent!=IntPtr.Zero)CloseHandle(parent);
      if(desktop!=null){try{desktop.Dispose();}catch(Exception error){cleanupFailure=MJ(error.GetType().Name);}}
      if(medium!=IntPtr.Zero)LocalFree(medium);Marshal.FreeHGlobal(admins);
    }
    return MatrixResult(id,state,variant,flags,attachJob,assigned,inJob,weaker,timedOut,parentEvidence,childEvidence,desktopEvidence,start,assignedDesktop,exit,clock.ElapsedMilliseconds,failure,cleanupFailure,MatrixExcerpt(stderr),MatrixExcerpt(stdout));
  }
  static string MatrixResult(string id,string state,string variant,uint flags,bool requestedJob,bool assigned,bool inJob,bool weaker,bool timedOut,string parent,string child,string desktop,string atStart,string assignedDesktop,string exit,long duration,string failure,string cleanup,string stderr,string stdout) {
    return "{\"id\":"+MJ(id)+",\"diagnosticOnly\":true,\"replacesRestrictedProof\":false,\"state\":"+MJ(state)+",\"tokenVariant\":"+MJ(variant)+",\"weakerDiagnostic\":"+MB(weaker)+",\"creationFlags\":"+(flags|4)+",\"ownedJobRequested\":"+MB(requestedJob)+",\"ownedJobAttached\":"+MB(assigned)+",\"inAnyJob\":"+MB(inJob)+",\"parent\":"+parent+",\"childToken\":"+child+",\"childAssignedDesktop\":"+assignedDesktop+",\"childDesktop\":"+desktop+",\"childDesktopAtStart\":"+atStart+",\"exitCode\":"+exit+",\"durationMs\":"+duration+",\"durationScope\":\"row-setup-launch-settlement\",\"timedOut\":"+MB(timedOut)+",\"failure\":"+failure+",\"cleanupFailure\":"+cleanup+",\"stderr\":"+MJ(stderr)+",\"stdout\":"+MJ(stdout)+"}";
  }
}
