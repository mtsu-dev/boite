import { fill, strings } from './strings';

/**
 * The composer's placeholder, two at most: at rest it names who reads the
 * message; while the agent works or a decision (a question, an ask to run a
 * tool) waits, what is written replies. A state that changes what Send does
 * says so instead: the machine is away, or the thread has no folder left to
 * run in. `target` is a side box's own text, `bot` the persistent agent
 * whose thread this is.
 */
export function composerPlaceholder(input: {
  target: { placeholder: string } | null;
  /** The agent works, or a decision waits above the box. */
  replying: boolean;
  bot: string | null;
  offline: boolean;
  /** The thread's folder or worktree is gone: nothing can run here. */
  noFolder?: boolean;
  onThread: boolean;
  machine: string;
  provider: string | null;
}): string {
  const t = strings.composer;
  if (input.target) return input.target.placeholder;
  if (input.noFolder) return t.placeholderNoFolder;
  if (input.offline) return fill(input.onThread ? t.placeholderOffline : t.placeholderOfflineDraft, { machine: input.machine });
  const name = input.bot ?? input.provider ?? t.placeholderAgent;
  return fill(input.replying ? t.replyPlaceholder : t.placeholder, { name });
}
