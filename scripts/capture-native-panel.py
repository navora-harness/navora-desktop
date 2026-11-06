"""Capture one explicitly owned Chromium popup HWND without desktop sampling.

Example:
  python capture-native-panel.py --pid 123 --hwnd 456 --owner 789 --output panel.png

Read panel._getState().windowHandle in the Electron fixture; it is a decimal
string. NativePanel has no public screenshot API. The caller must keep its UI
message loop running and impose a subprocess timeout: PrintWindow is synchronous.
No foreground activation, input injection, window movement or screen capture is
performed here. An off-screen owner is accepted. Whether a hidden/layered GPU
surface renders into PrintWindow must be verified from the resulting pixels.
"""

import argparse
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import sys


def capture(args):
    if sys.platform != "win32":
        raise RuntimeError("Native panel HWND capture requires Windows")
    from PIL import Image, ImageStat

    user = ctypes.WinDLL("user32", use_last_error=True)
    gdi = ctypes.WinDLL("gdi32", use_last_error=True)
    handle = wintypes.HANDLE
    user.IsWindow.argtypes = [wintypes.HWND]
    user.IsWindow.restype = wintypes.BOOL
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    user.IsWindowVisible.restype = wintypes.BOOL
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetWindowThreadProcessId.restype = wintypes.DWORD
    user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.GetClassNameW.restype = ctypes.c_int
    user.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
    user.GetAncestor.restype = wintypes.HWND
    user.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
    user.GetWindow.restype = wintypes.HWND
    user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user.GetWindowRect.restype = wintypes.BOOL
    user.GetDC.argtypes = [wintypes.HWND]
    user.GetDC.restype = wintypes.HDC
    user.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
    user.ReleaseDC.restype = ctypes.c_int
    user.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
    user.PrintWindow.restype = wintypes.BOOL
    gdi.CreateCompatibleDC.argtypes = [wintypes.HDC]
    gdi.CreateCompatibleDC.restype = wintypes.HDC
    gdi.SelectObject.argtypes = [wintypes.HDC, handle]
    gdi.SelectObject.restype = handle
    gdi.DeleteObject.argtypes = [handle]
    gdi.DeleteObject.restype = wintypes.BOOL
    gdi.DeleteDC.argtypes = [wintypes.HDC]
    gdi.DeleteDC.restype = wintypes.BOOL
    gdi.GdiFlush.argtypes = []
    gdi.GdiFlush.restype = wintypes.BOOL

    # GetWindowRect must return device pixels rather than virtualized DIP values.
    if hasattr(user, "SetProcessDpiAwarenessContext"):
        user.SetProcessDpiAwarenessContext.argtypes = [handle]
        user.SetProcessDpiAwarenessContext.restype = wintypes.BOOL
        user.SetProcessDpiAwarenessContext(handle(-4))

    hwnd = args.hwnd

    def process_of(window):
        found = wintypes.DWORD()
        if not user.GetWindowThreadProcessId(window, ctypes.byref(found)):
            raise RuntimeError("Cannot identify the target window process")
        return found.value

    def validate():
        if not user.IsWindow(hwnd) or process_of(hwnd) != args.pid:
            raise RuntimeError("Target HWND does not belong to the requested fixture PID")
        name = ctypes.create_unicode_buffer(256)
        user.GetClassNameW(hwnd, name, len(name))
        if not name.value.startswith("Chrome_WidgetWin_"):
            raise RuntimeError("Target is not a Chromium Views native popup: " + name.value)
        if int(user.GetAncestor(hwnd, 2) or 0) != hwnd:
            raise RuntimeError("Target must be its own top-level root, not an embedded child")
        owner = int(user.GetWindow(hwnd, 4) or 0)
        if not owner or process_of(owner) != args.pid:
            raise RuntimeError("Target must have an owner in the fixture PID")
        if args.owner is not None and owner != args.owner:
            raise RuntimeError("Target popup owner does not match the fixture window")
        return name.value, owner

    class_name, owner = validate()
    rect = wintypes.RECT()
    if not user.GetWindowRect(hwnd, ctypes.byref(rect)):
        raise ctypes.WinError(ctypes.get_last_error())
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width < 1 or height < 1 or width > 8192 or height > 8192 or width * height > 32_000_000:
        raise RuntimeError("Target window has invalid or excessive capture dimensions")

    class BitmapInfoHeader(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("width", wintypes.LONG),
                    ("height", wintypes.LONG), ("planes", wintypes.WORD),
                    ("bit_count", wintypes.WORD), ("compression", wintypes.DWORD),
                    ("image_size", wintypes.DWORD), ("x_pixels_per_meter", wintypes.LONG),
                    ("y_pixels_per_meter", wintypes.LONG), ("colors_used", wintypes.DWORD),
                    ("important_colors", wintypes.DWORD)]

    class BitmapInfo(ctypes.Structure):
        _fields_ = [("header", BitmapInfoHeader), ("colors", wintypes.DWORD * 3)]

    gdi.CreateDIBSection.argtypes = [wintypes.HDC, ctypes.POINTER(BitmapInfo), wintypes.UINT,
                                   ctypes.POINTER(ctypes.c_void_p), handle, wintypes.DWORD]
    gdi.CreateDIBSection.restype = handle
    info = BitmapInfo()
    info.header.size = ctypes.sizeof(BitmapInfoHeader)
    info.header.width, info.header.height = width, -height
    info.header.planes, info.header.bit_count = 1, 32
    source_dc = user.GetDC(hwnd)
    if not source_dc:
        raise RuntimeError("Cannot create a device context for the target popup")
    memory_dc, bitmap, old_bitmap = None, None, None
    try:
        memory_dc = gdi.CreateCompatibleDC(source_dc)
        bits = ctypes.c_void_p()
        bitmap = gdi.CreateDIBSection(source_dc, ctypes.byref(info), 0,
                                      ctypes.byref(bits), None, 0)
        if not memory_dc or not bitmap or not bits.value:
            raise RuntimeError("Cannot allocate the target popup bitmap")
        old_bitmap = gdi.SelectObject(memory_dc, bitmap)
        ctypes.memset(bits, 0, width * height * 4)
        printed = bool(user.PrintWindow(hwnd, memory_dc, args.flags))
        gdi.GdiFlush()
        # Recheck identity after the synchronous call in case its HWND was closed.
        validate()
        image = Image.frombytes("RGB", (width, height), ctypes.string_at(bits, width * height * 4),
                                "raw", "BGRX")
    finally:
        if old_bitmap and memory_dc:
            gdi.SelectObject(memory_dc, old_bitmap)
        if bitmap:
            gdi.DeleteObject(bitmap)
        if memory_dc:
            gdi.DeleteDC(memory_dc)
        user.ReleaseDC(hwnd, source_dc)

    destination = Path(args.output).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination)
    deviation = ImageStat.Stat(image).stddev
    nonuniform = max(deviation) > 0.5
    result = {"ok": printed and nonuniform, "path": str(destination), "pid": args.pid,
              "hwnd": str(hwnd), "owner": str(owner), "class": class_name,
              "visible": bool(user.IsWindowVisible(hwnd)), "width": width, "height": height,
              "physicalBounds": {"x": rect.left, "y": rect.top, "width": width, "height": height},
              "method": "PrintWindow", "flags": args.flags, "printWindowReturned": printed,
              "pixelStddev": deviation, "alphaVerified": False}
    if not result["ok"]:
        result["reason"] = "PrintWindow failed or returned a uniform compositor surface; native visual capture is unverified"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", required=True, type=int)
    parser.add_argument("--hwnd", required=True, type=lambda value: int(value, 0))
    parser.add_argument("--owner", type=lambda value: int(value, 0))
    parser.add_argument("--output", required=True)
    parser.add_argument("--flags", type=int, choices=[0, 1, 2, 3], default=2,
                        help="PrintWindow flags; default 2 requests full compositor content")
    args = parser.parse_args()
    try:
        result = capture(args)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["ok"] else 1
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
