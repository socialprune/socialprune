param([string]$Output)
$ErrorActionPreference='Stop'
# First request the exact configuration right, without writing. Then exercise
# ChangeServiceConfig on a query-only handle with every argument NO_CHANGE or
# null. Access denial is required twice; even an unexpected success could not
# change a value because this program supplies no replacement configuration.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ServiceDenial {
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenSCManagerW(string machine,string database,uint access);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenServiceW(IntPtr manager,string name,uint access);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ChangeServiceConfigW(IntPtr service,uint type,uint start,uint error,string binary,string group,IntPtr tag,string dependencies,string account,string password,string display);
  [DllImport("advapi32.dll")] static extern bool CloseServiceHandle(IntPtr handle);
  public static int Probe() {
    IntPtr manager=OpenSCManagerW(null,null,1);
    if(manager==IntPtr.Zero) throw new Exception("SERVICE_DENIAL_MANAGER:"+Marshal.GetLastWin32Error());
    try {
      IntPtr service=OpenServiceW(manager,"BITS",2); // SERVICE_CHANGE_CONFIG
      if(service!=IntPtr.Zero) { CloseServiceHandle(service); throw new Exception("SERVICE_CONFIG_RIGHT_GRANTED"); }
      int code=Marshal.GetLastWin32Error();
      if(code!=5) throw new Exception("SERVICE_DENIAL_UNEXPECTED:"+code);
      service=OpenServiceW(manager,"BITS",1); // SERVICE_QUERY_CONFIG only
      if(service==IntPtr.Zero) throw new Exception("SERVICE_QUERY_DENIED");
      try {
        bool accepted=ChangeServiceConfigW(service,0xffffffff,0xffffffff,0xffffffff,null,null,IntPtr.Zero,null,null,null,null);
        int changeError=Marshal.GetLastWin32Error();
        if(accepted||changeError!=5) throw new Exception("SERVICE_NOCHANGE_DENIAL:"+changeError);
      } finally { CloseServiceHandle(service); }
      return code;
    } finally { CloseServiceHandle(manager); }
  }
}
'@
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$admin=[Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if($admin) { throw 'SERVICE_DENIAL_REQUIRES_LIMITED_TOKEN' }
$code=[ServiceDenial]::Probe()
@{ proof='service-configuration-access-denied'; service='BITS'; requestedRight='SERVICE_CHANGE_CONFIG'; openServiceError=$code; changeServiceConfigError=5; adminMember=$admin; changeApiCalled=$true; allArgumentsNoChange=$true; machineValuesWritten=$false } | ConvertTo-Json -Compress | Set-Content -LiteralPath $Output -Encoding UTF8
$identity.Dispose()
