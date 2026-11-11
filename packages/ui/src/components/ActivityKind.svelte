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
   * "Failed", "Finished"), so the verbs under it (Allow once, Answer, Accept, Review) are expected. The glyph is the
   * card's one mark, in the hue of the state the rows wear: amber for the user's turn, the danger ink for a failure,
   * the quiet ink for news. The word is the card's small secondary label; an update's time follows it (`children`).
   * The glyphs are the composer's own for a permission and a question (ThreadDecision.svelte).
   */
  let { kind, children }: { kind: ActivityKindName; children?: Snippet } = $props();
  const glyphs = { permission: KeyRound, question: MessageCircleQuestionMark, request: UserRound, mail: Mail, failed: CircleAlert, stopped: CircleStop, done: CircleCheck };
  const Glyph = $derived(glyphs[kind]);
  const tone = $derived(kind === 'failed' ? 'alarm' : kind === 'stopped' || kind === 'done' ? 'news' : 'turn');
</script>

<span class="activity-kind {tone}" data-testid="activity-kind" data-kind={kind}><Glyph size={13} strokeWidth={2} aria-hidden="true" /><span class="ui-label">{strings.activity.kind[kind]}</span>{@render children?.()}</span>

<style>
  /* The glyph's 13 px and the 6 px gap are the indent every line of the card keeps under the word. */
  .activity-kind { display: flex; align-items: center; gap: 6px; min-width: 0; height: 16px; font-size: var(--text-meta); font-weight: 400; line-height: 16px; color: var(--color-muted-foreground); white-space: nowrap; }
  .activity-kind :global(svg) { flex: none; }
  .turn :global(svg) { color: var(--color-live); }
  .alarm :global(svg) { color: var(--color-danger); }
  .news :global(svg) { color: var(--color-subtle); }
  .activity-kind :global(time) { margin-left: 2px; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
</style>
