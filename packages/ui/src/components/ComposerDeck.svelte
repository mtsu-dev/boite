<script lang="ts">
  import { Check } from '@lucide/svelte';
  import { collapsesOnLeave } from '../lib/arrival';
  import { permissionCard, prefetchPermissionCard } from '../lib/composer-dock';
  import { repliesOf } from '../lib/question-reply.svelte';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import AgentDock from './AgentDock.svelte';
  import Deferred from './Deferred.svelte';
  import ThreadActivity from './ThreadActivity.svelte';

  /**
   * The composer card's head, under one height budget: the subagents' quiet
   * rows, then the decision, the one raised card, then the receipt of an
   * answer just sent. `room` is how tall the subagents' rows stand, which the
   * decision gives up so the conversation keeps its share.
   */
  let { store, thread, agentBox, permissions, docked, room = $bindable(0) }: {
    store: Store;
    thread: Store['openThread'];
    /** The box speaks to an agent: no thread activity under it. */
    agentBox: boolean;
    permissions: Store['pendingPermissions'];
    docked: Store['pendingQuestions'][number] | undefined;
    room?: number;
  } = $props();

  let permission = $derived(permissions[0] ?? null);
  /**
   * The answer just sent while the agent works, by any of its controls
   * (`sendAnswer`): one quiet line where the question stood, so the user sees
   * it went, while the working line goes on. It leaves when the turn ends,
   * another decision docks or the thread changes.
   */
  // Two steps: state a derived creates is not a dependency of that same derived, and the first read may create the replies.
  let replies = $derived(repliesOf(store));
  let receipt = $derived(replies.receipt);
  let receiptShown = $derived(receipt !== null && receipt.threadId === thread?.id && store.busy && !docked && !permission);
  $effect(() => { if (receipt && (receipt.threadId !== thread?.id || !store.busy)) replies.receipt = null; });
  $effect(prefetchPermissionCard);
</script>

<div class="deck" {@attach collapsesOnLeave(() => permissions.length + store.pendingQuestions.filter((question) => question.threadId === thread?.id).length, () => thread?.id)}>
{#if thread}<AgentDock {store} threadId={thread.id} bind:height={room} />{/if}
{#if permission}{#key permission.id}<Deferred part={permissionCard}>{#snippet children(PermissionCard)}<PermissionCard docked toolName={permission.toolName} decision={null} request={permission} answer={(decision) => store.answer(permission.id, decision)} index={1} total={permissions.length} />{/snippet}</Deferred>{/key}{/if}
{#if !agentBox}<ThreadActivity {store} />{/if}
{#if receiptShown && receipt}
  <p class="receipt ui-label" data-testid="answer-receipt" role="status"><Check size={14} strokeWidth={2} aria-hidden="true" /><span>{fill(strings.chat.questionAnswered, { answer: receipt.said })}</span></p>
{/if}
</div>

<style>
  /* The card's head under one budget: on a desktop the whole dock keeps to
     about half of the conversation (`--dock-budget`), room enough for a
     question's four choices; the subagents' rows keep their size and the
     rest scrolls inside it. Empty, it takes no room. */
  .deck { display: flex; flex-direction: column; --dock-inset: 14px; --decision-fill: color-mix(in srgb, var(--color-composer-surface), var(--color-foreground) 9%); }
  .deck > :global(*) { flex: none; }
  .deck > :global(:is(.activity, .decision-card)) { flex: 0 1 auto; min-height: 0; }
  @media (min-width: 721px) {
    .deck { --dock-budget: 55dvh; max-height: max(160px, calc(var(--dock-budget) - 126px)); }
  }
  /* The decision is the strongest surface of the card: a raised tile with a
     faint light on its top edge, inset from the card's sides. The subagents'
     chips above it and the queued line under it sit flat on the card's own
     surface in a quieter ink, so the eye goes decision, then field. */
  .deck :global(.decision-card) {
    border: none;
    border-radius: var(--radius-lg);
    background: var(--decision-fill);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--color-foreground) 9%, transparent);
    --dock-inset: 8px;
  }
  /* Three sections, not nested boxes: the entries, the decision, then one
     inset hairline before the queued line and the field, so drafting reads
     apart from what waits on the owner. */
  .deck:has(> :global(:is(.dock, .decision-card, .activity:not(.hidden), .receipt))) {
    padding-bottom: 8px;
    background: linear-gradient(var(--color-border), var(--color-border)) no-repeat center bottom / calc(100% - 2 * var(--dock-inset)) 1px;
  }
  /* The answer as sent: one quiet line in the dock's own ink, cut to one line, its check where the question's dot stood. */
  .receipt { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0; padding: var(--deck-gap) var(--dock-inset) 0; color: var(--color-subtle); font-size: var(--text-meta); }
  .receipt span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .receipt :global(svg) { flex: none; color: var(--color-success); }
  /* One gap scale in every combination: each block of the card (the
     subagents' entries, the decision, the receipt, the queued line) stands
     `--deck-gap` (Composer) under the one above it and adds nothing under
     itself, so the field's own top inset is the one space before its text. A
     permission sits in the deck itself, a question's tile in ThreadActivity's
     section: both take the same inset here. */
  .deck > :global(.decision-card) { margin: var(--deck-gap) 6px 0; overflow-y: auto; overscroll-behavior: contain; }
  :global(.composer) .deck > :global(.activity) { padding: 0 6px; }
  :global(.composer) .deck > :global(.activity > *:first-child) { margin-top: var(--deck-gap); }
  :global(.composer) .deck > :global(.activity > .decision-card) { margin: var(--deck-gap) 0 0; }
  :global(.composer) .deck > :global(.activity > .decision-card:last-child) { margin-bottom: 0; }
  :global(.composer) .deck > :global(.activity > .decision-card + *) { margin-top: var(--deck-gap); }
</style>
