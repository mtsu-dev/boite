<script lang="ts" module>
  /** The kinds of card Activity holds (lib/activity-feed.ts's, and a contact's ask or held message). */
  export type ActivityKindName = 'permission' | 'question' | 'request' | 'mail' | 'failed' | 'stopped' | 'done';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { CircleAlert, CircleCheck, CircleStop, KeyRound, Mail, MessageCircleQuestionMark, UserRound } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * The first line of an Activity card: its kind with its glyph ("Permission", "Question", "Contact request",
   * "Failed"), so the verbs under it (Allow once, Answer, Accept, Review) are expected. A Needs you card says it in
   * the muted ink; an update (`news`) leads with what happened in the primary ink, its time after it (`children`).
   * The glyphs are the composer's own for a permission and a question (ThreadDecision.svelte).
   */
  let { kind, news = false, children }: { kind: ActivityKindName; news?: boolean; children?: Snippet } = $props();
  const glyphs = { permission: KeyRound, question: MessageCircleQuestionMark, request: UserRound, mail: Mail, failed: CircleAlert, stopped: CircleStop, done: CircleCheck };
  const Glyph = $derived(glyphs[kind]);
</script>

<span class="activity-kind" class:alarm={kind === 'failed'} class:news data-testid="activity-kind" data-kind={kind}><Glyph size={13} strokeWidth={2} aria-hidden="true" /><span class="ui-label">{strings.activity.kind[kind]}</span>{@render children?.()}</span>

<style>
  /* The glyph's 13 px and the 6 px gap are the column every card's mark and words keep (ActivityMark.svelte). */
  .activity-kind { display: flex; align-items: center; gap: 6px; min-width: 0; height: 16px; font-size: var(--text-xs); font-weight: 500; line-height: 16px; color: var(--color-muted-foreground); white-space: nowrap; }
  .activity-kind :global(svg) { flex: none; }
  /* A failure's glyph in the danger ink, the row's "!" mark's; the word stays muted. */
  .alarm :global(svg) { color: var(--color-danger); }
  /* An update's event reads first, in the title's ink; its time stays the secondary ink, a step off it. */
  .news { color: var(--color-foreground); }
  .news :global(svg) { color: var(--color-muted-foreground); }
  .news :global(time) { margin-left: 2px; color: var(--color-subtle); font-weight: 400; font-variant-numeric: tabular-nums; }
</style>
