/**
 * A Toolhelp process snapshot, read for discovery only: its pids and parent pids
 * are hints that a later handle-verified walk confirms or drops. A pid it names
 * may already be gone, or belong to a later process, by the time it is opened.
 */

export interface ProcessSnapshotApi {
  /** `CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS)`, 0 when it failed. */
  snapshot(): number;
  firstProcess(snapshot: number, entry: Uint8Array): boolean;
  nextProcess(snapshot: number, entry: Uint8Array): boolean;
  lastError(): number;
  close(handle: number): void;
}

/** `sizeof(PROCESSENTRY32W)` on 64-bit Windows, the only Windows Boite ships for. */
export const PROCESS_ENTRY_SIZE = 568;
const OFF_PROCESS_ID = 8;
const OFF_PARENT_PROCESS_ID = 32;
const ERROR_NO_MORE_FILES = 18;
/** A machine listing more processes than this is read as incomplete. */
export const MAX_SNAPSHOT_PROCESSES = 65_536;

/**
 * The pids each pid is listed as the parent of, or null when the snapshot could
 * not be taken or read to its end: a partial list authorizes nothing.
 */
export function snapshotChildren(api: ProcessSnapshotApi): Map<number, number[]> | null {
  const snapshot = api.snapshot();
  if (!snapshot) return null;
  try {
    const entry = new Uint8Array(PROCESS_ENTRY_SIZE);
    const view = new DataView(entry.buffer);
    const children = new Map<number, number[]>();
    view.setUint32(0, PROCESS_ENTRY_SIZE, true);
    let more = api.firstProcess(snapshot, entry);
    for (let read = 0; more; read += 1) {
      if (read >= MAX_SNAPSHOT_PROCESSES) return null;
      const pid = view.getUint32(OFF_PROCESS_ID, true);
      const parent = view.getUint32(OFF_PARENT_PROCESS_ID, true);
      if (pid > 0 && parent > 0 && pid !== parent) {
        const siblings = children.get(parent) ?? [];
        siblings.push(pid);
        children.set(parent, siblings);
      }
      view.setUint32(0, PROCESS_ENTRY_SIZE, true);
      more = api.nextProcess(snapshot, entry);
    }
    return api.lastError() === ERROR_NO_MORE_FILES ? children : null;
  } finally {
    api.close(snapshot);
  }
}
