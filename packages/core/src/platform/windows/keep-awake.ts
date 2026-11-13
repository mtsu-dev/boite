/**
 * The sleep inhibitor of Windows: `SetThreadExecutionState` with
 * `ES_SYSTEM_REQUIRED` keeps the system out of idle sleep until the same
 * thread clears it. The core calls both from its one JavaScript thread, and
 * the state ends with the process, so a core that dies holds nothing. The
 * display may still turn off, and a sleep the user orders still happens.
 */
import { dlopen, FFIType } from 'bun:ffi';

const ES_SYSTEM_REQUIRED = 0x0000_0001;
const ES_CONTINUOUS = 0x8000_0000;

let kernel: { SetThreadExecutionState(flags: number): number } | null = null;

/** Holds the inhibitor until the returned function is called; null when Windows refused. */
export function windowsKeepAwake(): (() => void) | null {
  kernel ??= dlopen('kernel32.dll', { SetThreadExecutionState: { args: [FFIType.u32], returns: FFIType.u32 } }).symbols;
  // Zero is the call's failure; the previous state otherwise, which always carries ES_CONTINUOUS.
  if (kernel.SetThreadExecutionState((ES_CONTINUOUS | ES_SYSTEM_REQUIRED) >>> 0) === 0) return null;
  return () => { kernel!.SetThreadExecutionState(ES_CONTINUOUS); };
}
