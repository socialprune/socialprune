using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

// Release-proof harness only. DEBUG_PROCESS binds descendants before their
// first instruction, unlike a process-table poll. NSIS v313 util.c creates its
// copy with CREATE_DEFAULT_ERROR_MODE, not DEBUG_PROCESS or job breakaway.
// https://learn.microsoft.com/windows/win32/debug/debugging-events
// https://learn.microsoft.com/windows/win32/procthread/process-creation-flags
// https://github.com/kichik/nsis/blob/v313/Source/exehead/util.c
// https://github.com/kichik/nsis/blob/v313/Source/exehead/Main.c
public static class UninstallerCapture {
  public sealed class Row {
    public uint pid, parentPid;
    public string birth, exitTime, imageNameClass, imagePathClass;
    public uint? exitCode;
    public long createdMs, durationMs;
    internal IntPtr handle;
  }
  public sealed class Receipt {
    public int version = 1;
    public string mechanism = "debug-process-events", state = "armed", failure;
    public string armedAt, launchedAt;
    public long armedMs, launchMs;
    public bool armedBeforeLaunch, settled;
    public Row outer;
    public List<Row> children = new List<Row>();
    public List<string> queryErrors = new List<string>();
    public long? firstPollMs;
    public int pollCount, candidateCount, folderCount;
    public bool folderAppeared, unExeAppeared;
    public List<string> unExeSha256 = new List<string>();
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved, desktop, title;
    public uint x,y,xSize,ySize,xCount,yCount,fill,flags;
    public short show, reservedBytes; public IntPtr reservedPointer,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct CreateInfo {
    public IntPtr file,process,thread,baseAddress;
    public uint debugOffset,debugSize;
    public IntPtr threadLocal,start,imageName; public ushort unicode;
  }
  [StructLayout(LayoutKind.Explicit, Size=176)] struct DebugEvent {
    [FieldOffset(0)] public uint code;
    [FieldOffset(4)] public uint pid;
    [FieldOffset(8)] public uint tid;
    [FieldOffset(16)] public CreateInfo create;
    [FieldOffset(16)] public uint exitCode;
    [FieldOffset(16)] public IntPtr file;
    [FieldOffset(168)] public uint firstChance;
  }
  [StructLayout(LayoutKind.Sequential)] struct BasicInfo { public IntPtr reserved,peb,r0,r1,pid,parent; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool WaitForDebugEvent(out DebugEvent value,uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ContinueDebugEvent(uint pid,uint tid,uint status);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DebugSetProcessKillOnExit(bool kill);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle,out long created,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr source,IntPtr targetProcess,out IntPtr target,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr handle,uint code);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(IntPtr file,StringBuilder name,uint size,uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int info,out BasicInfo result,int size,out int returned);
  static string Now() { return DateTime.UtcNow.ToString("o"); }
  public static double ElapsedSince(long startTicks,long nowTicks,long frequency) {
    return (nowTicks-startTicks)*1000.0/frequency;
  }
  static void Error(Receipt r,string code) {
    if(!Regex.IsMatch(code,@"^NSIS_(IMAGE|SCOPE|TEMP|BIRTH|PARENT|HANDLE|POLL|EXIT_TIME)_QUERY_FAILED$")) code="NSIS_CAPTURE_QUERY_FAILED";
    if(!r.queryErrors.Contains(code)) r.queryErrors.Add(code);
  }
  static string FinalPath(IntPtr handle) {
    var name=new StringBuilder(32768); uint n=GetFinalPathNameByHandleW(handle,name,(uint)name.Capacity,0);
    if(n==0 || n>=name.Capacity) throw new Exception("NSIS_IMAGE_QUERY_FAILED");
    return name.ToString();
  }
  static string Canonical(string path) {
    IntPtr file=CreateFileW(path,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero);
    if(file==new IntPtr(-1)) throw new Exception("NSIS_SCOPE_QUERY_FAILED");
    try { return FinalPath(file).TrimEnd('\\'); } finally { CloseHandle(file); }
  }
  static string Quote(string arg) {
    if(arg.Length>0 && !Regex.IsMatch(arg,"[\\s\"]")) return arg;
    return "\""+Regex.Replace(Regex.Replace(arg,@"(\\*)""", "$1$1\\\""),@"(\\+)$", "$1$1")+"\"";
  }
  static void Folders(Receipt r,string root) {
    try {
      int count=0;
      foreach(string folder in Directory.GetDirectories(root)) {
        if(!Regex.IsMatch(Path.GetFileName(folder),@"^~nsu[0-9a-f]+\.tmp$",RegexOptions.IgnoreCase)) continue;
        if((File.GetAttributes(folder)&FileAttributes.ReparsePoint)!=0) throw new Exception();
        count++;
        string file=Path.Combine(folder,"Un.exe");
        if(!File.Exists(file)) continue;
        if((File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0) throw new Exception();
        r.unExeAppeared=true;
        using(var sha=SHA256.Create()) using(var stream=File.OpenRead(file)) {
          string hash=BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
          if(!r.unExeSha256.Contains(hash)) r.unExeSha256.Add(hash);
        }
      }
      r.folderCount=Math.Max(r.folderCount,count); r.folderAppeared|=count>0;
    } catch { Error(r,"NSIS_TEMP_QUERY_FAILED"); }
  }
  public static Receipt Run(string executable,string[] args,string tempRoot,Action<object> save) {
    var r=new Receipt(); var clock=Stopwatch.StartNew(); var rows=new Dictionary<uint,Row>();
    var duplicates=new List<IntPtr>(); ProcessInfo launch=new ProcessInfo();
    string root=null; int active=0; bool pending=false; DebugEvent ev=new DebugEvent();long lastPoll=-5;
    IntPtr environment=IntPtr.Zero;long launchTicks=0;
    var breakpoints=new HashSet<string>();
    try {
      if(IntPtr.Size!=8) throw new Exception("NSIS_CAPTURE_ARCH_REQUIRED");
      root=Canonical(tempRoot);
      // Same minimal OS-only environment as the existing installer invocation.
      // Compilation and the capture host keep their own run-owned temp folder.
      environment=Marshal.StringToHGlobalUni("SystemRoot="+Environment.GetEnvironmentVariable("SystemRoot")+"\0TEMP="+tempRoot+"\0TMP="+tempRoot+"\0windir="+Environment.GetEnvironmentVariable("windir")+"\0\0");
      r.armedAt=Now();r.armedMs=clock.ElapsedMilliseconds;save(r);
      var command=new StringBuilder(Quote(executable)); foreach(string arg in args) command.Append(" ").Append(Quote(arg));
      var startup=new Startup { cb=Marshal.SizeOf(typeof(Startup)),flags=1,show=0 };
      r.launchedAt=Now();r.launchMs=clock.ElapsedMilliseconds;r.armedBeforeLaunch=true;
      launchTicks=clock.ElapsedTicks;
      // No DEBUG_ONLY_THIS_PROCESS: every descendant stays in this debug chain.
      if(!CreateProcessW(executable,command,IntPtr.Zero,IntPtr.Zero,false,1|0x400,environment,null,ref startup,out launch)) throw new Exception("NSIS_OUTER_LAUNCH_FAILED");
      if(!DebugSetProcessKillOnExit(true)) throw new Exception("NSIS_DEBUG_LIFECYCLE_FAILED");
      r.state="capturing";save(r);
      do {
        if(ElapsedSince(launchTicks,clock.ElapsedTicks,Stopwatch.Frequency)>=67130) throw new Exception(active>0?"NSIS_COPY_EXIT_UNKNOWN":"NSIS_CAPTURE_TIMEOUT");
        if(clock.ElapsedMilliseconds-lastPoll>=5) {
          // Secondary witness only. Only already captured PIDs are inspected.
          if(!r.firstPollMs.HasValue) r.firstPollMs=clock.ElapsedMilliseconds;
          lastPoll=clock.ElapsedMilliseconds;
          r.pollCount++;
          foreach(var row in rows.Values) if(!row.exitCode.HasValue && row.imageNameClass=="un") {
            try { using(var p=Process.GetProcessById((int)row.pid)) { if(!p.HasExited) r.candidateCount++; } }
            catch { Error(r,"NSIS_POLL_QUERY_FAILED"); }
          }
        }
        if(!WaitForDebugEvent(out ev,5)) {
          if(Marshal.GetLastWin32Error()!=121) throw new Exception("NSIS_DEBUG_WAIT_FAILED");
          continue;
        }
        pending=true;uint status=0x00010002;
        if(ev.code==3) {
          var row=new Row {pid=ev.pid,createdMs=clock.ElapsedMilliseconds,imageNameClass="other",imagePathClass="unknown"};
          active++;
          try {
            long born,exit,kernel,user;
            if(!GetProcessTimes(ev.create.process,out born,out exit,out kernel,out user)) throw new Exception("NSIS_BIRTH_QUERY_FAILED");
            row.birth=born.ToString();
            BasicInfo basic;int returned;
            if(NtQueryInformationProcess(ev.create.process,0,out basic,Marshal.SizeOf(typeof(BasicInfo)),out returned)!=0) throw new Exception("NSIS_PARENT_QUERY_FAILED");
            row.parentPid=(uint)basic.parent.ToInt64();
            string image=FinalPath(ev.create.file);
            row.imageNameClass=String.Equals(Path.GetFileName(image),"Un.exe",StringComparison.OrdinalIgnoreCase)?"un":"other";
            string relative=image.StartsWith(root+"\\",StringComparison.OrdinalIgnoreCase)?image.Substring(root.Length+1):null;
            row.imagePathClass=relative!=null && Regex.IsMatch(relative,@"^~nsu[0-9a-f]+\.tmp\\Un\.exe$",RegexOptions.IgnoreCase)?"run-owned-nsis-copy":ev.pid==launch.pid?"owned-installed-uninstaller":relative!=null?"run-owned-temp-other":"outside-uninstall-scope";
            IntPtr duplicate;
            if(!DuplicateHandle(GetCurrentProcess(),ev.create.process,GetCurrentProcess(),out duplicate,0,false,2)) throw new Exception("NSIS_HANDLE_QUERY_FAILED");
            row.handle=duplicate;duplicates.Add(duplicate);
          } catch(Exception e) { Error(r,e.Message); }
          finally { if(ev.create.file!=IntPtr.Zero) CloseHandle(ev.create.file); }
          rows.Add(ev.pid,row);if(ev.pid==launch.pid) r.outer=row; else r.children.Add(row);
          Folders(r,tempRoot);save(r);
        } else if(ev.code==5) {
          Row row;
          if(!rows.TryGetValue(ev.pid,out row)) throw new Exception("NSIS_EXIT_WITHOUT_CREATE");
          row.exitCode=ev.exitCode;row.durationMs=clock.ElapsedMilliseconds-row.createdMs;
          long born,exit,kernel,user;
          if(GetProcessTimes(row.handle,out born,out exit,out kernel,out user) && exit!=0) {
            row.exitTime=DateTime.FromFileTimeUtc(exit).ToString("o");
            row.durationMs=(exit-born)/10000;
          }
          else {row.exitTime=Now();Error(r,"NSIS_EXIT_TIME_QUERY_FAILED");}
          active--;Folders(r,tempRoot);save(r);
        } else if(ev.code==6 && ev.file!=IntPtr.Zero) CloseHandle(ev.file);
        else if(ev.code==1) {
          uint exception=ev.exitCode;
          if(ev.firstChance==1 && (exception==0x80000003 || exception==0x4000001f) && breakpoints.Add(ev.pid+":"+exception)) status=0x00010002;
          else status=0x80010001; // Do not swallow the uninstaller's exceptions.
        }
        if(!ContinueDebugEvent(ev.pid,ev.tid,status)) throw new Exception("NSIS_DEBUG_CONTINUE_FAILED");
        pending=false;
      } while(active>0 || r.outer==null);
      foreach(IntPtr handle in duplicates) if(WaitForSingleObject(handle,1000)!=0) throw new Exception("NSIS_COPY_EXIT_UNKNOWN");
      r.settled=true;
      var copies=r.children.FindAll(row=>row.imageNameClass=="un" && row.imagePathClass=="run-owned-nsis-copy" && row.parentPid==launch.pid);
      if(copies.Count==0) throw new Exception(r.children.Exists(row=>row.imagePathClass=="unknown")?"NSIS_COPY_EXIT_UNKNOWN":"NSIS_COPY_NOT_STARTED");
      if(copies.Exists(row=>!row.exitCode.HasValue)) throw new Exception("NSIS_COPY_EXIT_UNKNOWN");
      if(r.outer.exitCode!=0) throw new Exception("NSIS_OUTER_EXIT_FAILED");
      if(copies.Count!=1) throw new Exception("NSIS_COPY_COUNT_FAILED");
      if(copies[0].exitCode!=10) throw new Exception("NSIS_COPY_REFUSAL_EXIT");
      if(r.queryErrors.Count!=0) throw new Exception("NSIS_CAPTURE_QUERY_FAILED");
      r.state="passed";
    } catch(Exception e) {
      r.state="failed";
      r.failure=Regex.IsMatch(e.Message,@"^NSIS_[A-Z_]+$")?e.Message:"NSIS_CAPTURE_FAILED";
      // Only debug-chain handles belong to us. Kill and drain the chain; never
      // enumerate or stop a foreign process, even if it has the same name.
      foreach(IntPtr handle in duplicates) TerminateProcess(handle,1);
      if(launch.process!=IntPtr.Zero) TerminateProcess(launch.process,1);
      if(pending) {ContinueDebugEvent(ev.pid,ev.tid,0x80010001);pending=false;}
      while(active>0 && WaitForDebugEvent(out ev,1000)) {
        if(ev.code==5) active--;
        if(ev.code==3) {active++;TerminateProcess(ev.create.process,1);if(ev.create.file!=IntPtr.Zero)CloseHandle(ev.create.file);}
        if(ev.code==6 && ev.file!=IntPtr.Zero)CloseHandle(ev.file);
        ContinueDebugEvent(ev.pid,ev.tid,0x00010002);
      }
    } finally {
      if(root!=null) Folders(r,tempRoot);
      save(r);
      foreach(IntPtr handle in duplicates)CloseHandle(handle);
      if(launch.thread!=IntPtr.Zero)CloseHandle(launch.thread);
      if(launch.process!=IntPtr.Zero)CloseHandle(launch.process);
      if(environment!=IntPtr.Zero)Marshal.FreeHGlobal(environment);
    }
    return r;
  }
}
