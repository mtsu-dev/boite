import { dlopen, FFIType, ptr } from 'bun:ffi';
import { constants } from 'node:os';
import { windowsExcludeRecoveryWriters, windowsRestoreRecoveryName } from './windows/file-lock.ts';

function linuxFileControl() {
  return dlopen('libc.so.6', {
    fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  }).symbols.fcntl;
}

let fcntl: ReturnType<typeof linuxFileControl> | undefined;

function posixRecoveryRename() {
  if (process.platform === 'linux') {
    const { renameat2 } = dlopen('libc.so.6', {
      renameat2: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    }).symbols;
    const AT_FDCWD = -100;
    const RENAME_NOREPLACE = 1;
    return (from: Buffer, to: Buffer) => renameat2(AT_FDCWD, ptr(from), AT_FDCWD, ptr(to), RENAME_NOREPLACE);
  }
  const { renamex_np } = dlopen('libSystem.B.dylib', {
    renamex_np: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  }).symbols;
  const RENAME_EXCL = 4;
  return (from: Buffer, to: Buffer) => renamex_np(ptr(from), ptr(to), RENAME_EXCL);
}

let renameExclusive: ReturnType<typeof posixRecoveryRename> | undefined;

/** Restores a captured entry only if its public name is free at the instant of the move. */
export function restoreRecoveryName(from: string, to: string): void {
  try {
    if (process.platform === 'win32') windowsRestoreRecoveryName(from, to);
    else if (process.platform === 'linux' || process.platform === 'darwin') {
      (renameExclusive ??= posixRecoveryRename())(Buffer.from(`${from}\0`), Buffer.from(`${to}\0`));
    }
  } catch { /* The original name may be occupied, or the system may lack an exclusive rename. Keep the capture. */ }
}

interface WriteExclusion {
  held(): boolean;
  release(): void;
}

/** Refuse to discard an inode unless the kernel can exclude writable handles and mappings. */
export function excludeRecoveryWriters(path: string, fd: number): WriteExclusion | null {
  try {
    if (process.platform === 'linux') {
      const control = fcntl ??= linuxFileControl();
      const F_SETSIG = 10, F_SETLEASE = 1024, F_GETLEASE = 1025, F_RDLCK = 0, F_UNLCK = 2;
      // A writer opening the saved name can request a lease break. SIGURG is
      // ignored by default and F_GETLEASE detects the break before unlinking.
      if (control(fd, F_SETSIG, constants.signals.SIGURG) < 0 || control(fd, F_SETLEASE, F_RDLCK) < 0) return null;
      return {
        held: () => control(fd, F_GETLEASE, 0) === F_RDLCK,
        release: () => { control(fd, F_SETLEASE, F_UNLCK); },
      };
    }
    if (process.platform === 'win32') {
      const release = windowsExcludeRecoveryWriters(path);
      return release === null ? null : { held: () => true, release };
    }
  } catch { /* Unsupported filesystem or kernel API. Keep the file. */ }
  return null;
}
