<script lang="ts">
  import { tick } from 'svelte';
  import { Archive, ArrowDown, ArrowUp, Lock, Pause, Reply, UserRound } from '@lucide/svelte';
  import { TEAM_OWNER, type AgentProfile, type Message, type TeamParty, type TeamPostRef, type Thread } from '@boite/contracts';
  import { agentDirectory, followAgentDirectories } from '../../lib/agent-directory.svelte';
  import { experimentOn } from '../../lib/experiments.svelte';
  import { dayClock, fullTime, longDay } from '../../lib/format';
  import { fill, strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';
  import { botIdOf, followTeams, listNames, teamsOf } from '../../lib/teams.svelte';
  import AgentAvatar from '../agents/AgentAvatar.svelte';
  import Prose from '../Prose.svelte';
  import TeamComposer, { type TeamReply } from './TeamComposer.svelte';

  /**
   * A team's chat (`docs/teams.md`): the members over the posts, each post
   * with its author, its time, whether it was private and to whom, the post it
   * answers and who it woke; the owner's composer under them. The posts are
   * the thread's messages, so they arrive live, page like a thread's, and the
   * chat reads as read once opened.
   */
  let { store, thread }: { store: Store; thread: Thread } = $props();
  const labels = $derived(strings.teamChat);

  followTeams(() => store);
  followAgentDirectories(() => [store], () => experimentOn('resident-agents'));
  const directory = $derived(teamsOf(store));
  const team = $derived(directory.ofThread(thread.id));
  const profiles = $derived(agentDirectory(store).snapshot?.profiles ?? []);

  interface Post { message: Message; ref: TeamPostRef; text: string; at: number }
  const posts = $derived(thread.messages.flatMap((message): Post[] => {
    for (const part of message.parts) if (part.type === 'text' && part.teamPost) return [{ message, ref: part.teamPost, text: part.text, at: message.createdAt }];
    return [];
  }));
  const byId = $derived(new Map(posts.map(post => [post.ref.id, post])));
  const loading = $derived(store.loadingThreadId === thread.id && thread.messages.length === 0);

  /** Posting needs the experiment and a team that still takes posts; otherwise a note stands in the composer's place. */
  const closed = $derived(!experimentOn('teams') || (directory.loaded && !team) ? labels.unavailable
    : team?.archived || thread.archived ? labels.archived : null);
  let reply = $state<TeamReply | null>(null);

  function profileOf(botId: string): Pick<AgentProfile, 'id' | 'name' | 'avatar'> | undefined {
    return profiles.find(profile => profile.id === botId);
  }
  /** You (you inside a sentence), a member's name, the name of a bot that left, else the bot id its key holds. */
  function nameOf(party: TeamParty, inText = false): string {
    if (party === TEAM_OWNER) return inText ? labels.youInText : labels.you;
    const botId = botIdOf(party);
    return team?.members.find(member => member.key === party)?.name ?? profileOf(botId)?.name ?? botId;
  }
  const dayOf = (at: number) => new Date(at).toDateString();
  /** A post under one of the same author's a few minutes before reads as its continuation. */
  function continues(previous: Post | undefined, post: Post): boolean {
    return !!previous && previous.ref.author === post.ref.author && previous.ref.audience === 'team' && post.ref.audience === 'team'
      && !post.ref.inReplyTo && post.at - previous.at < 5 * 60_000 && dayOf(previous.at) === dayOf(post.at);
  }
  /** Who a group post woke; the owner's post that woke nobody says how to name one. */
  function woke({ ref }: Post): { text: string; nobody: boolean } | null {
    if (ref.audience === 'private') return null;
    const woken = ref.to.filter(party => party !== TEAM_OWNER);
    if (ref.routedBy === 'everyone' && woken.length > 0) return { text: labels.wokeEveryone, nobody: false };
    if (woken.length > 0) return { text: fill(labels.woke, { names: listNames(woken.map(party => nameOf(party))) }), nobody: false };
    if (ref.author === TEAM_OWNER && ref.routedBy === 'none') return { text: fill(labels.nobody, { mention: labels.composer.name, everyone: labels.composer.everyone }), nobody: true };
    return null;
  }
  const excerpt = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 140);

  function answer(post: Post) {
    reply = { id: post.ref.id, author: post.ref.author, excerpt: excerpt(post.text) };
  }
  function jump(id: string) {
    scroller?.querySelector(`[data-post-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
  }

  // The newest post stays in view while the reader is at the bottom; reading higher up, nothing moves.
  let scroller = $state<HTMLElement>();
  let column = $state<HTMLElement>();
  let pinned = true;
  function measure() {
    if (scroller) pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 64;
  }
  function toBottom() {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }
  $effect(() => {
    void posts.length;
    if (pinned) toBottom();
  });
  $effect(() => {
    const box = scroller, content = column;
    if (!box || !content) return;
    const observer = new ResizeObserver(() => { if (pinned) toBottom(); });
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  });
  async function earlier() {
    const box = scroller;
    if (!box) return;
    pinned = false;
    const fromBottom = box.scrollHeight - box.scrollTop;
    if (!(await store.loadOlder())) return;
    await tick();
    box.scrollTop = box.scrollHeight - fromBottom;
  }
  function sent() {
    pinned = true;
    toBottom();
  }
</script>

<section class="team-chat" data-testid="team-chat" data-team-id={team?.id}>
  {#if team}
    <header class="members" data-testid="team-members">
      <div class="member-row" role="group" aria-label={labels.members}>
        {#each team.members as member (member.key)}
          {@const profile = profileOf(member.botId)}
          <button type="button" class="ghost member" title={member.name} disabled={!profile} onclick={() => store.showAgents(member.botId)} data-testid="team-member" data-bot-id={member.botId}>
            <AgentAvatar kind="profile" id={member.botId} name={member.name} avatar={profile?.avatar ?? ''} size={20} />
            <span class="ui-label">{member.name}</span>
          </button>
        {/each}
      </div>
      {#if team.brief}<p class="brief" title={team.brief}>{team.brief}</p>{/if}
    </header>
  {/if}

  <div class="scroller" bind:this={scroller} onscroll={measure} data-testid="team-posts">
    <div class="column" bind:this={column}>
      {#if thread.messagesBefore !== null}
        <button type="button" class="ghost small page" disabled={store.loadingOlder} onclick={() => void earlier()} data-testid="team-earlier"><ArrowUp size={14} /><span class="ui-label">{labels.earlier}</span></button>
      {/if}
      {#if loading}
        <p class="placeholder" data-testid="team-loading">{labels.loading}</p>
      {:else if posts.length === 0}
        <p class="placeholder" data-testid="team-empty">{fill(labels.empty, { mention: labels.composer.name, everyone: labels.composer.everyone })}</p>
      {/if}
      {#each posts as post, index (post.message.id)}
        {@const previous = posts[index - 1]}
        {@const day = !previous || dayOf(previous.at) !== dayOf(post.at)}
        {@const grouped = !day && continues(previous, post)}
        {@const own = post.ref.author === TEAM_OWNER}
        {@const botId = own ? '' : botIdOf(post.ref.author)}
        {@const replied = post.ref.inReplyTo ? byId.get(post.ref.inReplyTo) : undefined}
        {@const line = woke(post)}
        {#if day}<div class="day" role="separator"><span class="ui-label">{longDay(post.at)}</span></div>{/if}
        <article class="post" class:grouped class:private={post.ref.audience === 'private'} data-testid="team-post" data-post-id={post.ref.id} data-author={post.ref.author} data-audience={post.ref.audience}>
          <div class="gutter">
            {#if grouped}<time class="aside" datetime={new Date(post.at).toISOString()} title={fullTime(post.at)}>{dayClock(post.at)}</time>
            {:else if own}<span class="owner-avatar" aria-hidden="true"><UserRound size={16} strokeWidth={1.75} /></span>
            {:else}<AgentAvatar kind="profile" id={botId} name={nameOf(post.ref.author)} avatar={profileOf(botId)?.avatar ?? ''} size={28} />{/if}
          </div>
          <div class="main">
            {#if !grouped}
              <div class="head">
                <span class="author" class:own data-testid="team-post-author">{nameOf(post.ref.author)}</span>
                <time datetime={new Date(post.at).toISOString()} title={fullTime(post.at)}>{dayClock(post.at)}</time>
              </div>
            {/if}
            {#if post.ref.audience === 'private'}
              <span class="private-chip" data-testid="team-post-private"><Lock size={12} />{fill(labels.privateTo, { name: nameOf(post.ref.to[0] ?? TEAM_OWNER, true) })}</span>
            {/if}
            {#if replied}
              <button type="button" class="quote" onclick={() => jump(replied.ref.id)} data-testid="team-post-quote">
                <span class="ui-label">{fill(labels.replyTo, { name: nameOf(replied.ref.author, true) })}</span>
                <span class="excerpt">{excerpt(replied.text)}</span>
              </button>
            {/if}
            <div class="body"><Prose text={post.text} {store} threadId={thread.id} /></div>
            {#if line}<p class="woke" class:nobody={line.nobody} data-testid="team-post-woke">{line.text}</p>{/if}
          </div>
          {#if !closed && team}
            <button type="button" class="ghost small icon reply" title={labels.reply} aria-label={labels.reply} onclick={() => answer(post)} data-testid="team-post-reply"><Reply size={14} /></button>
          {/if}
        </article>
      {/each}
      {#if thread.messagesAfter}
        <button type="button" class="ghost small page" disabled={store.loadingNewer} onclick={() => void store.loadNewer()} data-testid="team-newer"><ArrowDown size={14} /><span class="ui-label">{labels.newer}</span></button>
      {/if}
    </div>
  </div>

  {#if team?.paused && !closed}<p class="banner" data-testid="team-paused"><Pause size={14} /><span>{labels.paused}</span></p>{/if}
  {#if closed}
    <p class="closed" data-testid="team-closed">{#if team?.archived}<Archive size={14} />{/if}<span>{closed}</span></p>
  {:else if team}
    <TeamComposer {store} {team} draftKey={`${store.core?.coreId ?? ''}:${team.id}`} bind:reply onsent={sent} />
  {/if}
</section>

<style>
  .team-chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }

  .members { flex: none; padding: 8px 20px; border-bottom: 1px solid var(--color-border); }
  .member-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; max-width: var(--content); margin: 0 auto; }
  .member { gap: 6px; height: var(--control); padding: 0 8px 0 4px; border-radius: var(--radius-full); color: var(--color-foreground); }
  .member:disabled { opacity: 1; cursor: default; }
  .brief { max-width: var(--content); margin: 4px auto 0; color: var(--color-muted-foreground); font-size: var(--text-sm); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }

  .scroller { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .column { display: flex; flex-direction: column; max-width: var(--content); margin: 0 auto; padding: 12px 20px 8px; }
  .page { align-self: center; gap: 6px; margin: 4px 0 8px; color: var(--color-muted-foreground); }
  .placeholder { margin: 48px auto; max-width: 420px; color: var(--color-muted-foreground); text-align: center; font-size: var(--text-sm); }

  .day { display: flex; align-items: center; gap: 10px; margin: 16px 0 8px; color: var(--color-subtle); font-size: var(--text-xs); }
  .day::before, .day::after { content: ''; flex: 1; height: 1px; background: var(--color-border); }

  .post { position: relative; display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 0 8px; margin-top: 10px; padding: 4px 6px; border-radius: var(--radius-md); }
  .post.grouped { margin-top: 0; }
  .post:hover { background: var(--color-hover); }
  .gutter { display: flex; justify-content: center; padding-top: 2px; }
  .owner-avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--color-accent-soft); color: var(--color-accent); }
  .aside { visibility: hidden; padding-top: 3px; color: var(--color-subtle); font-size: 10px; font-variant-numeric: tabular-nums; }
  .post:hover .aside { visibility: visible; }
  .main { min-width: 0; }
  .head { display: flex; align-items: baseline; gap: 8px; }
  .author { font-weight: 600; color: var(--color-foreground); }
  .author.own { color: var(--color-accent); }
  .head time { color: var(--color-subtle); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .private-chip { display: inline-flex; align-items: center; gap: 4px; margin: 2px 0; padding: 1px 8px; border-radius: var(--radius-full); background: var(--color-accent-soft); color: var(--color-accent); font-size: var(--text-xs); font-weight: 500; }
  .quote { display: flex; align-items: baseline; gap: 6px; max-width: 100%; margin: 2px 0 4px; padding: 2px 8px; border: 0; border-left: 2px solid var(--color-border); border-radius: 0; background: transparent; color: var(--color-muted-foreground); font-size: var(--text-sm); text-align: left; cursor: pointer; }
  .quote:hover { border-left-color: var(--color-accent); }
  .quote .ui-label { flex: none; font-weight: 600; }
  .quote .excerpt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .body { min-width: 0; overflow-wrap: anywhere; }
  .woke { margin-top: 2px; color: var(--color-subtle); font-size: var(--text-xs); }
  .woke.nobody { color: var(--color-live); }
  .reply { opacity: 0; align-self: start; }
  .post:hover .reply, .post:focus-within .reply { opacity: 1; }
  @media (hover: none) { .reply { opacity: 1; } }

  .banner, .closed { display: flex; align-items: center; justify-content: center; gap: 8px; flex: none; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .banner { margin: 0 auto; padding: 6px 20px 0; max-width: var(--content); }
  .closed {
    width: min(calc(100% - 40px), var(--content));
    margin: 8px auto 16px;
    padding: 12px 14px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    text-align: center;
  }

  @media (max-width: 720px) {
    .members { padding: 6px 12px; }
    .member-row { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .member { flex: none; height: var(--touch-target); }
    .brief { display: none; }
    .column { padding: 8px 12px; }
    .post { grid-template-columns: 32px minmax(0, 1fr) auto; padding: 4px 2px; }
    .post:hover { background: transparent; }
    .reply { width: var(--touch-target); height: var(--touch-target); }
  }
</style>
