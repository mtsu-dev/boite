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
   * title on one line, an unsent draft, the pin, then the state or the time.
   * The Recent list shows the project's tile in the picture's place and one
   * marker for the state (`tile`, `mark`).
   */
  let {
    owner,
    thread,
    now,
    machine,
    open = false,
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
    /** The project's tile where the picture goes. */
    tile?: Project;
    /** The state as one marker instead of words. */
    mark?: boolean;
  } = $props();
  let draft = $derived(!open && hasUnsentDraft(owner.composerStates[thread.id]));
</script>

<span class="headline" class:unread={thread.unread} class:hot={open || threadState(thread, owner.subagents(thread.id)) !== null}>
  {#if machine}
    <span class="machine" class:offline={owner.connection !== 'ready'}
      title={`${machine.label} · ${strings.connection[owner.connection]}`} aria-label={machine.label}>
      <MachineIcon icon={machine.icon} os={owner.core?.os} />
    </span>
  {/if}
  {#if tile}<ProjectTile project={tile} store={owner} size={16} />{:else}<ThreadPicture {owner} {thread} size={14} />{/if}
  <span class="title ui-label">{thread.title}</span>
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
    /* In the list, a row at rest reads a step back; one with a state to show reads at full strength. */
    color: var(--color-muted-foreground);
    font-weight: 500;
  }
  .headline.unread .title,
  .headline.hot .title {
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
  /* A draft left in the box: full ink, the user's own work waiting. */
  .draft {
    color: var(--color-foreground);
  }
</style>
