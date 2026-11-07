<script lang="ts">
  import { textEntries, type ComposerState } from '../lib/composer-queue';
  import { errorText } from '../lib/errors';
  import type { Store } from '../lib/store.svelte';
  import AgentDock from './AgentDock.svelte';
  import ComposerQueue from './ComposerQueue.svelte';
  import JumpLatest from './JumpLatest.svelte';
  import UndoToast from './UndoToast.svelte';

  /**
   * The strip above the box, one band in the flow so it never covers a line
   * of the timeline: the thread's subagents and workflows, each by name, the
   * answers held for the turn, the queued prompts, then at its right the way
   * back to the latest message and, in a thread, the archive's undo. An
   * agent's own box (`main` false) keeps its queue alone.
   */
  let { store, key, thread, composer, main = true, blocked, machine, sendNow, onrestore, onsendnow }: {
    store: Store;
    key: string;
    thread: Store['openThread'];
    composer: ComposerState | undefined;
    main?: boolean;
    /** A prompt comes back only into an empty box. */
    blocked: boolean;
    machine: string;
    sendNow: 'steer' | 'resume' | null;
    onrestore: (at: number) => void;
    onsendnow: () => void;
  } = $props();

  const answerEntries = textEntries();
</script>

<div class="strip" class:reserved={main && !!thread} data-testid="composer-strip">
  {#if main && thread}<AgentDock {store} threadId={thread.id} />{/if}
  {#if thread?.pendingAnswers?.length}
    <div class="answers" data-testid="question-queued">
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
  {#if main}
    <span class="spacer"></span>
    <JumpLatest />
    {#if thread}<UndoToast inline onerror={(error) => (store.error = errorText(error))} />{/if}
  {/if}
</div>

<style>
  /* Anything in it stands on a 30 px row. A thread keeps the row reserved, so
     the way back coming and going never moves the timeline; elsewhere an
     empty strip takes no room. */
  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: var(--content);
    margin: 0 auto;
  }

  .strip.reserved, .strip:has(> :not(.spacer)) { min-height: 38px; padding-bottom: 8px; }
  .spacer { flex: 1 0 0; }
  .answers { display: flex; min-width: 0; }
</style>
