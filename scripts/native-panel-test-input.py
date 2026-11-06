"""Send Win32 messages only to an explicitly owned fixture popup; never global input."""
import argparse
import ctypes
from ctypes import wintypes
import json
import time

parser = argparse.ArgumentParser()
parser.add_argument('--pid', type=int, required=True)
parser.add_argument('--hwnd', type=int, required=True)
parser.add_argument('--text')
parser.add_argument('--key', type=int)
args = parser.parse_args()
user = ctypes.WinDLL('user32', use_last_error=True)
user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
user.GetWindow.restype = wintypes.HWND
user.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user.MapVirtualKeyW.argtypes = [wintypes.UINT, wintypes.UINT]
def validate(hwnd):
    pid = wintypes.DWORD()
    if not user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid)) or pid.value != args.pid:
        raise RuntimeError('Target is outside the isolated fixture PID')
validate(args.hwnd)
owner = user.GetWindow(args.hwnd, 4)
if not owner:
    raise RuntimeError('Only a fixture-owned popup is accepted')
validate(owner)
name = ctypes.create_unicode_buffer(256)
user.GetClassNameW(args.hwnd, name, len(name))
if not name.value.startswith('Chrome_WidgetWin_'):
    raise RuntimeError('Target is not a Views popup')
if args.text is not None:
    raw = args.text.encode('utf-16-le')
    for offset in range(0, len(raw), 2):
        validate(args.hwnd)
        user.PostMessageW(args.hwnd, 0x0102, int.from_bytes(raw[offset:offset+2], 'little'), 1)
        time.sleep(0.012)
if args.key is not None:
    scan = user.MapVirtualKeyW(args.key, 0)
    user.PostMessageW(args.hwnd, 0x0100, args.key, 1 | (scan << 16))
    user.PostMessageW(args.hwnd, 0x0101, args.key, 1 | (scan << 16) | (3 << 30))
time.sleep(0.06)
print(json.dumps({'pid': args.pid, 'hwnd': args.hwnd, 'owner': int(owner), 'class': name.value, 'input': 'targeted Win32 messages; no global or physical input'}))
