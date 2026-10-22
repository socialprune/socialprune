using System;
using System.Diagnostics;

// Generated proof double, never shipped. The child has no sleep or UI.
public static class NsisCaptureFixture {
  public static int Main(string[] args) {
    if(args[0]=="child") return Int32.Parse(args[1]);
    if(args[0]=="none") return 0;
    var child=Process.Start(new ProcessStartInfo(args[1],"child "+args[2]) {
      UseShellExecute=false, CreateNoWindow=false
    });
    child.WaitForExit();
    return 0;
  }
}
