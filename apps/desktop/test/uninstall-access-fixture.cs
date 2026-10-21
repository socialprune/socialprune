using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

// Generated child only: deny limited query on its own process object, then exit
// through the already-owned stdin pipe. No foreign process ACL is read or changed.
public static class GeneratedDeniedUninstaller {
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr handle);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl,uint revision,out IntPtr descriptor,out uint size);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetKernelObjectSecurity(IntPtr handle,uint information,IntPtr descriptor);
  public static void Main() {
    IntPtr descriptor;uint size;
    if(!ConvertStringSecurityDescriptorToSecurityDescriptorW("D:(D;;0x1000;;;WD)(A;;GA;;;OW)",1,out descriptor,out size))throw new Win32Exception(Marshal.GetLastWin32Error());
    try { if(!SetKernelObjectSecurity(GetCurrentProcess(),4,descriptor))throw new Win32Exception(Marshal.GetLastWin32Error()); }
    finally { LocalFree(descriptor); }
    Console.WriteLine("ready");
    Console.ReadLine();
  }
}
