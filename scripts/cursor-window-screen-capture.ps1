param([string]$ImagePath, [long]$ExpectedHandle, [int]$ExpectedPid)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CursorCaptureNative {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int x,y; public Point(int a,int b){x=a;y=b;} }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd,ref Point point);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
}
'@
[void][CursorCaptureNative]::SetProcessDPIAware()
$target = [IntPtr]::new($ExpectedHandle)
function Confirm-Fixture {
  [uint32]$ownerPid = 0
  [void][CursorCaptureNative]::GetWindowThreadProcessId($target,[ref]$ownerPid)
  if ($ownerPid -ne $ExpectedPid) { throw 'Capture target PID changed' }
  $rect = [CursorCaptureNative+Rect]::new()
  if (-not [CursorCaptureNative]::GetClientRect($target,[ref]$rect)) { throw 'Fixture client rectangle unavailable' }
  $origin = [CursorCaptureNative+Point]::new(0,0)
  if (-not [CursorCaptureNative]::ClientToScreen($target,[ref]$origin)) { throw 'Fixture screen origin unavailable' }
  # The fixture disables native rounded corners and shadow. Capture its entire
  # client area, including the zero-position corner, without desktop pixels.
  $left = $origin.x; $top = $origin.y
  $width = $rect.right; $height = $rect.bottom
  foreach ($px in @($left,($left + [int]($width / 2)),($left + $width - 1))) {
    foreach ($py in @($top,($top + [int]($height / 2)),($top + $height - 1))) {
      $found = [CursorCaptureNative]::WindowFromPoint([CursorCaptureNative+Point]::new($px,$py))
      if ([CursorCaptureNative]::GetAncestor($found,2) -ne $target) { throw 'Fixture is occluded; refusing desktop capture' }
    }
  }
  return @($left,$top,$width,$height)
}
$bounds = Confirm-Fixture
$bitmap = [System.Drawing.Bitmap]::new($bounds[2],$bounds[3])
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds[0],$bounds[1],0,0,[System.Drawing.Size]::new($bounds[2],$bounds[3]),[System.Drawing.CopyPixelOperation]::SourceCopy)
  $after = Confirm-Fixture
  if (($bounds -join ',') -ne ($after -join ',')) { throw 'Fixture moved during capture' }
  $bitmap.Save($ImagePath,[System.Drawing.Imaging.ImageFormat]::Png)
  [Console]::WriteLine('captured')
} finally { $graphics.Dispose(); $bitmap.Dispose() }
