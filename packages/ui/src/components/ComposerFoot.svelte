<script lang="ts">
  import { textEntries, type ComposerState } from '../lib/composer-queue';
  import type { Store } from '../lib/store.svelte';
  import AgentDock from './AgentDock.svelte';
  import ComposerQueue from './ComposerQueue.svelte';
  import Deferred from './Deferred.svelte';
  import { permissionCard } from '../lib/idle-parts';

  /**
   * What waits, over the composer card. The permission out of view is the one
   * card, on the composer card's top edge, by its title (`DecisionPill`, loaded
   * with the first permission: its titles stay out of the entry chunk) with its
   * Deny and Allow once. Above it, outside the card, one quiet strip: the work
   * this thread waits on in one line ("3 working", `AgentDock`), the same on a
   * desktop and a phone, that a press unfolds into one row per run. Under it,
   * always in view, the prompts held for the turn, drawn where they will land
   * (`ComposerQueue`): dashed user bubbles on the right, a press taking one
   * back into the box. A subagent's command waiting for approval has no row
   * in this timeline: its card stands here, named by the subagent, answered
   * in place. It grows upward: the field under it never moves. While
   * a question takes the field during a turn, the field's button is Send
   * alone, so the turn's Stop is on the strip's line.
   */
  let { store, key, thread, composer, blocked, alone = false, stopsTurn = false, machine, sendNow, onrestore, onsendnow }: {
    store: Store;
    key: string;
    thread: Store['openThread'];
    composer: ComposerState | undefined;
    /** A prompt comes back only into an empty box. */
    blocked: boolean;
    /** No card under it (a notice stands in the box's place): the foot closes on its own edge. */
    alone?: boolean;
    /** A question takes the field while the turn runs: the strip's line carries the turn's Stop, alone ("Working") or with what it waits on. */
    stopsTurn?: boolean;
    machine: string;
    sendNow: 'steer' | 'resume' | null;
    onrestore: (at: number) => void;
    onsendnow: () => void;
  } = $props();

  const answerEntries = textEntries();
  let answers = $derived(thread?.pendingAnswers?.length ? thread.pendingAnswers : null);
  let queued = $derived(composer && composer.queued.length > 0 ? composer : null);
  let permission = $derived(thread ? store.pendingPermissions.find((request) => request.threadId === thread.id) ?? null : null);
  /** What this thread's subagents wait on approval for: the thread's row says "Needs you", so the ask shows here, where it is read. */
  let kids = $derived(thread ? new Map(store.threads.filter((row) => row.parentThreadId === thread.id && !row.archived).map((row) => [row.id, row] as const)) : null);
  let childAsks = $derived(kids?.size ? store.pendingPermissions.filter((request) => kids.has(request.threadId)) : []);

  let open = $state(false);
  // Another thread opens folded.
  $effect(() => { void thread?.id; open = false; });
</script>

<div class="strip-lines" data-testid="composer-strip-lines">
  {#if thread}<AgentDock {store} threadId={thread.id} turn={stopsTurn} {open} ontoggle={() => (open = !open)} />{/if}
</div>
{#if answers || queued}
  <div class="held" data-testid="composer-held">
    {#if answers}
      <div class="answers" data-testid="question-queued">
        <ComposerQueue queued={answerEntries(answers)} disabled={true} paused={false} sendNow={null} onrestore={() => {}} onsendnow={() => {}} />
      </div>
    {/if}
    {#if queued}
      <ComposerQueue queued={queued.queued}
        disabled={queued.sending || blocked}
        paused={queued.paused} sending={queued.sending} outgoing={queued.outgoing ?? 0} connected={store.connection === 'ready'} {machine} starts={!thread}
        {sendNow}
        {onrestore} onremove={(at) => store.removeQueued(key, at)} onretry={(at) => store.retryQueued(key, at)}
        {onsendnow} />
    {/if}
  </div>
{/if}
{#if childAsks.length}
  <div class="child-asks" data-testid="subagent-permissions">
    {#each childAsks as request (request.id)}
      {@const child = kids?.get(request.threadId)}
      <Deferred part={permissionCard}>{#snippet children(PermissionCard)}<PermissionCard toolName={request.toolName} decision={null} {request}
        answer={(decision) => store.answer(request.id, decision)}
        asker={{ title: child?.title ?? '', open: () => { void store.open(request.threadId); } }} />{/snippet}</Deferred>
    {/each}
  </div>
{/if}
<div class="foot" class:alone data-testid="composer-foot">
  {#if permission}{#await import('./DecisionPill.svelte') then pill}<pill.default {permission} answer={(decision: 'allow' | 'deny') => store.answer(permission.id, decision)} />{/await}{/if}
</div>

<style>
  .strip-lines, .foot {
    --foot-radius: var(--radius-composer);
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--content);
    min-width: 0;
    margin: 0 auto;
    font-size: var(--text-sm);
  }
  /* The strip: no surface of its own, the quiet ink of a status line, its rows
     lined up with the card's words under it. */
  .strip-lines { --foot-row: 28px; padding: 0 2px 4px; color: var(--color-muted-foreground); font-size: var(--text-meta); }
  .strip-lines:not(:has(.foot-row)) { display: none; }
  /* The held prompts keep the conversation's width, right-aligned like the bubbles they will become. */
  .held { display: flex; flex-direction: column; width: 100%; max-width: var(--content); min-width: 0; margin: 0 auto; }
  .answers { display: flex; flex-direction: column; min-width: 0; }
  /* The subagents' asks: the conversation's width, never taller than a third of the window, the rest scrolls. */
  .child-asks { display: flex; flex-direction: column; flex: none; width: 100%; max-width: var(--content); min-width: 0; max-height: 36vh; margin: 0 auto; padding-bottom: 4px; overflow-y: auto; scrollbar-width: thin; }

  /* The card: on the composer card's top edge, its width, its surface and edge,
     the top corners rounded and no gap, so card and foot read as one object
     (Composer squares the card's top corners under it). */
  .foot {
    --foot-row: 32px;
    border: 1px solid var(--color-composer-edge);
    border-bottom: none;
    border-radius: var(--foot-radius) var(--foot-radius) 0 0;
    background: var(--color-composer-surface);
    animation: rise var(--motion-duration) var(--motion-curve);
  }
  .foot.alone { margin-bottom: 8px; border-bottom: 1px solid var(--color-composer-edge); border-radius: var(--foot-radius); }
  .foot:not(:has(.foot-row)) { display: none; }

  /* One row form for all of them: its height, its inset and type, one line. */
  :is(.strip-lines, .foot) :global(.foot-row) {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: var(--foot-row);
    min-width: 0;
    padding: 0 6px 0 14px;
    white-space: nowrap;
  }
  @media (max-width: 720px) {
    .strip-lines { --foot-row: 36px; }
    .foot { --foot-row: 40px; --foot-radius: var(--radius-xl); }
    :is(.strip-lines, .foot) :global(.foot-row) { padding: 0 2px 0 12px; }
    /* The strip's line holds its counts and Stop on a 360 px phone. */
    .strip-lines :global(.foot-row) { gap: 6px; }
  }
</style>
