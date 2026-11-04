/**
 * Hidden desktops of the user's session, reached with `bun:ffi`: the Windows
 * half of `boite desktop` (docs/desktop.md). `CreateDesktopW` makes a desktop
 * in the interactive window station that no screen shows and no keyboard or
 * mouse reaches. A process lives on it when `STARTUPINFO.lpDesktop` names it,
 * and everything it starts inherits it, so the core runs every program of the
 * desktop through `runOnDesktop`, a short helper the core spawns like any
 * other process: it keeps the program in the conversation's job and its trace.
 * UI Automation, `PrintWindow` and Windows Graphics Capture work there; input
 * synthesized with `SendInput` only reaches the desktop on screen.
 */
import { dlopen, FFIType, JSCallback, ptr, read, type Pointer } from 'bun:ffi';
import type { HiddenDesktop, HiddenDesktops } from '../types.ts';

const GENERIC_ALL = 0x1000_0000;
const UOI_NAME = 2;
const SM_CXSCREEN = 0, SM_CYSCREEN = 1;
const STARTF_USESTDHANDLES = 0x100;
const CREATE_UNICODE_ENVIRONMENT = 0x400;
const HANDLE_FLAG_INHERIT = 1;
const INFINITE = 0xffff_ffff;
const STD_HANDLES = [0xffff_fff6, 0xffff_fff5, 0xffff_fff4];
/** STARTUPINFOW and PROCESS_INFORMATION on 64-bit Windows, x64 and arm64 alike. */
const STARTUP_INFO_SIZE = 104, PROCESS_INFO_SIZE = 24;
/** The window station of the signed-in user's own desktops. */
export const INTERACTIVE_STATION = 'WinSta0';
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

function loadUser32() {
  return dlopen('user32.dll', {
    CreateDesktopW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.u64 },
    CloseDesktop: { args: [FFIType.u64], returns: FFIType.i32 },
    EnumDesktopWindows: { args: [FFIType.u64, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
    GetWindowThreadProcessId: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.u32 },
    GetProcessWindowStation: { args: [], returns: FFIType.u64 },
    GetUserObjectInformationW: { args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
  });
}

function loadKernel32() {
  return dlopen('kernel32.dll', {
    CreateProcessW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    GetStdHandle: { args: [FFIType.u32], returns: FFIType.u64 },
    SetHandleInformation: { args: [FFIType.u64, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
    WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
    GetExitCodeProcess: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    GetLastError: { args: [], returns: FFIType.u32 },
    GetCurrentProcessId: { args: [], returns: FFIType.u32 },
    ProcessIdToSessionId: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    GetCurrentProcess: { args: [], returns: FFIType.u64 },
    CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.u64 },
    Process32FirstW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    Process32NextW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    LocalFree: { args: [FFIType.u64], returns: FFIType.u64 },
  });
}

function loadAdvapi32() {
  return dlopen('advapi32.dll', {
    OpenProcessToken: { args: [FFIType.u64, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    GetTokenInformation: { args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    ConvertSidToStringSidW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    ConvertStringSecurityDescriptorToSecurityDescriptorW: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    SetFileSecurityW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64], returns: FFIType.i32 },
  });
}

let user32: ReturnType<typeof loadUser32>['symbols'] | undefined;
let kernel32: ReturnType<typeof loadKernel32>['symbols'] | undefined;
let advapi32: ReturnType<typeof loadAdvapi32>['symbols'] | undefined;
const u32 = () => (user32 ??= loadUser32().symbols);
const k32 = () => (kernel32 ??= loadKernel32().symbols);
const adv = () => (advapi32 ??= loadAdvapi32().symbols);

const wide = (text: string) => Buffer.from(`${text}\0`, 'utf16le');

/** The name of this process's window station, or null when it cannot be read. */
function stationName(): string | null {
  const station = u32().GetProcessWindowStation();
  if (station === 0n) return null;
  const buffer = Buffer.alloc(512), needed = new Uint32Array(1);
  if (u32().GetUserObjectInformationW(station, UOI_NAME, ptr(buffer), buffer.length, ptr(needed)) === 0) return null;
  const text = buffer.toString('utf16le');
  return text.slice(0, Math.max(0, text.indexOf('\0')));
}

/** Why this process cannot make a desktop the user's session would run, or null. */
export function hiddenDesktopUnsupported(): string | null {
  const session = new Uint32Array(1);
  if (k32().ProcessIdToSessionId(k32().GetCurrentProcessId(), ptr(session)) !== 0 && session[0] === 0) {
    return 'Boite runs in session 0, as a service: a hidden desktop needs the signed-in user\'s session';
  }
  const station = stationName();
  if (station !== INTERACTIVE_STATION) return `Boite runs in window station ${station ?? 'unknown'}, not the interactive ${INTERACTIVE_STATION}`;
  return null;
}

/** Every process owning a top-level window on `desktop`. */
function windowPids(desktop: bigint): number[] {
  const pids = new Set<number>();
  const out = new Uint32Array(1);
  const callback = new JSCallback((hwnd: bigint) => {
    out[0] = 0;
    u32().GetWindowThreadProcessId(hwnd, ptr(out));
    if (out[0]) pids.add(out[0]);
    return 1;
  }, { args: [FFIType.u64, FFIType.u64], returns: FFIType.i32 });
  try {
    u32().EnumDesktopWindows(desktop, callback.ptr, 0n);
  } finally {
    callback.close();
  }
  return [...pids];
}

export function createHiddenDesktop(name: string): HiddenDesktop {
  if (!NAME.test(name)) throw new Error(`desktop name: expected 1 to 64 letters, digits, - or _, got ${JSON.stringify(name)}`);
  const handle = u32().CreateDesktopW(ptr(wide(name)), null, null, 0, GENERIC_ALL, null);
  if (handle === 0n) throw new Error(`CreateDesktopW failed with Windows error ${k32().GetLastError()}`);
  let open = true;
  return {
    name,
    path: `${INTERACTIVE_STATION}\\${name}`,
    // A desktop has the size of the screens it is not shown on.
    width: u32().GetSystemMetrics(SM_CXSCREEN),
    height: u32().GetSystemMetrics(SM_CYSCREEN),
    windowPids: () => open ? windowPids(handle) : [],
    close() {
      if (!open) return;
      open = false;
      // Windows frees the desktop once its last window and handle are gone.
      u32().CloseDesktop(handle);
    },
  };
}

const TOKEN_QUERY = 8, TOKEN_USER = 1, SDDL_REVISION_1 = 1;
const DACL_SECURITY_INFORMATION = 0x4, PROTECTED_DACL_SECURITY_INFORMATION = 0x8000_0000;

/** A NUL-terminated UTF-16 string at `address`. */
function wideAt(address: bigint): string {
  let text = '';
  for (let at = 0; ; at += 2) {
    const unit = read.u16(Number(address) as Pointer, at);
    if (unit === 0) return text;
    text += String.fromCharCode(unit);
  }
}

/** The SID of the account this process runs as, `S-1-5-21-...`. */
function userSid(): string {
  const token = new BigUint64Array(1);
  if (adv().OpenProcessToken(k32().GetCurrentProcess(), TOKEN_QUERY, ptr(token)) === 0) throw new Error(`OpenProcessToken failed with Windows error ${k32().GetLastError()}`);
  try {
    const buffer = Buffer.alloc(256), needed = new Uint32Array(1);
    if (adv().GetTokenInformation(token[0]!, TOKEN_USER, ptr(buffer), buffer.length, ptr(needed)) === 0) throw new Error(`GetTokenInformation failed with Windows error ${k32().GetLastError()}`);
    // TOKEN_USER starts with the SID's address.
    const text = new BigUint64Array(1);
    if (adv().ConvertSidToStringSidW(read.u64(ptr(buffer), 0), ptr(text)) === 0) throw new Error(`ConvertSidToStringSidW failed with Windows error ${k32().GetLastError()}`);
    try { return wideAt(text[0]!); } finally { k32().LocalFree(text[0]!); }
  } finally {
    k32().CloseHandle(token[0]!);
  }
}

/**
 * Leaves `path` to this account alone, inherited by what it will hold:
 * agent-desktop refuses a state folder another principal may open, and a
 * temporary folder often lets in more than the user.
 */
export function privateFolder(path: string): void {
  const descriptor = new BigUint64Array(1);
  if (adv().ConvertStringSecurityDescriptorToSecurityDescriptorW(ptr(wide(`D:P(A;OICI;FA;;;${userSid()})`)), SDDL_REVISION_1, ptr(descriptor), null) === 0) {
    throw new Error(`ConvertStringSecurityDescriptorToSecurityDescriptorW failed with Windows error ${k32().GetLastError()}`);
  }
  try {
    if (adv().SetFileSecurityW(ptr(wide(path)), DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, descriptor[0]!) === 0) {
      throw new Error(`could not make ${path} private: Windows error ${k32().GetLastError()}`);
    }
  } finally {
    k32().LocalFree(descriptor[0]!);
  }
}

const TH32CS_SNAPPROCESS = 2;
/** PROCESSENTRY32W on 64-bit Windows: the pid at 8, the parent's at 32, the file name from 44. */
const PROCESS_ENTRY_SIZE = 568;

/** Every process of the machine, with its parent and executable file name. */
export function processes(): { pid: number; ppid: number; name: string }[] {
  const snapshot = k32().CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot === 0xffff_ffff_ffff_ffffn) throw new Error(`CreateToolhelp32Snapshot failed with Windows error ${k32().GetLastError()}`);
  const found: { pid: number; ppid: number; name: string }[] = [];
  try {
    const entry = Buffer.alloc(PROCESS_ENTRY_SIZE);
    entry.writeUInt32LE(PROCESS_ENTRY_SIZE, 0);
    for (let more = k32().Process32FirstW(snapshot, ptr(entry)); more !== 0; more = k32().Process32NextW(snapshot, ptr(entry))) {
      const name = entry.toString('utf16le', 44, PROCESS_ENTRY_SIZE);
      found.push({ pid: entry.readUInt32LE(8), ppid: entry.readUInt32LE(32), name: name.slice(0, Math.max(0, name.indexOf('\0'))) });
    }
  } finally {
    k32().CloseHandle(snapshot);
  }
  return found;
}

export const hiddenDesktops: HiddenDesktops = { unsupported: hiddenDesktopUnsupported, create: createHiddenDesktop, privateFolder, processes, run: (path, argv) => runOnDesktop(path, argv) };

/** One word of a command line, as the C runtime's argv parser reads it back. */
export function quoteWindowsArg(word: string): string {
  return word.length > 0 && !/[\s"]/.test(word) ? word : quoted(word);
}

/** `word` in quotes, its quotes and the backslashes before them escaped for the C runtime. */
function quoted(word: string): string {
  let quoted = '"', slashes = 0;
  for (const char of word) {
    if (char === '\\') { slashes++; continue; }
    if (char === '"') { quoted += '\\'.repeat(slashes * 2 + 1) + '"'; slashes = 0; continue; }
    quoted += '\\'.repeat(slashes) + char;
    slashes = 0;
  }
  return `${quoted}${'\\'.repeat(slashes * 2)}"`;
}

/** The characters cmd.exe reads in a command line, quotes included. */
const CMD_SPECIAL = /([()\][%!^"`<>&|;, *?])/g;
const caret = (text: string) => text.replace(CMD_SPECIAL, '^$1');

/**
 * One argument of a batch file run as `cmd.exe /d /s /c "..."`: quoted for the
 * C runtime, then every character cmd.exe reads escaped with a caret, twice:
 * cmd.exe reads the line once, then again where the batch file puts `%1` or
 * `%*` into its own lines. `&` runs nothing and `%PATH%` stays text.
 */
export function quoteBatchArg(word: string): string {
  return caret(caret(quoted(word)));
}

/** The program and command line `CreateProcessW` takes for `argv`: a batch file goes through cmd.exe. */
export function windowsCommandLine(argv: string[], which: (name: string) => string | null = name => Bun.which(name)): { application: string; commandLine: string } {
  const [program, ...args] = argv;
  if (!program) throw new Error('a program to run is needed');
  const resolved = which(program) ?? program;
  if (/\.(cmd|bat)$/i.test(resolved)) {
    const cmd = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\cmd.exe`;
    return { application: cmd, commandLine: `${quoteWindowsArg(cmd)} /d /s /c "${[caret(resolved), ...args.map(quoteBatchArg)].join(' ')}"` };
  }
  return { application: resolved, commandLine: [resolved, ...args].map(quoteWindowsArg).join(' ') };
}

/**
 * The helper's whole job: start `argv` on `desktop` (`WinSta0\name`) with this
 * process's standard handles and environment, wait for it and return its exit
 * code. The program stays this helper's child, so stopping the helper's tree
 * stops it, and it inherits the job the helper runs in.
 */
export function runOnDesktop(desktop: string, argv: string[]): number {
  const { application, commandLine } = windowsCommandLine(argv);
  const info = Buffer.alloc(STARTUP_INFO_SIZE);
  const view = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const desktopName = wide(desktop);
  view.setUint32(0, STARTUP_INFO_SIZE, true);
  view.setBigUint64(16, BigInt(ptr(desktopName)), true);
  view.setUint32(60, STARTF_USESTDHANDLES, true);
  STD_HANDLES.forEach((which, at) => {
    const handle = k32().GetStdHandle(which);
    if (handle !== 0n && handle !== 0xffff_ffff_ffff_ffffn) k32().SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
    view.setBigUint64(80 + at * 8, handle, true);
  });
  const processInfo = Buffer.alloc(PROCESS_INFO_SIZE);
  const line = wide(commandLine);
  if (k32().CreateProcessW(ptr(wide(application)), ptr(line), null, null, 1, CREATE_UNICODE_ENVIRONMENT, null, null, ptr(info), ptr(processInfo)) === 0) {
    throw new Error(`${argv[0]} did not start on ${desktop}: Windows error ${k32().GetLastError()}`);
  }
  const process = read.u64(ptr(processInfo), 0), thread = read.u64(ptr(processInfo), 8);
  k32().CloseHandle(thread);
  k32().WaitForSingleObject(process, INFINITE);
  const code = new Uint32Array(1);
  k32().GetExitCodeProcess(process, ptr(code));
  k32().CloseHandle(process);
  return code[0]!;
}
