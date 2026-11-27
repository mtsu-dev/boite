import { existsSync, readdirSync, readFileSync } from 'node:fs';

/**
 * Files as a reader sees them: the disk, or the disk as a pending change will leave it (`restoredView` in
 * `threads/checkpoint-files.ts`), so a check that must pass before the change reads its result without writing.
 */
export interface FileView {
  /** The text of the file at `path`, or null when it is missing or unreadable. */
  read(path: string): string | null;
  exists(path: string): boolean;
  /** Whether the directory at `path` holds any entry. */
  listsAny(path: string): boolean;
  /**
   * Whether the way to `path` crosses a symbolic link, a junction or another spelling of the folder that only the
   * system resolves. A view that predicts files reads none of those: the caller leaves such a path to the program.
   */
  linked(path: string): boolean;
}

export const DISK_VIEW: FileView = {
  read: path => { try { return readFileSync(path, 'utf8'); } catch { return null; } },
  exists: path => existsSync(path),
  listsAny: path => { try { return readdirSync(path).length > 0; } catch { return false; } },
  linked: () => false,
};
