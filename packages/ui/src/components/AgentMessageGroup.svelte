<script lang="ts">
  import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronRight, CornerDownLeft, Forward } from '@lucide/svelte';
  import { agentMailFor, discussionsOf, hierarchyOf, whereOf, type AgentMailGroup, type Discussion } from '../lib/agent-mail';
  import { agentDirectory } from '../lib/agent-directory.svelte';
  import { count } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import AgentAvatar from './AgentAvatar.svelte';
  import RemoteChip from './RemoteChip.svelte';

  /**
   * A burst of agent mail in the timeline: one row per conversation it went to
   * or came from, in the order they started, with what was last said. A row
   * says first which way the burst went: what this agent sent sits on its side,
   * what reached it on the right, as in the discussion itself. A
   * row opens that discussion in the panel, on the burst's first letter. One
   * line says which way and with whom, and never wraps; under it, what was
   * last said is the card's content, read in full ink.
   */
  let { store, group }: { store: Store; group: AgentMailGroup } = $props();
  /** Past this many conversations, the rest is one line that opens the list. */
  const SHOWN = 4;
  let threadId = $derived(store.openThread?.id);
  let discussions = $derived(discussionsOf(group.entries, store, agentDirectory(store), threadId ? agentMailFor(store, threadId) : undefined)
    .sort((a, b) => a.entries[0]!.letter.createdAt - b.entries[0]!.letter.createdAt || a.key.localeCompare(b.key)));
  type Way = 'out' | 'in' | 'both';
  function wayOf(discussion: Discussion): Way {
    return discussion.received === 0 ? 'out' : discussion.sent === 0 ? 'in' : 'both';
  }
  function kicker(way: Way, discussion: Discussion): string {
    if (way === 'both') return strings.agentMessages.exchanged;
    const size = way === 'out' ? discussion.sent : discussion.received;
    const text = way === 'out' ? size === 1 ? strings.agentMessages.sentOne : strings.agentMessages.sentMany
      : size === 1 ? strings.agentMessages.receivedOne : strings.agentMessages.receivedMany;
    return fill(text, { count: count(size) });
  }
  const plain = (text: string) => text.replace(/\s+/g, ' ').trim().replace(/(\.{3}|\u2026)$/, '').trim().toLowerCase();
  /**
   * A thread named after the prompt that started it says the letter's own
   * first words: the card then names the peer by its tag and place, and the
   * words are read once, as the message.
   */
  function repeats(discussion: Discussion): boolean {
    const title = plain(discussion.title);
    return title.length >= 12 && plain(discussion.last.letter.text).startsWith(title);
  }
</script>

<div class="exchanges" data-testid="agent-message-group" data-group-id={group.id}>
  {#each discussions.slice(0, SHOWN) as discussion (discussion.key)}
    {@const tag = hierarchyOf(discussion)}
    {@const where = whereOf(discussion)}
    {@const last = discussion.last}
    {@const way = wayOf(discussion)}
    {@const said = repeats(discussion)}
    <button type="button" class="discussion {way}" class:resident={discussion.resident}
      data-testid="agent-discussion-row" data-peer={discussion.key} data-count={discussion.entries.length} data-way={way}
      title={strings.agentMessages.open}
      onclick={() => store.panel.openMessages(discussion.key, discussion.entries[0]!.letter.id)}>
      <AgentAvatar title={discussion.title} providerId={discussion.providerId} status={discussion.status} resident={discussion.resident} agent={discussion.agent} size={22} />
      <span class="body">
        <span class="top">
          <span class="kicker" data-testid="agent-discussion-way">
            {#if way === 'out'}<Forward size={13} strokeWidth={2} aria-hidden="true" />
            {:else if way === 'in'}<CornerDownLeft size={13} strokeWidth={2} aria-hidden="true" />
            {:else}<ArrowLeftRight size={13} strokeWidth={2} aria-hidden="true" />{/if}
            <span>{kicker(way, discussion)}</span>
          </span>
          <!-- A title that only says the message again is kept for a screen reader's name and the tooltip, not drawn twice. -->
          <strong class="title" class:visually-hidden={said && (!!tag || !!where)} data-testid="agent-discussion-title" title={discussion.title}>{discussion.title}</strong>
          {#if discussion.contact}<RemoteChip name={discussion.contact} human={discussion.entries.every(entry => entry.letter.origin === 'contact-human')} />{/if}
          {#if tag}<span class="tag" data-relation={tag}>{strings.agentMessages.relation[tag]}</span>{/if}
          {#if where}<span class="where">{where}</span>{/if}
        </span>
        <span class="preview" data-testid="agent-discussion-preview">
          {#if way === 'both' && last.direction === 'outgoing'}<ArrowUpRight size={12} strokeWidth={2} aria-label={strings.agentMessages.mine} />{/if}
          <span>{last.letter.text}</span>
        </span>
      </span>
      {#if way === 'both'}
        <span class="counts" title={fill(strings.agentMessages.sentReceived, { sent: count(discussion.sent), received: count(discussion.received) })}>
          <span class="count"><ArrowUpRight size={12} strokeWidth={2} aria-hidden="true" />{count(discussion.sent)}</span>
          <span class="count in"><ArrowDownLeft size={12} strokeWidth={2} aria-hidden="true" />{count(discussion.received)}</span>
        </span>
      {:else}<span></span>{/if}
      <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
  {/each}
  {#if discussions.length > SHOWN}
    <button type="button" class="line" data-testid="agent-discussion-more" onclick={() => store.panel.openMessages()}>
      {fill(strings.agentMessages.more, { count: count(discussions.length - SHOWN) })}
    </button>
  {/if}
</div>

<style>
  .exchanges { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
  .discussion {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 10px;
    width: fit-content; max-width: min(100%, 560px); height: auto; min-height: var(--control); padding: 8px 10px 9px; border-radius: var(--radius-lg); border-bottom-left-radius: var(--radius-sm); background: var(--color-surface-2);
    color: var(--color-muted-foreground); text-align: left; font-size: var(--text-sm); white-space: normal;
    transition: background var(--dur-1) var(--ease-out-quint), border-color var(--dur-1) var(--ease-out-quint), transform var(--dur-1) var(--ease-out-quint);
  }
  .discussion > :global(svg:last-child) { opacity: .6; transition: opacity var(--dur-1) var(--ease-out-quint), transform var(--dur-1) var(--ease-out-quint); }
  .discussion:hover > :global(svg:last-child) { opacity: 1; transform: translateX(2px); }
  .discussion:hover { background: var(--color-surface-3); border-color: var(--color-edge); }
  .discussion:active { transform: scale(0.99); }
  /* What reached this agent: the user's side, its corner toward the right, on the accent's tint. The tint is
     the soft accent with a share of the accent itself: alone it reads grey on the page since the accent lost chroma. */
  .discussion.in {
    --received: color-mix(in oklch, var(--color-accent) 12%, var(--color-accent-soft));
    align-self: flex-end; border-color: color-mix(in oklch, var(--color-accent) 55%, transparent); border-bottom-left-radius: var(--radius-lg); border-bottom-right-radius: var(--radius-sm); background: var(--received);
  }
  .discussion.in:hover { background: color-mix(in oklch, var(--color-accent) 10%, var(--received)); border-color: var(--color-accent); }
  .discussion.resident { border-color: color-mix(in oklch, var(--color-resident) 45%, transparent); }
  .body { min-width: 0; display: grid; gap: 3px; }
  /* Which way and with whom, on one line at every width: the name gives way first, then the place. */
  .top { min-width: 0; display: flex; align-items: center; gap: 6px; font-size: var(--text-xs); line-height: 18px; }
  .kicker { flex: none; display: inline-flex; align-items: center; gap: 5px; color: var(--color-muted-foreground); font-weight: 600; white-space: nowrap; }
  .kicker :global(svg) { flex: none; }
  .in .kicker { color: var(--color-accent); }
  .title { flex: 0 1 auto; min-width: 3ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-foreground); font-weight: 600; }
  .tag { flex: none; padding: 0 6px; border-radius: var(--radius-full); background: var(--color-active); color: var(--color-muted-foreground); font-weight: 500; }
  .resident .tag { background: var(--color-resident-soft); color: var(--color-resident); }
  .where { flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The message is the content: full ink at the reading size of a row, two lines at most. */
  .preview { min-width: 0; display: flex; align-items: baseline; gap: 4px; color: var(--color-foreground); font-size: var(--text-sm); line-height: 1.45; }
  .preview :global(svg) { flex: none; align-self: center; color: var(--color-muted-foreground); }
  .preview > span { min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
  .counts { display: flex; gap: 6px; font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .count { display: inline-flex; align-items: center; gap: 2px; }
  .count.in { color: var(--color-foreground); }
  .line { display: inline-flex; align-items: center; gap: 6px; height: auto; min-height: 0; padding: 4px 10px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .line:hover { color: var(--color-foreground); background: var(--color-hover); }
  @media (max-width: 720px) {
    .discussion { max-width: 100%; min-height: var(--touch-target); }
    .line { min-height: var(--touch-target); }
  }
</style>
