using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class ConsoleState {
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetConsoleProcessList(uint[] list,uint count);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  public static void Main(string[] args) {
    uint parent=uint.Parse(args[0]);var pids=new uint[4096];uint count=GetConsoleProcessList(pids,(uint)pids.Length);
    if(count==0||count>pids.Length)throw new Exception("CONSOLE_MEMBERSHIP_READ_FAILED");
    bool shared=false;for(int i=0;i<count;i++)if(pids[i]==parent)shared=true;
    bool job;if(!IsProcessInJob(GetCurrentProcess(),IntPtr.Zero,out job))throw new Exception("CONSOLE_JOB_READ_FAILED");
    IntPtr console=GetConsoleWindow();bool visible=console!=IntPtr.Zero&&IsWindowVisible(console),foreground=console!=IntPtr.Zero&&GetForegroundWindow()==console;
    Console.WriteLine("{\"expectedParentSharesConsole\":"+shared.ToString().ToLowerInvariant()+",\"consoleVisible\":"+visible.ToString().ToLowerInvariant()+",\"ownConsoleForeground\":"+foreground.ToString().ToLowerInvariant()+",\"jobAttached\":"+job.ToString().ToLowerInvariant()+",\"session\":"+Process.GetCurrentProcess().SessionId+"}");
  }
}
