param([int]$X, [int]$Y, [int]$Width, [int]$Height, [string]$ImagePath, [long]$ExpectedHandle)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MaterialCaptureNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
[void][MaterialCaptureNative]::SetProcessDPIAware()
$before = [MaterialCaptureNative]::GetForegroundWindow().ToInt64()
if ($before -ne $ExpectedHandle) { [Console]::WriteLine('skipped'); return }
$bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($X, $Y, 0, 0, [System.Drawing.Size]::new($Width, $Height), [System.Drawing.CopyPixelOperation]::SourceCopy)
  $after = [MaterialCaptureNative]::GetForegroundWindow().ToInt64()
  if ($after -eq $ExpectedHandle) {
    $bitmap.Save($ImagePath, [System.Drawing.Imaging.ImageFormat]::Png)
    [Console]::WriteLine('captured')
  } else { [Console]::WriteLine('skipped') }
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
