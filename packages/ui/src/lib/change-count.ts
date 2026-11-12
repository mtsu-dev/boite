import { fill, strings } from './strings';

/**
 * The one way a set of changes is counted out loud, in the chat, a tool card's
 * diff and the Changes panel alike: "1 file, +7 −2". A side with nothing on it
 * is left out ("+1", never "+1 -0"), and an unknown side (null) too.
 */
export interface ChangeCount {
  /** "1 file", "6 files", or null where the count is about one file already named. */
  files: string | null;
  added: string | null;
  removed: string | null;
}

export function changeCount(files: number | null, added: number | null, removed: number | null): ChangeCount {
  return {
    files: files === null ? null : files === 1 ? strings.changes.oneFile : fill(strings.changes.files, { count: String(files) }),
    added: added ? fill(strings.chat.diffAdded, { count: String(added) }) : null,
    removed: removed ? fill(strings.chat.diffRemoved, { count: String(removed) }) : null
  };
}

/** The same count as one line of text, for a menu row's hint or a tooltip. */
export function changeText(count: ChangeCount): string {
  const lines = [count.added, count.removed].filter(Boolean).join(' ');
  return [count.files, lines].filter(Boolean).join(', ');
}
