import { fill, strings } from './strings';

/**
 * The composer's placeholder: at rest it names who reads the message; while
 * the agent works or a question waits, what is written replies; while a
 * permission waits on its command row, Send declines it and redirects the
 * agent (Composer's `redirect`). A state that changes what Send does says so
 * instead: the machine is away, or the account is gone. A thread
 * still loading keeps its usual words: the conversation's centre says it loads. `target` is a side box's own text, `bot` the persistent agent
 * whose thread this is.
 */
export function composerPlaceholder(input: {
  target: { placeholder: string } | null;
  /** The agent works, or a question waits at the top of the box. */
  replying: boolean;
  /** A permission of this thread waits on its command row. */
  permission?: boolean;
  /** A phone's field: the permission's words in their short form. */
  narrow?: boolean;
  bot: string | null;
  offline: boolean;
  /** The account behind the box was removed: nothing sends until another is picked. */
  accountGone?: boolean;
  onThread: boolean;
  machine: string;
  provider: string | null;
}): string {
  const t = strings.composer;
  if (input.target) return input.target.placeholder;
  if (input.accountGone) return t.placeholderPickAccount;
  if (input.offline) return fill(input.onThread ? t.placeholderOffline : t.placeholderOfflineDraft, { machine: input.machine });
  if (input.permission) return input.narrow ? t.permissionPlaceholderShort : t.permissionPlaceholder;
  const name = input.bot ?? input.provider ?? t.placeholderAgent;
  return fill(input.replying ? t.replyPlaceholder : t.placeholder, { name });
}
