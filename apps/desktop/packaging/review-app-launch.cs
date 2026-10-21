using System;
using System.IO;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text.RegularExpressions;

// Harness only. Keep the actual release bytes, token, sandbox and owned job.
// STARTUPINFO binds the GUI process to the launcher's desktop explicitly.
public static class ReviewAppLaunch {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup { public int cb;public string reserved,desktop,title;public int x,y,cx,cy,xchars,ychars,fill,flags;public short show,reserved2;public IntPtr bytes,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct Info { public IntPtr process,thread;public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long processTime,jobTime;public uint flags;public UIntPtr min,max;public uint active;public UIntPtr affinity;public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public Basic basic;public Io io;public UIntPtr a,b,c,d; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string executable,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out Info info);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr source,IntPtr targetProcess,out IntPtr target,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Limits limits,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr data,uint size,out uint needed);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int kind,IntPtr data,uint size,out uint needed);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process,out long born,out long end,out long kernel,out long user);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll",SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr handle,int kind,IntPtr value,uint size,out uint needed);
  static void Require(bool value,string call) { if(!value) throw new Win32Exception(Marshal.GetLastWin32Error(),"REVIEW_APP_NATIVE:"+call+":"+Marshal.GetLastWin32Error()); }
  static string Name(IntPtr handle) { Require(handle!=IntPtr.Zero,"GetWindowObject");IntPtr data=Marshal.AllocHGlobal(1024);try{uint needed;Require(GetUserObjectInformationW(handle,2,data,1024,out needed),"GetUserObjectInformationW");return Marshal.PtrToStringUni(data);}finally{Marshal.FreeHGlobal(data);} }
  static string Quote(string value) { var text=new StringBuilder("\"");int slashes=0;foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='\"')text.Append('\\',slashes*2+1).Append('"');else text.Append('\\',slashes).Append(c);slashes=0;}return text.Append('\\',slashes*2).Append('"').ToString(); }
  static string J(string value) { return value==null?"null":"\""+value.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r","\\r").Replace("\n","\\n")+"\""; }
  static void Save(string path,string text) {
    string pending=path+".pending";File.WriteAllText(pending,text,new UTF8Encoding(false));
    if(File.Exists(path))File.Replace(pending,path,null);else File.Move(pending,path);
  }
  sealed class OwnedChild {
    public IntPtr handle;public int pid;public long born;public bool alive;public uint? exitCode;public string type="unknown";public string failure;public int? nativeError;public bool observedExitedBeforeCleanup;
    public string Json(){return "{\"pid\":"+pid+",\"born\":"+J(born.ToString())+",\"type\":"+J(type)+",\"alive\":"+alive.ToString().ToLowerInvariant()+",\"exitCode\":"+(exitCode.HasValue?exitCode.Value.ToString():"null")+",\"observedExitedBeforeCleanup\":"+observedExitedBeforeCleanup.ToString().ToLowerInvariant()+",\"failure\":"+J(failure)+",\"nativeError\":"+(nativeError.HasValue?nativeError.Value.ToString():"null")+"}";}
  }
  static string ChildType(IntPtr process,out int status) {
    uint needed;status=NtQueryInformationProcess(process,60,IntPtr.Zero,0,out needed);
    if(needed==0||needed>1024*1024)return "unknown";
    IntPtr data=Marshal.AllocHGlobal((int)needed);
    try {
      status=NtQueryInformationProcess(process,60,data,needed,out needed);if(status!=0)return "unknown";
      int length=(ushort)Marshal.ReadInt16(data);IntPtr buffer=Marshal.ReadIntPtr(data,IntPtr.Size==8?8:4);
      string command=Marshal.PtrToStringUni(buffer,length/2);
      var match=Regex.Match(command,@"(?:^|\s)--type=(?:""(?<type>[^""]+)""|(?<type>\S+))");
      if(!match.Success)return "browser";
      string type=match.Groups["type"].Value;
      return type=="renderer"||type=="gpu-process"||type=="utility"||type=="crashpad-handler"?type:"other";
    }finally{Marshal.FreeHGlobal(data);}
  }
  static void ObserveChildren(IntPtr job,Dictionary<string,OwnedChild> known,List<string> failures) {
    uint needed;int capacity=4096;IntPtr data=Marshal.AllocHGlobal(capacity);
    try {
      if(!QueryInformationJobObject(job,3,data,(uint)capacity,out needed)){failures.Add("QueryInformationJobObject:"+Marshal.GetLastWin32Error());return;}
      int count=Marshal.ReadInt32(data,4);
      for(int i=0;i<count;i++) {
        int pid=Marshal.ReadIntPtr(data,8+i*IntPtr.Size).ToInt32();
        bool trackedAlive=false;foreach(var row in known.Values)if(row.pid==pid&&WaitForSingleObject(row.handle,0)==258){trackedAlive=true;break;}if(trackedAlive)continue;
        IntPtr handle=OpenProcess(0x101000,false,pid);
        if(handle==IntPtr.Zero){failures.Add("OpenProcess:"+pid+":"+Marshal.GetLastWin32Error());continue;}
        long born,end,kernel,user;
        if(!GetProcessTimes(handle,out born,out end,out kernel,out user)){failures.Add("GetProcessTimes:"+pid+":"+Marshal.GetLastWin32Error());CloseHandle(handle);continue;}
        string identity=pid+":"+born;if(known.ContainsKey(identity)){CloseHandle(handle);continue;}
        int status;string type=ChildType(handle,out status);
        known.Add(identity,new OwnedChild{pid=pid,born=born,handle=handle,type=type,failure=status==0?null:"NtQueryInformationProcess",nativeError=status==0?(int?)null:status});
      }
    }finally{Marshal.FreeHGlobal(data);}
    foreach(var row in known.Values) {
      row.alive=WaitForSingleObject(row.handle,0)==258;
      if(!row.alive){row.observedExitedBeforeCleanup=true;uint code;if(GetExitCodeProcess(row.handle,out code))row.exitCode=code;else{row.failure="GetExitCodeProcess";row.nativeError=Marshal.GetLastWin32Error();}}
    }
  }
  public static void Run(string executable,string[] args,string desktopPath,string receipt,string stopFile,int timeoutMs) {
    string station=Name(GetProcessWindowStation());
    string selected=String.IsNullOrEmpty(desktopPath)?station+"\\"+Name(GetThreadDesktop(GetCurrentThreadId())):desktopPath;
    string[] parts=selected.Split('\\');
    if(parts.Length!=2||!String.Equals(parts[0],station,StringComparison.OrdinalIgnoreCase))throw new Exception("REVIEW_APP_STATION_MISMATCH");
    var command=new StringBuilder(Quote(executable));foreach(string arg in args)command.Append(' ').Append(Quote(arg));
    var startup=new Startup{cb=Marshal.SizeOf(typeof(Startup)),desktop=selected,flags=0x100,input=GetStdHandle(-10),output=GetStdHandle(-11),error=GetStdHandle(-12)};
    Info child=new Info();IntPtr job=IntPtr.Zero;bool assigned=false;bool? verified=null;long? verifiedAtMs=null;string state="launching",failure=null,exitCode="null",born="null";
    var clock=System.Diagnostics.Stopwatch.StartNew();
    var children=new Dictionary<string,OwnedChild>();var childFailures=new List<string>();long nextSave=0;
    Action save=()=>{var rows=new List<string>();foreach(var row in children.Values)rows.Add(row.Json());var errors=new List<string>();foreach(string error in new HashSet<string>(childFailures))errors.Add(J(error));Save(receipt,"{\"version\":1,\"state\":"+J(state)+",\"pid\":"+child.pid+",\"born\":"+born+",\"explicitDesktop\":true,\"desktopPath\":"+J(selected)+",\"desktopVerified\":"+(verified.HasValue?verified.Value.ToString().ToLowerInvariant():"null")+",\"desktopVerifiedAtMs\":"+(verifiedAtMs.HasValue?verifiedAtMs.Value.ToString():"null")+",\"killOnCloseJob\":true,\"elapsedMs\":"+clock.ElapsedMilliseconds+",\"exitCode\":"+exitCode+",\"failure\":"+J(failure)+",\"processObservation\":{\"scope\":\"owned-job-only\",\"pollIntervalMs\":50,\"shortLivedProcessesMayBeMissed\":true,\"failures\":["+String.Join(",",errors)+"],\"processes\":["+String.Join(",",rows)+"]}}");};
    try {
      job=CreateJobObjectW(IntPtr.Zero,null);Require(job!=IntPtr.Zero,"CreateJobObjectW");
      var limits=new Limits{basic=new Basic{flags=0x2000}};
      Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))),"SetInformationJobObject");
      Require(CreateProcessW(executable,command,IntPtr.Zero,IntPtr.Zero,true,4,IntPtr.Zero,null,ref startup,out child),"CreateProcessW");
      Require(AssignProcessToJobObject(job,child.process),"AssignProcessToJobObject");assigned=true;
      long creation,end,kernel,user;Require(GetProcessTimes(child.process,out creation,out end,out kernel,out user),"GetProcessTimes");born=J(creation.ToString());
      IntPtr observed;Require(DuplicateHandle(GetCurrentProcess(),child.process,GetCurrentProcess(),out observed,0,false,2),"DuplicateHandle");
      children.Add(child.pid+":"+creation,new OwnedChild{pid=(int)child.pid,born=creation,handle=observed,type="browser",alive=true});
      state="running";save();Require(ResumeThread(child.thread)!=0xffffffff,"ResumeThread");
      while(true) {
        uint wait=WaitForSingleObject(child.process,50);
        ObserveChildren(job,children,childFailures);
        if(clock.ElapsedMilliseconds>=nextSave){save();nextSave=clock.ElapsedMilliseconds+250;}
        if(wait==0){uint code;Require(GetExitCodeProcess(child.process,out code),"GetExitCodeProcess");exitCode=code.ToString();state="exited";break;}
        if(wait!=258)Require(false,"WaitForSingleObject");
        // A suspended or console-only thread has not connected to USER yet.
        // Record verification only after Windows exposes the actual desktop.
        if(!verified.HasValue) {
          IntPtr actual=GetThreadDesktop(child.tid);
          if(actual!=IntPtr.Zero){verified=String.Equals(Name(actual),parts[1],StringComparison.OrdinalIgnoreCase);verifiedAtMs=clock.ElapsedMilliseconds;save();if(verified==false)throw new Exception("REVIEW_APP_DESKTOP_MISMATCH");}
        }
        if(File.Exists(stopFile)){state="stopped";break;}
        if(clock.ElapsedMilliseconds>=timeoutMs){state="timeout";failure="REVIEW_APP_TIMEOUT";break;}
      }
    } catch(Exception error) { state="failed";failure=error.Message;throw; }
    finally {
      if(!assigned&&child.process!=IntPtr.Zero)TerminateProcess(child.process,1);
      if(job!=IntPtr.Zero)CloseHandle(job);
      if(child.process!=IntPtr.Zero){WaitForSingleObject(child.process,5000);if(exitCode=="null"){uint code;if(GetExitCodeProcess(child.process,out code))exitCode=code.ToString();}CloseHandle(child.process);}
      if(child.thread!=IntPtr.Zero)CloseHandle(child.thread);
      foreach(var row in children.Values){row.alive=WaitForSingleObject(row.handle,5000)==258;uint code;if(!row.alive&&GetExitCodeProcess(row.handle,out code))row.exitCode=code;CloseHandle(row.handle);}
      save();
    }
  }
}
