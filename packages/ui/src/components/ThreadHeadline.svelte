<script lang="ts">
  import { PencilLine, Pin } from '@lucide/svelte';
  import type { Project, ThreadSummary } from '@boite/contracts';
  import type { Machine } from '../lib/workspace.svelte';
  import type { Store } from '../lib/store.svelte';
  import { hasUnsentDraft } from '../lib/composer-queue';
  import { threadState } from '../lib/thread-state';
  import { strings } from '../lib/strings';
  import MachineIcon from './MachineIcon.svelte';
  import ProjectTile from './ProjectTile.svelte';
  import ThreadPicture from './ThreadPicture.svelte';
  import ThreadState from './ThreadState.svelte';

  /**
   * A thread row's first line, in the sidebar and in a phone's list: who runs
   * it (the agent it belongs or was entrusted to, else the
   * provider's logo, whose tooltip names the provider and the model), the
   * title, an unsent draft, the pin, then the state or the time. The Recent
   * list shows the project's tile in the picture's place and one marker for
   * the state (`tile`, `mark`).
   */
  let {
    owner,
    thread,
    now,
    machine,
    open = false,
    wrap = false,
    picture = true,
    tile,
    mark = false
  }: {
    owner: Store;
    thread: ThreadSummary;
    /** Without it the row draws the state itself, elsewhere. */
    now?: number;
    /** The machine's icon before the picture, once there are two machines. */
    machine?: Machine;
    /** The open thread shows its box: its row marks no draft. */
    open?: boolean;
    /** A phone's list: the title wraps over several lines instead of ending in an ellipsis. */
    wrap?: boolean;
    /** A phone's row draws the picture itself, in a tile beside the lines. */
    picture?: boolean;
    /** The project's tile where the picture goes. */
    tile?: Project;
    /** The state as one marker instead of words. */
    mark?: boolean;
  } = $props();
  let draft = $derived(!open && hasUnsentDraft(owner.composerStates[thread.id]));
</script>

<span class="headline" class:wrap class:unread={thread.unread && !wrap} class:hot={open || threadState(thread, owner.subagents(thread.id)) !== null}>
  {#if machine}
    <span class="machine" class:offline={owner.connection !== 'ready'}
      title={`${machine.label} · ${strings.connection[owner.connection]}`} aria-label={machine.label}>
      <MachineIcon icon={machine.icon} os={owner.core?.os} />
    </span>
  {/if}
  {#if tile}<ProjectTile project={tile} store={owner} size={16} />{:else if picture}<ThreadPicture {owner} {thread} size={wrap ? 13 : 14} />{/if}
  <span class="title" class:ui-label={!wrap}>{thread.title}</span>
  {#if draft}<span class="draft" data-testid="thread-draft" title={strings.sidebar.unsentDraft} aria-label={strings.sidebar.unsentDraft}><PencilLine size={12} /></span>{/if}
  {#if thread.pinned}<span class="pin"><Pin size={12} /></span>{/if}
  {#if now !== undefined}<ThreadState {thread} {now} {mark} subagents={owner.subagents(thread.id)} away={owner.connection !== 'ready'} />{/if}
</span>

<style>
  .headline {
    display: flex;
    align-items: center;
    min-height: 20px; /* Keep the row stable when machine glyphs appear. */
    gap: 8px;
    min-width: 0;
  }
  .title {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-foreground);
    font-weight: 400;
  }
  /* In the list, a row at rest reads a step back; one with a state to show reads at full strength. */
  .headline:not(.wrap) .title {
    color: var(--color-muted-foreground);
    font-weight: 500;
  }
  .headline.unread:not(.wrap) .title,
  .headline.hot:not(.wrap) .title {
    color: var(--color-foreground);
  }
  .machine,
  .draft,
  .pin {
    display: inline-flex;
    align-items: center;
    flex: none;
  }
  .machine {
    color: var(--color-muted-foreground);
  }
  .pin {
    color: var(--color-subtle);
  }
  .machine.offline {
    color: var(--color-danger);
  }
  /* A draft left in the box: the accent, so it reads as the user's own work waiting. */
  .draft {
    color: var(--color-accent);
  }
  /* On a phone the line is text: the marks flow with the title and it wraps. */
  .wrap {
    display: block;
    font-size: var(--text-base);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .wrap .title {
    display: inline;
    overflow: visible;
    white-space: normal;
    font-weight: inherit;
  }
  .wrap :global(.picture) {
    margin-right: 6px;
    vertical-align: -2px;
  }
  .wrap .draft {
    margin-left: 6px;
    vertical-align: -1px;
  }
  .wrap .pin {
    margin-left: 4px;
    vertical-align: -1px;
    color: var(--color-muted-foreground);
  }
</style>
