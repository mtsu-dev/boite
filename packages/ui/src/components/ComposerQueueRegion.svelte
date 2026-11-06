<script lang="ts">
  import { textEntries, type ComposerState } from '../lib/composer-queue';
  import type { Store } from '../lib/store.svelte';
  import ComposerQueue from './ComposerQueue.svelte';

  /**
   * What waits above the box: the answers to a question held for the turn,
   * then the prompts queued behind it. The region keeps clear of the activity
   * band docked over the composer, `room` pixels tall.
   */
  let { store, key, thread, composer, room, blocked, machine, sendNow, onrestore, onsendnow }: {
    store: Store;
    key: string;
    thread: Store['openThread'];
    composer: ComposerState | undefined;
    /** The activity band's height while something is queued, else null. */
    room: number | null;
    /** A prompt comes back only into an empty box. */
    blocked: boolean;
    machine: string;
    sendNow: 'steer' | 'resume' | null;
    onrestore: (at: number) => void;
    onsendnow: () => void;
  } = $props();

  const answerEntries = textEntries();
</script>

<div class="queue-region" style:padding-bottom={room !== null ? `${room}px` : undefined}>
  {#if thread?.pendingAnswers?.length}
    <div data-testid="question-queued">
      <ComposerQueue queued={answerEntries(thread.pendingAnswers)} disabled={true} paused={false} sendNow={null} onrestore={() => {}} onsendnow={() => {}} />
    </div>
  {/if}
  {#if composer && composer.queued.length > 0}
    <ComposerQueue queued={composer.queued}
      disabled={composer.sending || blocked}
      paused={composer.paused} sending={composer.sending} outgoing={composer.outgoing ?? 0} connected={store.connection === 'ready'} {machine} starts={!thread}
      {sendNow}
      {onrestore} onremove={(at) => store.removeQueued(key, at)} onretry={(at) => store.retryQueued(key, at)}
      {onsendnow} />
  {/if}
</div>
