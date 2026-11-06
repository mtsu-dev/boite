<script lang="ts">
  import { AtSign, LoaderCircle, Square } from '@lucide/svelte';
  import { COUNCIL_AUTHOR, COUNCIL_EXPERIMENT, COUNCIL_LEGACY_SUMMARY, COUNCIL_LIMITS, COUNCIL_MENTION_END, COUNCIL_OWNER, COUNCIL_SYSTEM, councilMention, councilOver, councilScore, councilTable, type CouncilPost, type ThreadId } from '@boite/contracts';
  import { councilRoom, faceOf, followCouncil } from '../../lib/council.svelte';
  import { errorText } from '../../lib/errors';
  import { experimentOn } from '../../lib/experiments.svelte';
  import { count, dayClock, fullTime } from '../../lib/format';
  import { hasKeyboard } from '../../lib/live-input';
  import type { PaletteItem } from '../../lib/palette';
  import { secureId } from '../../lib/secure-id';
  import { fill, strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';
  import { listNames } from '../../lib/teams.svelte';
  import ComposerMenu from '../ComposerMenu.svelte';
  import Prose from '../Prose.svelte';
  import CouncilAvatar from './CouncilAvatar.svelte';

  /**
   * A council's salon (`docs/council.md`): who reviews; the answers round by
   * round, each with its score, then the table of scores; the owner's controls
   * and composer under them. It reads the council with `council.get` and again
   * on each change, so the answers arrive as the members give them. `@` names
   * the one member a message is for; without it every member reads it next
   * round. A debate from before the council reads here too, with nothing to add.
   */
  let { store, councilId, threadId }: {
    store: Store;
    councilId: string;
    /** The thread links in the posts resolve against: the parent's, or the salon's own. */
    threadId?: ThreadId;
  } = $props();
  const labels = $derived(strings.council);

  const reader = $derived(experimentOn(COUNCIL_EXPERIMENT) ? councilRoom(store, councilId) : null);
  followCouncil(() => reader);
  const council = $derived(reader?.value?.council ?? null);
  const posts = $derived([...(reader?.value?.posts ?? [])].sort((a, b) => a.seq - b.seq));
  const over = $derived(council ? councilOver(council) : false);
  /** Messages are read at the next round, so the salon stays open between two rounds. A stored debate has none. */
  const live = $derived(!!council && !over && !council.legacy);

  const seriesOf = $derived(new Map(council?.members.map((member, index) => [member.id, index]) ?? []));
  const byId = $derived(new Map(council?.members.map(member => [member.id, member]) ?? []));
  const postById = $derived(new Map(posts.map(post => [post.id, post])));

  /** The posts of each round, in order. */
  const rounds = $derived.by(() => {
    const grouped = new Map<number, CouncilPost[]>();
    for (const post of posts) {
      const list = grouped.get(post.round) ?? [];
      list.push(post);
      grouped.set(post.round, list);
    }
    return [...grouped.entries()].sort(([a], [b]) => a - b).map(([round, entries]) => ({ round, entries }));
  });
  function divider(round: number): string {
    if (council && round > council.round) return labels.nextRound;
    return fill(council?.legacy ? labels.round : labels.divider, { round: String(round) });
  }

  function nameOf(author: string): string {
    if (author === COUNCIL_OWNER) return labels.you;
    if (author === COUNCIL_AUTHOR) return labels.author;
    if (author === COUNCIL_LEGACY_SUMMARY) return labels.summary;
    return byId.get(author)?.name ?? author;
  }
  const excerpt = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 140);

  /** An owner's message cut where it names a member, so the names read in the accent colour. */
  function pieces(text: string): { text: string; mention: boolean }[] {
    const words = (council?.members ?? []).flatMap(member => [member.name.trim(), member.handle]).filter(Boolean)
      .sort((a, b) => b.length - a.length).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (words.length === 0) return [{ text, mention: false }];
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(@(?:${words.join('|')}))${COUNCIL_MENTION_END}`, 'giu');
    const out: { text: string; mention: boolean }[] = [];
    let at = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index + match[1]!.length;
      if (start > at) out.push({ text: text.slice(at, start), mention: false });
      out.push({ text: match[2]!, mention: true });
      at = start + match[2]!.length;
    }
    if (at < text.length) out.push({ text: text.slice(at), mention: false });
    return out;
  }

  /** What the line over the controls says: who is still writing, else where the council is. */
  const statusLine = $derived.by(() => {
    if (!council) return '';
    if (council.status === 'waiting') return fill(labels.betweenRounds, { round: String(council.round) });
    if (council.status === 'done') return council.note ?? labels.closed;
    if (council.status !== 'running') return council.note ?? (council.status === 'failed' ? labels.failed : labels.stopped);
    const writing = council.members.filter(member => member.pending).map(member => member.name);
    return writing.length === 1 ? fill(labels.writingOne, { name: writing[0]! })
      : writing.length > 1 ? fill(labels.writingMany, { names: listNames(writing) })
      : council.round === 0 ? labels.starting : labels.allAnswered;
  });

  let acting = $state<'close' | 'stop' | null>(null);
  let error = $state<string | null>(null);
  async function act(kind: 'close' | 'stop') {
    const client = store.client;
    if (!client || acting) return;
    acting = kind;
    error = null;
    try {
      await client.call(kind === 'close' ? 'council.closeRound' : 'council.stop', { councilId });
      void reader?.refresh();
    } catch (failure) {
      error = errorText(failure);
    } finally {
      acting = null;
    }
  }

  // The composer. A message keeps its id until it lands, so a retry after a lost answer returns the same post.
  let text = $state('');
  let sending = $state(false);
  let field = $state<HTMLTextAreaElement>();
  let attempt: { id: string; text: string } | null = null;
  const body = $derived(text.trim());
  const tooLong = $derived(body.length > COUNCIL_LIMITS.postChars);
  const ready = $derived(store.connection === 'ready' && !!store.client);
  const canSend = $derived(ready && live && !sending && body.length > 0 && !tooLong);
  const target = $derived(council && body ? byId.get(councilMention(body, council.members) ?? '') ?? null : null);

  async function send() {
    const client = store.client;
    if (!client || !canSend) return;
    if (attempt?.text !== body) attempt = { id: secureId(), text: body };
    sending = true;
    error = null;
    try {
      await client.call('council.post', { councilId, text: body, id: attempt.id });
      attempt = null;
      text = '';
      pinned = true;
      void reader?.refresh();
    } catch (failure) {
      error = errorText(failure);
    } finally {
      sending = false;
    }
  }

  // `@` completion: the word the caret ends, when it starts with an at sign, lists the members it begins.
  let caret = $state(0);
  let focused = $state(false);
  let dismissed = $state<string | null>(null);
  let selected = $state(0);
  const query = $derived.by(() => {
    const match = /(^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(text.slice(0, caret));
    return match ? { word: match[2]!, start: match.index + match[1]!.length } : null;
  });
  const matches = $derived.by((): PaletteItem[] => {
    if (!query || !council) return [];
    const word = query.word.toLowerCase();
    return council.members
      .filter(member => member.handle.toLowerCase().startsWith(word) || member.name.toLowerCase().startsWith(word))
      .map(member => ({ id: member.id, kind: 'command', label: `@${member.handle}`, hint: member.name }));
  });
  const menuOpen = $derived(focused && live && !!query && matches.length > 0 && dismissed !== text);
  $effect(() => { void matches.length; selected = 0; });

  function note() {
    caret = field?.selectionStart ?? text.length;
  }
  function pick(item: PaletteItem) {
    const member = byId.get(item.id);
    if (!member || !query) return;
    const before = text.slice(0, query.start);
    const after = text.slice(caret).replace(/^\S*/, '').replace(/^ /, '');
    const inserted = `@${member.handle} `;
    text = `${before}${inserted}${after}`;
    const at = before.length + inserted.length;
    caret = at;
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(at, at); });
  }
  /** The at-sign button: a phone has no `@` close at hand on every keyboard. */
  function startMention() {
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    text = `${before}${lead}@${text.slice(end)}`;
    const at = before.length + lead.length + 1;
    caret = at;
    dismissed = null;
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(at, at); });
  }
  function keydown(event: KeyboardEvent) {
    if (menuOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        selected = (selected + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const item = matches[selected];
        if (item) pick(item);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismissed = text;
        return;
      }
    }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !hasKeyboard()) return;
    event.preventDefault();
    void send();
  }

  // The newest post stays in view while the reader is at the bottom; reading higher up, nothing moves.
  let scroller = $state<HTMLElement>();
  let pinned = true;
  function measure() {
    if (scroller) pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 64;
  }
  $effect(() => {
    void posts.length;
    void council?.status;
    void council?.roundsDone;
    if (pinned && scroller) scroller.scrollTop = scroller.scrollHeight;
  });
</script>

<section class="salon" data-testid="council-salon" data-council-id={councilId} data-status={council?.status}>
  {#if !reader || reader.refused}
    <p class="placeholder" data-testid="council-unavailable">{labels.unavailable}</p>
  {:else if reader.missing}
    <p class="placeholder" data-testid="council-missing">{labels.missing}</p>
  {:else if !council}
    <p class="placeholder" data-testid="council-loading">{labels.loading}</p>
  {:else}
    <header class="head">
      <div class="title-row">
        <div class="titles">
          <h2 class="topic" title={council.request}>{council.request}</h2>
          <span class="meta" data-testid="council-round">{fill(labels.round, { round: String(Math.max(council.round, 1)) })}</span>
        </div>
        {#if !over}
          <button type="button" class="quiet small stop" disabled={!!acting} onclick={() => void act('stop')} data-testid="council-stop">
            <Square size={11} fill="currentColor" /><span class="ui-label">{labels.stop}</span>
          </button>
        {/if}
      </div>
      <ul class="members" aria-label={labels.members}>
        {#each council.members as member, index (member.id)}
          <li class="member" data-testid="council-member" data-member-id={member.id} title={member.name}>
            <CouncilAvatar series={index} label={faceOf(member.name)} size={18} />
            <span class="member-name">{member.name}</span>
          </li>
        {/each}
        <li class="member" data-testid="council-you"><CouncilAvatar kind="me" label={faceOf(labels.you)} size={18} /><span class="member-name">{labels.you}</span></li>
      </ul>
    </header>

    <div class="timeline" bind:this={scroller} onscroll={measure} data-testid="council-posts">
      {#if rounds.length === 0}<p class="placeholder" data-testid="council-empty">{labels.empty}</p>{/if}
      {#each rounds as { round, entries } (round)}
        <div class="divider fade" role="separator" data-testid="council-divider" data-round={round}><span>{divider(round)}</span></div>
        {#each entries as post (post.id)}
          {#if post.author === COUNCIL_SYSTEM}
            <p class="system fade" data-testid="council-system">{post.text}</p>
          {:else}
            {@const own = post.author === COUNCIL_OWNER}
            {@const member = byId.get(post.author)}
            {@const answered = post.inReplyTo ? postById.get(post.inReplyTo) : undefined}
            <article class="post fade" data-testid="council-post" data-author={own ? 'owner' : post.author} data-to={post.to ?? undefined} data-round={post.round}>
              {#if own}<CouncilAvatar kind="me" label={faceOf(labels.you)} />
              {:else if member}<CouncilAvatar series={seriesOf.get(post.author) ?? 0} label={faceOf(member.name)} />
              {:else}<CouncilAvatar kind="mod" label={faceOf(nameOf(post.author))} />{/if}
              <div class="body">
                <div class="who">
                  <b>{nameOf(post.author)}</b>
                  {#if member && !council.legacy}<span class="score" data-testid="council-post-score">· {councilScore(member.scores[post.round - 1], labels.table.noScore)}</span>{/if}
                  <time datetime={new Date(post.createdAt).toISOString()} title={fullTime(post.createdAt)}>{dayClock(post.createdAt)}</time>
                </div>
                {#if own && post.to}<span class="to-one" data-testid="council-post-to">{fill(labels.toOne, { name: nameOf(post.to) })}</span>{/if}
                {#if answered}<p class="reply-to" data-testid="council-post-reply">{fill(labels.replyTo, { name: nameOf(answered.author) })} · {excerpt(answered.text)}</p>{/if}
                <div class="text">
                  {#if own}<p class="plain">{#each pieces(post.text) as piece, at (at)}{#if piece.mention}<span class="mention">{piece.text}</span>{:else}{piece.text}{/if}{/each}</p>
                  {:else}<Prose text={post.text} {store} {threadId} />{/if}
                </div>
              </div>
            </article>
          {/if}
        {/each}
      {/each}
      {#if council.roundsDone > 0 && !council.legacy}
        <section class="review fade" data-testid="council-table">
          <div class="text"><Prose text={councilTable(council, labels.table)} {store} {threadId} /></div>
        </section>
      {/if}
    </div>

    <footer class="foot">
      <p class="typing" aria-live="polite" data-testid="council-status-line">{statusLine}</p>
      {#if live}
        {#if council.status === 'running'}
          <div class="controls">
            <button type="button" class="small ghost" title={labels.closeRoundHint} disabled={!!acting} onclick={() => void act('close')} data-testid="council-close-round">{labels.closeRound}</button>
          </div>
        {/if}
        <div class="composer" data-testid="council-composer">
          <ComposerMenu open={menuOpen} items={matches} {selected} kind="mention" label={labels.mention} empty="" onpick={pick} onhover={(index) => (selected = index)} />
          <textarea
            bind:this={field}
            bind:value={text}
            rows="1"
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
            oninput={note}
            onclick={note}
            onkeyup={note}
            onfocus={() => { focused = true; note(); }}
            onblur={() => (focused = false)}
            onkeydown={keydown}
            data-testid="council-input"
          ></textarea>
          <button type="button" class="ghost small icon" title={labels.mention} aria-label={labels.mention} onmousedown={(event) => event.preventDefault()} onclick={startMention} data-testid="council-mention"><AtSign size={14} /></button>
          <button type="button" class="small send" disabled={!canSend} onmousedown={(event) => event.preventDefault()} onclick={() => void send()} data-testid="council-send">
            {#if sending}<LoaderCircle class="spinner" size={14} /><span class="ui-label">{labels.sending}</span>{:else}{labels.send}{/if}
          </button>
        </div>
        {#if error}<p class="note error" role="alert" data-testid="council-error">{error}</p>
        {:else if tooLong}<p class="note error" role="alert" data-testid="council-error">{fill(labels.tooLong, { max: count(COUNCIL_LIMITS.postChars) })}</p>
        {:else if body}<p class="note" data-testid="council-reads">{target ? fill(labels.readsOne, { name: target.name }) : labels.readsAll}</p>{/if}
      {:else}
        {#if error}<p class="note error" role="alert" data-testid="council-error">{error}</p>{/if}
        <p class="closed" data-testid="council-closed">{labels.over}</p>
      {/if}
    </footer>
  {/if}
</section>

<style>
  .salon { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
  .placeholder { margin: 48px auto; max-width: 420px; padding: 0 16px; color: var(--color-muted-foreground); text-align: center; font-size: var(--text-sm); }

  .head { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px; border-bottom: 1px solid var(--color-border); }
  .title-row { display: flex; align-items: flex-start; gap: 8px; }
  .titles { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .topic { margin: 0; font-size: var(--text-md); font-weight: 600; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  /* Plain text, so a narrow panel wraps it word by word rather than leaving the dot at a line's end. */
  .meta { color: var(--color-muted-foreground); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .stop { flex: none; gap: 6px; }
  .members { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .member { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; padding: 2px 8px 2px 2px; border: 1px solid var(--color-border); border-radius: var(--radius-full); font-size: var(--text-xs); }
  .member-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .timeline { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 12px; padding: 12px; }
  .divider { display: flex; align-items: center; gap: 8px; color: var(--color-muted-foreground); font-size: var(--text-xs); text-align: center; }
  .divider::before, .divider::after { content: ''; flex: 1; min-width: 12px; border-top: 1px solid var(--color-border); }
  .system { margin: 0; color: var(--color-subtle); font-size: var(--text-xs); text-align: center; }
  .post { display: flex; gap: 8px; min-width: 0; }
  .body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .who b { color: var(--color-foreground); font-weight: 600; }
  .who time { margin-left: 2px; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  .score { font-variant-numeric: tabular-nums; }
  .to-one { align-self: flex-start; padding: 0 8px; border-radius: var(--radius-full); background: var(--color-accent-soft); color: var(--color-accent); font-size: var(--text-xs); font-weight: 500; }
  .reply-to { margin: 0; padding-left: 8px; border-left: 2px solid var(--color-border); color: var(--color-muted-foreground); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .text { min-width: 0; font-size: var(--text-sm); overflow-wrap: anywhere; }
  .plain { margin: 0; white-space: pre-wrap; }
  .mention { color: var(--color-accent); font-weight: 500; }

  .review { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); }

  .foot { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px; border-top: 1px solid var(--color-border); }
  .typing { margin: 0; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .typing:empty { display: none; }
  .controls { display: flex; flex-wrap: wrap; gap: 6px; }
  .composer { position: relative; display: flex; align-items: flex-end; gap: 6px; }
  textarea {
    flex: 1;
    min-width: 0;
    min-height: var(--control);
    max-height: min(160px, calc(6lh + 12px));
    field-sizing: content;
    resize: none;
    padding: 5px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-foreground);
    font: inherit;
    font-size: var(--text-sm);
  }
  textarea::placeholder { color: var(--color-subtle); }
  .send { flex: none; gap: 6px; }
  .send :global(.spinner) { animation: spin var(--dur-spin) linear infinite var(--loops); }
  .note { margin: 0; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .note.error { color: var(--color-danger); }
  .closed { margin: 0; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-muted-foreground); font-size: var(--text-sm); text-align: center; }

  /* `--dur-2` is all but zero when motion is reduced (app.css). */
  .fade { animation: arrive var(--dur-2) var(--ease-out-quint); }
  @keyframes arrive { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .send :global(.spinner) { animation: none; } }

  @media (max-width: 720px) {
    .members { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .member { flex: none; max-width: 70vw; }
    textarea { font-size: var(--text-md); min-height: var(--touch-target); }
    .controls button, .send, .composer .icon { min-height: var(--touch-target); }
    .composer .icon { width: var(--touch-target); }
    .foot { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
  }
</style>
