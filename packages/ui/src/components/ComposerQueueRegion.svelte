<script lang="ts">
  import { textEntries, type ComposerState } from '../lib/composer-queue';
  import type { Store } from '../lib/store.svelte';
  import ComposerQueue from './ComposerQueue.svelte';

  /**
   * The head of the field when something waits to go: the answers held for
   * the turn and the queued prompts, each a quiet chip with its edit and
   * remove. Inside the box, on its surface, not a band over it; the strip
   * above keeps the subagents and the way back.
   */
  let { store, key, thread, composer, blocked, machine, sendNow, onrestore, onsendnow }: {
    store: Store;
    key: string;
    thread: Store['openThread'];
    composer: ComposerState | undefined;
    /** A prompt comes back only into an empty box. */
    blocked: boolean;
    machine: string;
    sendNow: 'steer' | 'resume' | null;
    onrestore: (at: number) => void;
    onsendnow: () => void;
  } = $props();

  const answerEntries = textEntries();
  let answers = $derived(thread?.pendingAnswers?.length ? thread.pendingAnswers : null);
  let queued = $derived(composer && composer.queued.length > 0 ? composer : null);
</script>

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

<style>
  /* Lines on the box's own surface, at the top of the field, starting where its text does: no band of their own. */
  .held { display: flex; flex-direction: column; gap: 0; min-width: 0; padding: var(--deck-gap, 6px) 14px 0; }
  .answers { display: flex; min-width: 0; }
</style>
