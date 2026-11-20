import { dlopen, FFIType } from 'bun:ffi';
import { constants } from 'node:os';
import { windowsExcludeRecoveryWriters } from './windows/file-lock.ts';

function linuxFileControl() {
  return dlopen('libc.so.6', {
    fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  }).symbols.fcntl;
}

let fcntl: ReturnType<typeof linuxFileControl> | undefined;

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
