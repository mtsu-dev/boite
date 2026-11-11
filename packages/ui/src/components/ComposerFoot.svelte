<script lang="ts">
  import { textEntries, type ComposerState } from '../lib/composer-queue';
  import type { Store } from '../lib/store.svelte';
  import AgentDock from './AgentDock.svelte';
  import ComposerQueue from './ComposerQueue.svelte';

  /**
   * What waits, in one container on the composer card's top edge, one row
   * each and only the rows that apply: the permission out of view by its
   * title (`DecisionPill`, loaded with the first permission: its titles stay
   * out of the entry chunk), the subagents and workflows this thread waits on
   * (`AgentDock`), then the answers held for the turn and the queued prompts
   * (`ComposerQueue`). It grows upward: the field under it never moves.
   */
  let { store, key, thread, composer, blocked, alone = false, machine, sendNow, onrestore, onsendnow }: {
    store: Store;
    key: string;
    thread: Store['openThread'];
    composer: ComposerState | undefined;
    /** A prompt comes back only into an empty box. */
    blocked: boolean;
    /** No card under it (a notice stands in the box's place): the foot closes on its own edge. */
    alone?: boolean;
    machine: string;
    sendNow: 'steer' | 'resume' | null;
    onrestore: (at: number) => void;
    onsendnow: () => void;
  } = $props();

  const answerEntries = textEntries();
  let answers = $derived(thread?.pendingAnswers?.length ? thread.pendingAnswers : null);
  let queued = $derived(composer && composer.queued.length > 0 ? composer : null);
  let permission = $derived(thread ? store.pendingPermissions.find((request) => request.threadId === thread.id) ?? null : null);
</script>

<div class="foot" class:alone data-testid="composer-foot">
  {#if permission}{#await import('./DecisionPill.svelte') then pill}<pill.default {permission} />{/await}{/if}
  {#if thread}<AgentDock {store} threadId={thread.id} />{/if}
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
</div>

<style>
  /* On the card's top edge: its width, its surface and edge, the top corners
     rounded and no gap, so card and foot read as one object (Composer squares
     the card's top corners under it). A hairline between rows. */
  .foot {
    --foot-row: 32px;
    --foot-radius: var(--radius-composer);
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--content);
    min-width: 0;
    margin: 0 auto;
    border: 1px solid var(--color-composer-edge);
    border-bottom: none;
    border-radius: var(--foot-radius) var(--foot-radius) 0 0;
    background: var(--color-composer-surface);
    font-size: var(--text-sm);
    animation: rise var(--motion-duration) var(--motion-curve);
  }
  .foot.alone { margin-bottom: 8px; border-bottom: 1px solid var(--color-composer-edge); border-radius: var(--foot-radius); }
  .foot:not(:has(.foot-row)) { display: none; }
  .foot > :global(* + *),
  .held > :global(* + *),
  .foot :global(.queued > .foot-row + .foot-row) { border-top: 1px solid var(--color-border); }
  .answers { display: flex; flex-direction: column; min-width: 0; }

  /* One row form for all of them: its height, its inset and type, one line. */
  .foot :global(.foot-row) {
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
    .foot { --foot-row: 40px; --foot-radius: var(--radius-xl); }
    .foot :global(.foot-row) { padding: 0 2px 0 12px; }
  }
</style>
