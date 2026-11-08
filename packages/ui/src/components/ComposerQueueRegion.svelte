<script lang="ts">
  import { textEntries, type ComposerState } from '../lib/composer-queue';
  import type { Store } from '../lib/store.svelte';
  import ComposerQueue from './ComposerQueue.svelte';

  /**
   * The head of the box when something waits to go: the answers held for the
   * turn and the queued prompts, each one quiet line with its edit and remove.
   * Inside the box, not a row of pills over it; the strip above keeps the
   * subagents and the way back.
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
  /* The box's own padding, a hairline under it: the head reads apart from the field. */
  .held { display: flex; flex-direction: column; min-width: 0; padding: 2px 8px 2px 12px; border-bottom: 1px solid var(--color-border); }
  .answers { display: flex; min-width: 0; }
</style>
