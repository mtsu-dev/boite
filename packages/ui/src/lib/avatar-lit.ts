/*
 * When a bot's picture shows its colours (the owner's rule, 2026-11-08): it is
 * grey everywhere at rest (the rail, the lists, the Bots page, its desk, the
 * palette, Activity, the phone's tabs and sheets) and lit only for the open
 * bot and while it has something for the owner: a question or a permission,
 * a failure, answers not read. Hover lights it too, in `AgentAvatar.svelte`'s
 * style, since only CSS knows the pointer.
 */

export interface AvatarFacts {
  /** The open bot, or the one a screen is about. */
  open?: boolean;
  /** It waits on the owner: a question, a permission. */
  attention?: boolean;
  failed?: boolean;
  /** Answers not read: a count or a flag. */
  unread?: number | boolean;
}

export type LitReason = 'open' | 'attention' | 'failed' | 'unread';

/** Why the picture is lit, the strongest reason first; null keeps it grey. */
export function litReason(facts: AvatarFacts): LitReason | null {
  if (facts.open) return 'open';
  if (facts.attention) return 'attention';
  if (facts.failed) return 'failed';
  if (typeof facts.unread === 'number' ? facts.unread > 0 : facts.unread) return 'unread';
  return null;
}

export function avatarLit(facts: AvatarFacts): boolean {
  return litReason(facts) !== null;
}

/** The facts a mood carries: a ring that waits, failed or has news lights the picture it rings. */
export function moodFacts(mood: string | undefined): AvatarFacts {
  return { attention: mood === 'waiting', failed: mood === 'error' || mood === 'failed', unread: mood === 'unread' };
}
