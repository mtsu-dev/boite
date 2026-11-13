<script lang="ts">
  import { MessagesSquare } from '@lucide/svelte';
  import type { MessagePart, ThreadId } from '@boite/contracts';
  import { councilStatus, councilsOf, faceOf, followCouncil } from '../../lib/council.svelte';
  import { fill, strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';
  import CouncilAvatar from './CouncilAvatar.svelte';

  /**
   * The card a council leaves in the thread that started it (`docs/internals/council.md`):
   * who reviews, where it stands and the way to its salon. A debate from before
   * the council left a part of its own and draws the same card. The thread's
   * councils are read with `council.list`; one past the newest the list holds
   * keeps its request and the way to its salon.
   */
  let { store, threadId, part }: {
    store: Store;
    threadId: ThreadId;
    part: Extract<MessagePart, { type: 'council' | 'debate' }>;
  } = $props();
  const labels = $derived(strings.council);

  const councilId = $derived(part.type === 'debate' ? part.debateId : part.councilId);
  const reader = $derived(councilsOf(store, threadId));
  followCouncil(() => reader);
  const council = $derived(reader.value?.find(entry => entry.id === councilId) ?? null);
  const status = $derived(council ? councilStatus(council) : null);
  /** Three members and the owner; a fourth member or more shows as a count. */
  const faces = $derived.by(() => {
    const members = council?.members ?? [];
    const shown = members.slice(0, members.length > 3 ? 3 : members.length);
    const rest = members.length - shown.length;
    return {
      shown,
      tail: rest > 0 ? { kind: 'more' as const, label: `+${rest}` } : { kind: 'me' as const, label: faceOf(labels.you) },
    };
  });
</script>

<div class="council-card" data-feature="boite-feature:debates" data-testid="council-card" data-council-id={councilId} data-status={council?.status} role="group" aria-label={fill(labels.title, { topic: council?.request ?? part.topic })}>
  <div class="top">
    {#if council}
      <span class="faces" aria-hidden="true">
        {#each faces.shown as member, index (member.id)}<CouncilAvatar series={index} label={faceOf(member.name)} size={16} />{/each}
        <CouncilAvatar kind={faces.tail.kind === 'me' ? 'me' : 'mod'} label={faces.tail.label} size={16} />
      </span>
    {:else}
      <span class="glyph" aria-hidden="true"><MessagesSquare size={16} strokeWidth={1.75} /></span>
    {/if}
    <span class="heading">
      <span class="name" data-testid="council-card-title">{fill(labels.title, { topic: council?.request ?? part.topic })}</span>
      {#if council}<span class="cast">{fill(labels.cast, { count: String(council.members.length) })}</span>{/if}
    </span>
  </div>
  <div class="spread">
    {#if status}<span class="ui-chip {status.tone}" data-testid="council-card-status">{status.text}</span>{:else}<span></span>{/if}
    <button type="button" class="small" onclick={() => store.panel.openCouncil(councilId)} data-testid="council-card-open">{labels.open}</button>
  </div>
</div>

<style>
  .council-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    max-width: 520px;
    padding: 12px;
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    animation: arrive var(--dur-2) var(--ease-out-quint);
  }
  .top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .faces { display: grid; grid-template-columns: repeat(2, 16px); gap: 2px; flex: none; }
  .glyph { display: inline-flex; flex: none; color: var(--color-muted-foreground); }
  .heading { display: flex; flex-direction: column; min-width: 0; }
  .name { font-size: var(--text-sm); font-weight: 600; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .cast { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .spread { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .ui-chip { padding: 1px 8px; border-radius: var(--radius-full); font-size: var(--text-xs); font-weight: 500; font-variant-numeric: tabular-nums; }
  .ui-chip.live { background: color-mix(in oklch, var(--color-live) 16%, transparent); color: var(--color-live); }
  .ui-chip.success { background: color-mix(in oklch, var(--color-success) 14%, transparent); color: var(--color-success); }
  .ui-chip.quiet { background: var(--color-surface-3); color: var(--color-muted-foreground); }
  .ui-chip.danger { background: color-mix(in oklch, var(--color-danger) 14%, transparent); color: var(--color-danger); }
  /* `--dur-2` is all but zero when motion is reduced (app.css). */
  @keyframes arrive { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
</style>
