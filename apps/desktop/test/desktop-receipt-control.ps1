param([string]$Scratch)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition ([IO.File]::ReadAllText("$PSScriptRoot\desktop-receipt.cs"))
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class ReceiptPublisher {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  public static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
}
'@
$temporary=Join-Path $Scratch 'generated.tmp'
$receipt=Join-Path $Scratch 'generated.json'
$text='{"code":0,"environmentUnchanged":true}'
[IO.File]::WriteAllText($temporary,$text)
# The published name is visible while a compatible publication handle remains
# open. No foreign process, receipt or filesystem location is involved.
$publisher=[ReceiptPublisher]::CreateFileW($temporary,0x10000,7,[IntPtr]::Zero,3,0,[IntPtr]::Zero)
if($publisher.IsInvalid) { throw 'DESKTOP_RECEIPT_PUBLISHER_OPEN_FAILED' }
try {
  [IO.File]::Move($temporary,$receipt)
  $oldFailed=$false
  $oldError=0
  try { [void][IO.File]::ReadAllText($receipt) }
  catch [IO.IOException] { $oldFailed=$true; $oldError=$_.Exception.HResult -band 0xffff }
  if(-not $oldFailed -or $oldError -ne 32) { throw 'DESKTOP_RECEIPT_RED_NOT_REPRODUCED' }
  $current=[DesktopReceipt]::Read($receipt)
  if($current -cne $text) { throw 'DESKTOP_RECEIPT_BYTES_CHANGED' }
  @{oldReaderFailed=$oldFailed;win32Error=$oldError;newReaderExact=$true;publicationHandleStillOpen=(-not $publisher.IsClosed);publisherAccess='DELETE';timeoutChanged=$false} | ConvertTo-Json -Compress
} finally { $publisher.Dispose() }
# Missing receipts remain failures. This is sharing compatibility, not retry or
# error swallowing, and it does not accept an empty/fabricated replacement.
[IO.File]::Delete($receipt)
$missingFailed=$false
try { [void][DesktopReceipt]::Read($receipt) } catch [IO.FileNotFoundException] { $missingFailed=$true }
if(-not $missingFailed) { throw 'DESKTOP_RECEIPT_ABSENCE_ACCEPTED' }
