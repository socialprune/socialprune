$ErrorActionPreference = 'Stop'
function Digest([string]$Value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function JsonDigest($Value) { return Digest (ConvertTo-Json -InputObject $Value -Depth 20 -Compress) }
$services = @(Get-CimInstance Win32_Service | ForEach-Object {
  # Configuration, not transient running state. No service executable is read.
  "$($_.Name)|$(JsonDigest @($_.PathName, $_.StartMode, $_.StartName, $_.ServiceType, $_.DesktopInteract))"
} | Sort-Object)
$tasks = @(Get-ScheduledTask | ForEach-Object {
  $xml = Export-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath
  "$($_.TaskPath)$($_.TaskName)|$(Digest $xml)"
} | Sort-Object)
$runKeys = @()
foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    try {
      foreach ($path in @('Software\Microsoft\Windows\CurrentVersion\Run', 'Software\Microsoft\Windows\CurrentVersion\RunOnce', 'Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run')) {
        $key = $base.OpenSubKey($path, $false)
        if ($key) {
          try {
            foreach ($name in $key.GetValueNames()) {
              $value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
              $runKeys += "$hive|$view|$path|$name|$($key.GetValueKind($name))|$(JsonDigest $value)"
            }
          } finally { $key.Dispose() }
        }
      }
    } finally { $base.Dispose() }
  }
}
# INetFwPolicy2 is Windows' read-only rule enumeration available to a standard
# user. The CIM port-filter provider requires elevation on some machines.
$policy = New-Object -ComObject HNetCfg.FwPolicy2
try {
  $firewall = @($policy.Rules | ForEach-Object {
    "$($_.Name)|$(JsonDigest @($_.Description, $_.ApplicationName, $_.ServiceName, $_.Protocol, $_.LocalPorts, $_.RemotePorts, $_.LocalAddresses, $_.RemoteAddresses, $_.IcmpTypesAndCodes, $_.Direction, $_.Interfaces, $_.InterfaceTypes, $_.Enabled, $_.Grouping, $_.Profiles, $_.EdgeTraversal, $_.Action))"
  } | Sort-Object)
} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($policy) }
$tcp = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object { "tcp|$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)" })
# UDP endpoints have no Listen state (ordinary DNS clients acquire ephemeral
# ports). The app's own TCP and UDP endpoints are checked separately.
$startup = @()
foreach ($folder in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
  if (Test-Path -LiteralPath $folder) {
    $startup += @(Get-ChildItem -LiteralPath $folder -File -Force | ForEach-Object { "$folder|$($_.Name)|$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())" })
  }
}
@{ services = @($services); tasks = @($tasks); runKeys = @($runKeys | Sort-Object); firewall = @($firewall); listeners = @($tcp | Sort-Object -Unique); startup = @($startup | Sort-Object) } | ConvertTo-Json -Depth 5 -Compress
