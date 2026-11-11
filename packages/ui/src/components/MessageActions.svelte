<script lang="ts">
  import { Check, Copy, GitFork, Pencil, RotateCcw } from '@lucide/svelte';
  import { contextMenu } from '../lib/context-menu.svelte';
  import { clockTime, fullTime } from '../lib/format';
  import { fill, strings } from '../lib/strings';

  /**
   * The small buttons and send time a message shows under itself while the
   * pointer is on it, or with its time under a finger: copy what it says, and for a turn the ways back
   * into it. Each action is offered only when its caller hands it over.
   */
  let {
    text,
    at,
    edit,
    fork,
    retry
  }: {
    /**
     * What the copy button puts on the clipboard; empty hides it. A function is
     * read at the click, so a streaming answer is not joined on every token.
     */
    text: string | (() => string);
    /** When the message was sent, shown as a clock and read in full on hover. */
    at?: number;
    /** Puts the prompt back in the composer to send again from before it. */
    edit?: () => void;
    /** Starts a new thread from here, in the same checkout or a worktree of its own. */
    fork?: (worktree: boolean) => void;
    /** Sends the same prompt again in place of this answer. */
    retry?: () => void;
  } = $props();

  let copied = $state(false);
  let reset = 0;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
    } catch {
      return;
    }
    copied = true;
    clearTimeout(reset);
    reset = window.setTimeout(() => { copied = false; }, 1500);
  }

  $effect(() => () => clearTimeout(reset));

  function openFork(event: MouseEvent): void {
    contextMenu.open(event, [
      { id: 'here', label: strings.chat.forkHere },
      { id: 'worktree', label: strings.chat.forkWorktree }
    ], (id) => fork?.(id === 'worktree'));
  }

  const actions = $derived([
    { id: 'copy', label: copied ? strings.chat.copied : strings.chat.copyMessage, icon: copied ? Check : Copy, run: text ? copy : undefined },
    { id: 'edit', label: strings.chat.editMessage, icon: Pencil, run: edit },
    { id: 'retry', label: strings.chat.retry, icon: RotateCcw, run: retry },
    { id: 'fork', label: strings.chat.fork, icon: GitFork, run: fork ? openFork : undefined }
  ].filter(action => action.run));
</script>

<span class="message-actions" data-testid="message-actions">
  {#if at !== undefined}
    {@const full = fullTime(at)}
    <time class="stamp" data-testid="message-time" datetime={new Date(at).toISOString()} title={fill(strings.chat.sentAt, { time: full })}>{clockTime(at)}</time>
  {/if}
  {#each actions as action (action.id)}
    <button type="button" class="act icon-button" data-testid={`message-${action.id}`} title={action.label} aria-label={action.label} aria-haspopup={action.id === 'fork' ? 'menu' : undefined} onclick={action.run}><action.icon size={14} /></button>
  {/each}
</span>

<style>
  /* Out of the way until the message is pointed at or reached by the keyboard. */
  .message-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  /* The send time is read when wanted, like the buttons. */
  .act, .stamp { opacity: 0; transition: opacity var(--dur-2); }

  :global(.message:hover) .act,
  :global(.message:hover) .stamp,
  .message-actions:focus-within .act,
  .message-actions:focus-within .stamp,
  /* With no button to reach, a keyboard could never show the time: it stays. */
  .message-actions:not(:has(.act)) .stamp {
    opacity: 1;
  }

  /* A finger has no hover: the buttons and the clock show together, so a button never stands alone under a
     message (a phone shows them under the latest messages and the one tapped, app.css). */
  @media (hover: none) {
    .act, .stamp { opacity: 1; }
  }

  .stamp {
    order: 1;
    margin: 0 4px;
    font-size: var(--text-sm);
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* The app's one icon button (app.css `button.icon-button`): its drawn box overhangs the row under the
     message, which keeps the gap's height, and its target reaches the gaps around it. */
  .act { margin-block: calc((var(--chat-message-gap) - var(--icon-button)) / 2); }

  @media (pointer: coarse), (max-width: 720px) {
    .message-actions { gap: 4px; }
  }
</style>
