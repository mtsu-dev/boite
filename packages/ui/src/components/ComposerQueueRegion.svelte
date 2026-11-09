<script lang="ts">
  import { textEntries, type ComposerState } from '../lib/composer-queue';
  import type { Store } from '../lib/store.svelte';
  import ComposerQueue from './ComposerQueue.svelte';

  /**
   * What waits to go, right above the composer card: the answers held for
   * the turn and the queued prompts, one row each with its actions. The box
   * itself keeps only its subagents' entries, its field and its chips.
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
  /* In the reading column, over the card, six pixels above it. */
  .held { display: flex; flex-direction: column; gap: 4px; width: 100%; min-width: 0; max-width: var(--content); margin: 0 auto 6px; }
  .answers { display: flex; min-width: 0; }
</style>
