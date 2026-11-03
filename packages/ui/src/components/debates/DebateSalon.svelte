<script lang="ts">
  import { AtSign, LoaderCircle, Square } from '@lucide/svelte';
  import { DEBATE_LIMITS, DEBATE_MENTION_END, DEBATE_OWNER, DEBATE_SUMMARY, DEBATE_SYSTEM, debateMention, debateOver, type DebatePost, type ThreadId } from '@boite/contracts';
  import { debateRoom, faceOf, followDebates, summarizerFace } from '../../lib/debates.svelte';
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
  import DebateAvatar from './DebateAvatar.svelte';

  /**
   * A debate's salon (`docs/debates.md`): who debates, with their angle, the
   * AI that writes the summary, the rounds played; the posts round by round,
   * then the summary with its votes; the owner's controls and composer under
   * them. It reads the debate with `debates.get` and again on each change, so
   * the answers arrive as the debaters give them. `@` names the one debater a
   * message is for; without it every debater reads it next round.
   */
  let { store, debateId, threadId }: {
    store: Store;
    debateId: string;
    /** The thread links in the posts resolve against: the parent's, or the salon's own. */
    threadId?: ThreadId;
  } = $props();
  const labels = $derived(strings.debates);

  const reader = $derived(experimentOn('debates') ? debateRoom(store, debateId) : null);
  followDebates(() => reader);
  const debate = $derived(reader?.value?.debate ?? null);
  const posts = $derived([...(reader?.value?.posts ?? [])].sort((a, b) => a.seq - b.seq));
  const live = $derived(debate?.status === 'running');
  const over = $derived(debate ? debateOver(debate) : false);

  const seriesOf = $derived(new Map(debate?.participants.map((participant, index) => [participant.id, index]) ?? []));
  const byId = $derived(new Map(debate?.participants.map(participant => [participant.id, participant]) ?? []));
  const postById = $derived(new Map(posts.map(post => [post.id, post])));
  const summaryPost = $derived(posts.find(post => post.author === DEBATE_SUMMARY) ?? null);
  const summary = $derived(summaryPost?.text ?? (debate?.status === 'done' ? debate.summary : null));

  /** The posts of each round, in order; the summary is drawn apart, as the verdict. */
  const rounds = $derived.by(() => {
    const grouped = new Map<number, DebatePost[]>();
    for (const post of posts) {
      if (post.author === DEBATE_SUMMARY) continue;
      const list = grouped.get(post.round) ?? [];
      list.push(post);
      grouped.set(post.round, list);
    }
    return [...grouped.entries()].sort(([a], [b]) => a - b).map(([round, entries]) => ({ round, entries }));
  });
  function divider(round: number): string {
    const rounds = debate?.rounds ?? 1;
    const template = round === 1 ? labels.blind : round === rounds ? labels.vote : labels.reply;
    return fill(template, { round: String(round) });
  }

  function nameOf(author: string): string {
    if (author === DEBATE_OWNER) return labels.you;
    return byId.get(author)?.name ?? author;
  }
  const excerpt = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 140);

  /** An owner's message cut where it names a debater, so the names read in the accent colour. */
  function pieces(text: string): { text: string; mention: boolean }[] {
    const words = (debate?.participants ?? []).flatMap(participant => [participant.name.trim(), participant.handle]).filter(Boolean)
      .sort((a, b) => b.length - a.length).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (words.length === 0) return [{ text, mention: false }];
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(@(?:${words.join('|')}))${DEBATE_MENTION_END}`, 'giu');
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

  /** What the line over the controls says: who is still writing, else where the debate is. */
  const statusLine = $derived.by(() => {
    if (!debate) return '';
    if (debate.status === 'summarizing') return fill(labels.summaryWriting, { name: debate.summarizer.name });
    if (debate.status === 'done') return labels.closed;
    if (debate.status !== 'running') return debate.note ?? (debate.status === 'failed' ? labels.failed : labels.stopped);
    const writing = debate.participants.filter(participant => participant.pending).map(participant => participant.name);
    const now = writing.length === 1 ? fill(labels.writingOne, { name: writing[0]! })
      : writing.length > 1 ? fill(labels.writingMany, { names: listNames(writing) })
      : debate.round === debate.rounds && debate.rounds > 1 ? labels.allVoted : labels.allAnswered;
    return debate.concluding ? `${now} ${labels.concluding}` : now;
  });

  let acting = $state<'next' | 'conclude' | 'stop' | null>(null);
  let error = $state<string | null>(null);
  async function act(kind: 'next' | 'conclude' | 'stop') {
    const client = store.client;
    if (!client || acting) return;
    acting = kind;
    error = null;
    try {
      await client.call(kind === 'next' ? 'debates.next' : kind === 'conclude' ? 'debates.conclude' : 'debates.stop', { debateId });
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
  const tooLong = $derived(body.length > DEBATE_LIMITS.postChars);
  const ready = $derived(store.connection === 'ready' && !!store.client);
  const canSend = $derived(ready && live && !sending && body.length > 0 && !tooLong);
  const target = $derived(debate && body ? byId.get(debateMention(body, debate.participants) ?? '') ?? null : null);

  async function send() {
    const client = store.client;
    if (!client || !canSend) return;
    if (attempt?.text !== body) attempt = { id: secureId(), text: body };
    sending = true;
    error = null;
    try {
      await client.call('debates.post', { debateId, text: body, id: attempt.id });
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

  // `@` completion: the word the caret ends, when it starts with an at sign, lists the debaters it begins.
  let caret = $state(0);
  let focused = $state(false);
  let dismissed = $state<string | null>(null);
  let selected = $state(0);
  const query = $derived.by(() => {
    const match = /(^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(text.slice(0, caret));
    return match ? { word: match[2]!, start: match.index + match[1]!.length } : null;
  });
  const matches = $derived.by((): PaletteItem[] => {
    if (!query || !debate) return [];
    const word = query.word.toLowerCase();
    return debate.participants
      .filter(participant => participant.handle.toLowerCase().startsWith(word) || participant.name.toLowerCase().startsWith(word))
      .map(participant => ({ id: participant.id, kind: 'command', label: `@${participant.handle}`, hint: participant.name, description: participant.angle ?? undefined }));
  });
  const menuOpen = $derived(focused && live && !!query && matches.length > 0 && dismissed !== text);
  $effect(() => { void matches.length; selected = 0; });

  function note() {
    caret = field?.selectionStart ?? text.length;
  }
  function pick(item: PaletteItem) {
    const participant = byId.get(item.id);
    if (!participant || !query) return;
    const before = text.slice(0, query.start);
    const after = text.slice(caret).replace(/^\S*/, '').replace(/^ /, '');
    const inserted = `@${participant.handle} `;
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
    void debate?.status;
    if (pinned && scroller) scroller.scrollTop = scroller.scrollHeight;
  });
</script>

<section class="salon" data-testid="debate-salon" data-debate-id={debateId} data-status={debate?.status}>
  {#if !reader || reader.refused}
    <p class="placeholder" data-testid="debate-unavailable">{labels.unavailable}</p>
  {:else if reader.missing}
    <p class="placeholder" data-testid="debate-missing">{labels.missing}</p>
  {:else if !debate}
    <p class="placeholder" data-testid="debate-loading">{labels.loading}</p>
  {:else}
    <header class="head">
      <div class="title-row">
        <div class="titles">
          <h2 class="topic" title={debate.topic}>{debate.topic}</h2>
          <span class="meta">
            <span data-testid="debate-round">{fill(labels.roundShort, { round: String(Math.max(debate.round, 1)), rounds: String(debate.rounds) })}</span>
            <span aria-hidden="true">·</span>
            <span data-testid="debate-anonymous">{labels.anonymous}</span>
          </span>
        </div>
        {#if !over}
          <button type="button" class="quiet small stop" disabled={!!acting} onclick={() => void act('stop')} data-testid="debate-stop">
            <Square size={11} fill="currentColor" /><span class="ui-label">{labels.stop}</span>
          </button>
        {/if}
      </div>
      <ul class="members" aria-label={labels.members}>
        {#each debate.participants as participant, index (participant.id)}
          <li class="member" class:angled={!!participant.angle} data-testid="debate-member" data-participant-id={participant.id} title={participant.angle ?? participant.name}>
            <DebateAvatar series={index} label={faceOf(participant.name)} size={18} />
            <span class="member-text">
              <span class="member-name">{participant.name}</span>
              {#if participant.angle}<span class="angle" data-testid="debate-angle">{participant.angle}</span>{/if}
            </span>
          </li>
        {/each}
        <li class="member" data-testid="debate-summarizer"><DebateAvatar kind="mod" label={summarizerFace()} size={18} /><span class="member-name">{fill(labels.summarizer, { name: debate.summarizer.name })}</span></li>
        <li class="member" data-testid="debate-you"><DebateAvatar kind="me" label={faceOf(labels.you)} size={18} /><span class="member-name">{labels.you}</span></li>
      </ul>
      <div class="rounds" role="img" aria-label={fill(labels.roundsPlayed, { round: String(debate.status === 'done' ? debate.rounds : debate.round), rounds: String(debate.rounds) })} data-testid="debate-rounds">
        {#each { length: debate.rounds } as _, index (index)}<i class:on={debate.status === 'done' || index < debate.round}></i>{/each}
      </div>
    </header>

    <div class="timeline" bind:this={scroller} onscroll={measure} data-testid="debate-posts">
      {#if rounds.length === 0 && !summary}<p class="placeholder" data-testid="debate-empty">{labels.empty}</p>{/if}
      {#each rounds as { round, entries } (round)}
        <div class="divider fade" role="separator" data-testid="debate-divider" data-round={round}><span>{divider(round)}</span></div>
        {#each entries as post (post.id)}
          {#if post.author === DEBATE_SYSTEM}
            <p class="system fade" data-testid="debate-system">{post.text}</p>
          {:else}
            {@const own = post.author === DEBATE_OWNER}
            {@const debater = byId.get(post.author)}
            {@const answered = post.inReplyTo ? postById.get(post.inReplyTo) : undefined}
            <article class="post fade" data-testid="debate-post" data-author={own ? 'owner' : post.author} data-to={post.to ?? undefined} data-round={post.round}>
              {#if own}<DebateAvatar kind="me" label={faceOf(labels.you)} />
              {:else}<DebateAvatar series={seriesOf.get(post.author) ?? 0} label={faceOf(nameOf(post.author))} />{/if}
              <div class="body">
                <div class="who">
                  <b>{nameOf(post.author)}</b>
                  {#if debater?.angle}<span class="angle-inline">· {debater.angle}</span>{/if}
                  <time datetime={new Date(post.createdAt).toISOString()} title={fullTime(post.createdAt)}>{dayClock(post.createdAt)}</time>
                </div>
                {#if own && post.to}<span class="to-one" data-testid="debate-post-to">{fill(labels.toOne, { name: nameOf(post.to) })}</span>{/if}
                {#if answered}<p class="reply-to" data-testid="debate-post-reply">{fill(labels.replyTo, { name: nameOf(answered.author) })} · {excerpt(answered.text)}</p>{/if}
                <div class="text">
                  {#if own}<p class="plain">{#each pieces(post.text) as piece, at (at)}{#if piece.mention}<span class="mention">{piece.text}</span>{:else}{piece.text}{/if}{/each}</p>
                  {:else}<Prose text={post.text} {store} {threadId} />{/if}
                </div>
                {#if post.vote}<p class="vote" data-testid="debate-post-vote">{fill(labels.votedFor, { proposal: post.vote })}</p>{/if}
              </div>
            </article>
          {/if}
        {/each}
      {/each}
      {#if summary}
        <section class="verdict fade" data-testid="debate-verdict">
          <div class="verdict-head"><DebateAvatar kind="mod" label={summarizerFace()} size={20} /><b>{fill(labels.verdict, { name: debate.summarizer.name })}</b></div>
          {#if debate.tally.length > 0}
            <table class="votes">
              <thead><tr><th scope="col">{labels.proposal}</th><th scope="col" class="count">{labels.votes}</th></tr></thead>
              <tbody>
                {#each debate.tally as row (row.proposal)}
                  <tr data-testid="debate-tally-row"><td>{row.proposal}</td><td class="count">{fill(labels.voteCount, { votes: String(row.votes), of: String(row.of) })}</td></tr>
                {/each}
              </tbody>
            </table>
          {/if}
          <div class="text"><Prose text={summary} {store} {threadId} /></div>
        </section>
      {/if}
    </div>

    <footer class="foot">
      <p class="typing" aria-live="polite" data-testid="debate-status-line">{statusLine}</p>
      {#if live}
        <div class="controls">
          <button type="button" class="small ghost" title={labels.nextHint} disabled={!!acting} onclick={() => void act('next')} data-testid="debate-next">{labels.next}</button>
          <button type="button" class="small primary" title={labels.concludeHint} disabled={!!acting || debate.concluding} onclick={() => void act('conclude')} data-testid="debate-conclude">{labels.conclude}</button>
        </div>
        <div class="composer" data-testid="debate-composer">
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
            data-testid="debate-input"
          ></textarea>
          <button type="button" class="ghost small icon" title={labels.mention} aria-label={labels.mention} onmousedown={(event) => event.preventDefault()} onclick={startMention} data-testid="debate-mention"><AtSign size={14} /></button>
          <button type="button" class="small send" disabled={!canSend} onmousedown={(event) => event.preventDefault()} onclick={() => void send()} data-testid="debate-send">
            {#if sending}<LoaderCircle class="spinner" size={14} /><span class="ui-label">{labels.sending}</span>{:else}{labels.send}{/if}
          </button>
        </div>
        {#if error}<p class="note error" role="alert" data-testid="debate-error">{error}</p>
        {:else if tooLong}<p class="note error" role="alert" data-testid="debate-error">{fill(labels.tooLong, { max: count(DEBATE_LIMITS.postChars) })}</p>
        {:else if body}<p class="note" data-testid="debate-reads">{target ? fill(labels.readsOne, { name: target.name }) : labels.readsAll}</p>{/if}
      {:else}
        {#if error}<p class="note error" role="alert" data-testid="debate-error">{error}</p>{/if}
        <p class="closed" data-testid="debate-closed">{debate.status === 'summarizing' ? labels.summarizingClosed : labels.over}</p>
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
  .member.angled { border-radius: var(--radius-md); padding-top: 3px; padding-bottom: 3px; }
  .member-text { display: flex; flex-direction: column; min-width: 0; }
  .member-name, .angle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .angle { color: var(--color-muted-foreground); }
  .rounds { display: flex; gap: 4px; }
  .rounds i { flex: 1; height: 4px; border-radius: 2px; background: var(--color-surface-3); transition: background var(--dur-2) var(--ease-out-quint); }
  .rounds i.on { background: var(--color-accent); }

  .timeline { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 12px; padding: 12px; }
  .divider { display: flex; align-items: center; gap: 8px; color: var(--color-muted-foreground); font-size: var(--text-xs); text-align: center; }
  .divider::before, .divider::after { content: ''; flex: 1; min-width: 12px; border-top: 1px solid var(--color-border); }
  .system { margin: 0; color: var(--color-subtle); font-size: var(--text-xs); text-align: center; }
  .post { display: flex; gap: 8px; min-width: 0; }
  .body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .who b { color: var(--color-foreground); font-weight: 600; }
  .who time { margin-left: 2px; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
  .to-one { align-self: flex-start; padding: 0 8px; border-radius: var(--radius-full); background: var(--color-accent-soft); color: var(--color-accent); font-size: var(--text-xs); font-weight: 500; }
  .reply-to { margin: 0; padding-left: 8px; border-left: 2px solid var(--color-border); color: var(--color-muted-foreground); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .text { min-width: 0; font-size: var(--text-sm); overflow-wrap: anywhere; }
  .plain { margin: 0; white-space: pre-wrap; }
  .mention { color: var(--color-accent); font-weight: 500; }
  .vote { margin: 0; color: var(--color-muted-foreground); font-size: var(--text-xs); }

  .verdict { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
  .verdict-head { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); }
  .votes { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
  .votes th { color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 500; text-align: left; padding: 0 0 4px; }
  .votes td { padding: 4px 0; border-top: 1px solid var(--color-border); vertical-align: top; overflow-wrap: anywhere; }
  .votes .count { width: 1%; padding-left: 12px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

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
  .send :global(.spinner) { animation: spin 1s linear infinite var(--loops); }
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
