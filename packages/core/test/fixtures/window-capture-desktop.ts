import { dlopen, FFIType, ptr } from 'bun:ffi';
import { createHiddenDesktop, INTERACTIVE_STATION, runOnDesktop } from '../../src/platform/windows/hidden-desktop.ts';

// Session 0 services default to a station whose desktop window is invisible.
// Child windows there are invisible to IsWindowVisible even with WS_VISIBLE.
// A private desktop on WinSta0 works in both session 0 and a signed-in session
// and keeps the fixtures away from the user's input desktop.
const { symbols: user32 } = dlopen('user32.dll', {
  GetProcessWindowStation: { args: [], returns: FFIType.u64 },
  GetUserObjectInformationW: { args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  OpenWindowStationW: { args: [FFIType.ptr, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
  SetProcessWindowStation: { args: [FFIType.u64], returns: FFIType.i32 },
  CloseWindowStation: { args: [FFIType.u64], returns: FFIType.i32 },
});
const { symbols: kernel32 } = dlopen('kernel32.dll', {
  GetLastError: { args: [], returns: FFIType.u32 },
});
const UOI_NAME = 2;
const WINSTA_CREATEDESKTOP = 0x8;
const WINSTA_READATTRIBUTES = 0x2;

const original = user32.GetProcessWindowStation();
const name = Buffer.alloc(512);
if (!user32.GetUserObjectInformationW(original, UOI_NAME, ptr(name), name.length, ptr(new Uint32Array(1)))) {
  throw new Error(`GetUserObjectInformationW failed with Windows error ${kernel32.GetLastError()}`);
}
let station = 0n;
try {
  if (name.toString('utf16le').split('\0', 1)[0] !== INTERACTIVE_STATION) {
    const target = Buffer.from(`${INTERACTIVE_STATION}\0`, 'utf16le');
    station = user32.OpenWindowStationW(ptr(target), 0, WINSTA_CREATEDESKTOP | WINSTA_READATTRIBUTES);
    if (!station) throw new Error(`OpenWindowStationW(${INTERACTIVE_STATION}) failed with Windows error ${kernel32.GetLastError()}`);
    if (!user32.SetProcessWindowStation(station)) {
      throw new Error(`SetProcessWindowStation(${INTERACTIVE_STATION}) failed with Windows error ${kernel32.GetLastError()}`);
    }
  }
  const desktop = createHiddenDesktop(`boite-capture-${crypto.randomUUID()}`);
  try {
    process.exitCode = runOnDesktop(desktop.path, [process.execPath, 'test', ...process.argv.slice(2)]);
  } finally {
    desktop.close();
  }
} finally {
  if (station) {
    user32.SetProcessWindowStation(original);
    user32.CloseWindowStation(station);
  }
}
