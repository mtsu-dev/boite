<script lang="ts">
  import { MessagesSquare } from '@lucide/svelte';
  import type { MessagePart, ThreadId } from '@boite/contracts';
  import { debateStatus, debatesOf, faceOf, followDebates, summarizerFace, summaryLines } from '../../lib/debates.svelte';
  import { fill, strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';
  import DebateAvatar from './DebateAvatar.svelte';

  /**
   * The card a debate leaves in the thread that started it (`docs/debates.md`):
   * who debates, where it stands and the way to its salon; once the summary is
   * written, its first lines. The thread's debates are read with
   * `debates.list`; a debate past the newest ones the list holds keeps its
   * topic and the way to its salon.
   */
  let { store, threadId, part }: {
    store: Store;
    threadId: ThreadId;
    part: Extract<MessagePart, { type: 'debate' }>;
  } = $props();
  const labels = $derived(strings.debates);

  const reader = $derived(debatesOf(store, threadId));
  followDebates(() => reader);
  const debate = $derived(reader.value?.find(entry => entry.id === part.debateId) ?? null);
  const status = $derived(debate ? debateStatus(debate) : null);
  /** Three debaters and the owner; a fourth debater or more shows as a count. */
  const faces = $derived.by(() => {
    const debaters = debate?.participants ?? [];
    const shown = debaters.slice(0, debaters.length > 3 ? 3 : debaters.length);
    const rest = debaters.length - shown.length;
    return {
      shown,
      tail: rest > 0 ? { kind: 'more' as const, label: `+${rest}` } : { kind: 'me' as const, label: faceOf(labels.you) },
      summarizer: debaters.length === 2 ? summarizerFace() : null,
    };
  });
</script>

<div class="debate-card" data-testid="debate-card" data-debate-id={part.debateId} data-status={debate?.status} role="group" aria-label={fill(labels.title, { topic: debate?.topic ?? part.topic })}>
  <div class="top">
    {#if debate}
      <span class="faces" aria-hidden="true">
        {#each faces.shown as debater, index (debater.id)}<DebateAvatar series={index} label={faceOf(debater.name)} size={16} />{/each}
        <DebateAvatar kind={faces.tail.kind === 'me' ? 'me' : 'mod'} label={faces.tail.label} size={16} />
        {#if faces.summarizer}<DebateAvatar kind="mod" label={faces.summarizer} size={16} />{/if}
      </span>
    {:else}
      <span class="glyph" aria-hidden="true"><MessagesSquare size={16} strokeWidth={1.75} /></span>
    {/if}
    <span class="heading">
      <span class="name" data-testid="debate-card-title">{fill(labels.title, { topic: debate?.topic ?? part.topic })}</span>
      {#if debate}<span class="cast">{fill(labels.cast, { count: String(debate.participants.length) })}</span>{/if}
    </span>
  </div>
  <div class="spread">
    {#if status}<span class="chip {status.tone}" data-testid="debate-card-status">{status.text}</span>{:else}<span></span>{/if}
    <button type="button" class="small" onclick={() => store.panel.openDebate(part.debateId)} data-testid="debate-card-open">{labels.open}</button>
  </div>
  {#if debate?.status === 'done' && debate.summary}
    <div class="synth-back" data-testid="debate-card-summary">
      <span class="label">{fill(labels.summaryBack, { name: debate.summarizer.name })}</span>
      <div class="excerpt">{#each summaryLines(debate.summary) as line, index (index)}<p>{line}</p>{/each}</div>
    </div>
  {/if}
</div>

<style>
  .debate-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    max-width: 520px;
    padding: 12px;
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    box-shadow: var(--shadow-e1);
    animation: arrive var(--dur-2) var(--ease-out-quint);
  }
  .top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .faces { display: grid; grid-template-columns: repeat(2, 16px); gap: 2px; flex: none; }
  .glyph { display: inline-flex; flex: none; color: var(--color-accent); }
  .heading { display: flex; flex-direction: column; min-width: 0; }
  .name { font-size: var(--text-sm); font-weight: 600; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .cast { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .spread { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .chip { padding: 1px 8px; border-radius: var(--radius-full); font-size: var(--text-xs); font-weight: 500; font-variant-numeric: tabular-nums; }
  .chip.live { background: color-mix(in oklch, var(--color-live) 16%, transparent); color: var(--color-live); }
  .chip.success { background: color-mix(in oklch, var(--color-success) 14%, transparent); color: var(--color-success); }
  .chip.quiet { background: var(--color-surface-3); color: var(--color-muted-foreground); }
  .chip.danger { background: color-mix(in oklch, var(--color-danger) 14%, transparent); color: var(--color-danger); }
  .synth-back { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: var(--radius-md); background: var(--color-surface-2); font-size: var(--text-sm); }
  .label { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  /* The first lines: the whole summary went back to the thread, and the salon keeps it. */
  .excerpt { display: flex; flex-direction: column; gap: 2px; max-height: 6.5em; overflow: hidden; mask-image: linear-gradient(to bottom, black 70%, transparent); }
  .excerpt p { margin: 0; overflow-wrap: anywhere; }
  /* `--dur-2` is all but zero when motion is reduced (app.css). */
  @keyframes arrive { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
</style>
