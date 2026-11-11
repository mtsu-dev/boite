<script lang="ts" module>
  /** The kinds of decision Activity's Needs you cards hold (lib/activity-feed.ts's, and a contact's ask or held message). */
  export type ActivityKindName = 'permission' | 'question' | 'request' | 'mail' | 'failed' | 'stopped';
</script>

<script lang="ts">
  import { CircleAlert, CircleStop, KeyRound, Mail, MessageCircleQuestionMark, UserRound } from '@lucide/svelte';
  import { strings } from '../lib/strings';

  /**
   * The first line of a Needs you card: its kind in muted ink with its glyph ("Permission", "Question", "Contact
   * request", "Failed"), so the verbs under it (Allow once, Answer, Accept, Review) are expected. The glyphs are the
   * composer's own for a permission and a question (ThreadDecision.svelte).
   */
  let { kind }: { kind: ActivityKindName } = $props();
  const glyphs = { permission: KeyRound, question: MessageCircleQuestionMark, request: UserRound, mail: Mail, failed: CircleAlert, stopped: CircleStop };
  const Glyph = $derived(glyphs[kind]);
</script>

<span class="activity-kind" class:alarm={kind === 'failed'} data-testid="activity-kind" data-kind={kind}><Glyph size={13} strokeWidth={2} aria-hidden="true" /><span class="ui-label">{strings.activity.kind[kind]}</span></span>

<style>
  .activity-kind { display: flex; align-items: center; gap: 6px; min-width: 0; height: 16px; font-size: var(--text-xs); font-weight: 500; line-height: 16px; color: var(--color-muted-foreground); white-space: nowrap; }
  .activity-kind :global(svg) { flex: none; }
  /* A failure's glyph in the danger ink, the row's "!" mark's; the word stays muted. */
  .alarm :global(svg) { color: var(--color-danger); }
</style>
