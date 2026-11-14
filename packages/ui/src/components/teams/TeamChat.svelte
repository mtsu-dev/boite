<script lang="ts">
  import { markFeature } from '@boite/contracts';
  import { tick } from 'svelte';
  import { Archive, ArrowDown, ArrowUp, CornerDownRight, Lock, Pause, Reply } from '@lucide/svelte';
  import { TEAM_OWNER, type AgentProfile, type Message, type TeamParty, type TeamPostRef, type Thread } from '@boite/contracts';
  import { agentDirectory, followAgentDirectories } from '../../lib/agent-directory.svelte';
  import { experimentOn } from '../../lib/experiments.svelte';
  import { avatarLit } from '../../lib/avatar-lit';
  import { dayClock, fullTime } from '../../lib/format';
  import { fill, strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';
  import { botIdOf, followTeams, listNames, teamsOf } from '../../lib/teams.svelte';
  import AgentAvatar from '../agents/AgentAvatar.svelte';
  import DayDivider from '../DayDivider.svelte';
  import Prose from '../Prose.svelte';
  import TeamComposer, { type TeamReply } from './TeamComposer.svelte';

  /**
   * A team's chat (`docs/internals/teams.md`), in a thread's language: one reading
   * column, a bot's post as an answer under its picture and name, the owner's
   * as a bubble on the right, the calendar's chip between two days, and the
   * composer's card under them. Who a post woke, that it was private and the
   * post it answers are one quiet line each. The column opens on the room
   * itself: its members, each opening its bot, and what the team is for. The
   * posts are the thread's messages, so they arrive live, page like a
   * thread's, and the chat reads as read once opened.
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
  /** The chat is about these bots: their pictures keep their colours here (`lib/avatar-lit.ts`). */
  const LIT = avatarLit({ open: true });
  /** Only a post that lands while the chat is open rises; the ones it opened on stand still. */
  const openedAt = Date.now();

  function profileOf(botId: string): Pick<AgentProfile, 'id' | 'name' | 'avatar'> | undefined {
    return profiles.find(profile => profile.id === botId);
  }
  /** You (you inside a sentence), a member's name, the name of a bot that left, else the bot id its key holds. */
  function nameOf(party: TeamParty, inText = false): string {
    if (party === TEAM_OWNER) return inText ? labels.youInText : labels.you;
    const botId = botIdOf(party);
    return team?.members.find(member => member.key === party)?.name ?? profileOf(botId)?.name ?? botId;
  }
  /** The machine a member of another machine runs on; a bot of the team's own machine says nothing. */
  const machineOf = (party: TeamParty) => team?.members.find(member => member.key === party)?.machine;
  const dayOf = (at: number) => new Date(at).toDateString();
  /** A post under one of the same author's a few minutes before reads as its continuation. */
  function continues(previous: Post | undefined, post: Post): boolean {
    return !!previous && previous.ref.author === post.ref.author && previous.ref.audience === 'team' && post.ref.audience === 'team'
      && !post.ref.inReplyTo && post.at - previous.at < 5 * 60_000 && dayOf(previous.at) === dayOf(post.at);
  }
  /** Who a group post woke; an owner post routed before every unnamed one woke the whole team says it woke nobody. */
  function woke({ ref }: Post): { text: string; nobody: boolean } | null {
    if (ref.audience === 'private') return null;
    const woken = ref.to.filter(party => party !== TEAM_OWNER);
    if (ref.routedBy === 'everyone' && woken.length > 0) return { text: labels.wokeEveryone, nobody: false };
    if (woken.length > 0) return { text: fill(labels.woke, { names: listNames(woken.map(party => nameOf(party))) }), nobody: false };
    if (ref.author === TEAM_OWNER && ref.routedBy === 'none') return { text: labels.nobody, nobody: true };
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
  // Marks this module in a bundle: a call no bundler drops (scripts/ci/feature-cut.ts).
  markFeature('boite-feature:teams');
</script>

<section class="team-chat" data-testid="team-chat" data-team-id={team?.id}>
  <div class="scroller" bind:this={scroller} onscroll={measure} data-testid="team-posts">
    <div class="column" bind:this={column}>
      {#if team}
        <header class="about" data-testid="team-members">
          <div class="member-row" role="group" aria-label={labels.members}>
            {#each team.members as member (member.key)}
              {@const profile = profileOf(member.botId)}
              <button type="button" class="ghost member" title={member.machine ? `${member.name} (${member.machine})` : member.name} disabled={!profile} onclick={() => store.showAgents(member.botId)} data-testid="team-member" data-bot-id={member.botId}>
                <AgentAvatar kind="profile" id={member.botId} name={member.name} avatar={profile?.avatar ?? ''} size={20} lit={LIT} />
                <span class="ui-label">{member.name}</span>
                {#if member.machine}<span class="machine ui-label" data-testid="team-member-machine">{member.machine}</span>{/if}
              </button>
            {/each}
          </div>
          {#if team.brief}<p class="brief">{team.brief}</p>{/if}
        </header>
      {/if}
      {#if thread.messagesBefore !== null}
        <button type="button" class="ghost small page" disabled={store.loadingOlder} onclick={() => void earlier()} data-testid="team-earlier"><ArrowUp size={14} /><span class="ui-label">{labels.earlier}</span></button>
      {/if}
      {#if loading}
        <p class="placeholder" data-testid="team-loading">{labels.loading}</p>
      {:else if posts.length === 0}
        <p class="placeholder" data-testid="team-empty">{fill(labels.empty, { mention: labels.composer.name })}</p>
      {/if}
      {#each posts as post, index (post.message.id)}
        {@const previous = posts[index - 1]}
        {@const day = !previous || dayOf(previous.at) !== dayOf(post.at)}
        {@const grouped = !day && continues(previous, post)}
        {@const own = post.ref.author === TEAM_OWNER}
        {@const botId = own ? '' : botIdOf(post.ref.author)}
        {@const secret = post.ref.audience === 'private'}
        {@const replied = post.ref.inReplyTo ? byId.get(post.ref.inReplyTo) : undefined}
        {@const line = woke(post)}
        {#if day}<div class="day-slot"><DayDivider at={post.at} /></div>{/if}
        <article class="post" class:fresh={post.at >= openedAt} class:own class:grouped class:private={secret} data-testid="team-post" data-post-id={post.ref.id} data-author={post.ref.author} data-audience={post.ref.audience}>
          {#if own}
            {#if !grouped}<span class="visually-hidden" data-testid="team-post-author">{nameOf(post.ref.author)}</span>{/if}
          {:else if !grouped}
            <div class="byline">
              <span class="face"><AgentAvatar kind="profile" id={botId} name={nameOf(post.ref.author)} avatar={profileOf(botId)?.avatar ?? ''} size={20} lit={LIT} /></span>
              <span class="author" data-testid="team-post-author">{nameOf(post.ref.author)}</span>
              {#if machineOf(post.ref.author)}<span class="machine ui-label" data-testid="team-post-machine">{machineOf(post.ref.author)}</span>{/if}
              <time datetime={new Date(post.at).toISOString()} title={fullTime(post.at)}>{dayClock(post.at)}</time>
            </div>
          {/if}
          {#if secret}
            <span class="meta secret" data-testid="team-post-private"><Lock size={12} />{fill(labels.privateTo, { name: nameOf(post.ref.to[0] ?? TEAM_OWNER, true) })}</span>
          {/if}
          {#if replied}
            <button type="button" class="meta quote" onclick={() => jump(replied.ref.id)} data-testid="team-post-quote">
              <CornerDownRight size={12} />
              <span class="quote-who">{fill(labels.replyTo, { name: nameOf(replied.ref.author, true) })}</span>
              <span class="excerpt">{excerpt(replied.text)}</span>
            </button>
          {/if}
          <div class="said">
            <div class="body" class:bubble={own} class:answer-bubble={!own} title={own || grouped ? fullTime(post.at) : undefined}><Prose text={post.text} {store} threadId={thread.id} /></div>
            {#if !closed && team}
              <button type="button" class="ghost small icon reply" title={labels.reply} aria-label={labels.reply} onclick={() => answer(post)} data-testid="team-post-reply"><Reply size={14} /></button>
            {/if}
          </div>
          {#if line || own}
            <p class="meta foot">
              {#if line}<span class="woke" class:nobody={line.nobody} data-testid="team-post-woke">{line.text}</span>{/if}
              {#if own}<time datetime={new Date(post.at).toISOString()} title={fullTime(post.at)}>{dayClock(post.at)}</time>{/if}
            </p>
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

  /* A thread's timeline (MessageList.svelte): one column at the dock's width, its bubbles, prose and cards sharing it. */
  .scroller { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 20px; }
  .column { display: flex; flex-direction: column; width: 100%; max-width: var(--content); margin: 0 auto; padding: 20px 0 12px; --prose: var(--content); }
  .page { align-self: center; gap: 6px; margin: 0 0 12px; color: var(--color-muted-foreground); }
  .placeholder { margin: 32px auto; max-width: 420px; color: var(--color-muted-foreground); text-align: center; font-size: var(--text-sm); }

  /* The room, where the conversation starts: who is in it and what it is for. No band, no rule: it scrolls with the posts. */
  .about { display: flex; flex-direction: column; align-items: center; gap: 8px; margin: 4px 0 20px; }
  .member-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px; }
  .member { gap: 7px; height: var(--control-head); padding: 0 10px 0 6px; border-radius: var(--radius-full); color: var(--color-foreground); font-size: var(--text-sm); font-weight: 500; }
  .member:disabled { opacity: 1; cursor: default; }
  .machine { min-width: 0; max-width: 16ch; overflow: hidden; color: var(--color-subtle); font-size: var(--text-xs); font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
  .brief { max-width: 64ch; margin: 0; color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 1.5; text-align: center; text-wrap: balance; overflow-wrap: anywhere; }

  .day-slot { display: flex; flex-direction: column; margin-top: var(--chat-message-gap); }
  .day-slot:first-child, .about + .day-slot { margin-top: 0; }
  .day-slot + .post { margin-top: 0; }

  /* One post, a thread's message: the bot's in an answer's bubble under its picture and name, the owner's a bubble on the right. */
  /* Positioned: the owner's hidden name stays inside its post, not at the end of a scrolling ancestor. */
  .post { position: relative; display: flex; flex-direction: column; align-items: flex-start; min-width: 0; margin-top: var(--chat-message-gap); }
  .post.fresh { animation: rise var(--dur-3) var(--ease-out-quint); }
  .post.own { align-items: flex-end; }
  /* The same author going on: no name again, half the gap. */
  .post.grouped { margin-top: 10px; }
  .post.own.grouped { margin-top: 6px; }

  .byline { display: flex; align-items: center; gap: 8px; min-width: 0; margin-bottom: 6px; padding-left: var(--activity-padding); }
  .face { display: inline-flex; flex: none; }
  .author { min-width: 0; overflow: hidden; color: var(--color-foreground); font-size: var(--text-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .byline time, .foot time { flex: none; color: var(--instrument-meta); font-size: var(--instrument-meta-size); font-variant-numeric: tabular-nums; }

  /* What surrounds a post: private, the post it answers, who it woke. One quiet line each, in the meta ink. */
  .meta { display: flex; align-items: center; gap: 6px; max-width: 100%; margin: 0; padding: 0 var(--activity-padding); color: var(--instrument-meta); font-size: var(--instrument-meta-size); line-height: 1.4; }
  .meta :global(svg) { flex: none; }
  .secret { margin-bottom: 4px; color: var(--color-muted-foreground); }
  .quote { height: auto; min-height: 22px; margin: 0 0 4px calc(-1 * var(--space-1)); padding: 2px calc(var(--activity-padding) + var(--space-1)); border: 0; border-radius: var(--radius-sm); background: transparent; box-shadow: none; text-align: left; cursor: pointer; transition: background var(--dur-2), color var(--dur-2); }
  .post.own .quote { margin: 0 calc(-1 * var(--space-1)) 4px 0; max-width: min(85%, var(--prose)); }
  .quote:hover, .quote:focus-visible { background: var(--color-hover); color: var(--color-foreground); }
  .quote-who { flex: none; color: var(--color-muted-foreground); font-weight: 500; }
  .quote:hover .quote-who { color: inherit; }
  .excerpt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .foot { margin-top: 4px; }
  .woke.nobody { color: var(--color-live); }

  /* The words and, beside them, the one action a post takes. */
  .said { display: flex; align-items: flex-start; gap: 4px; width: 100%; min-width: 0; }
  .post.own .said { flex-direction: row-reverse; width: auto; max-width: min(85%, var(--prose)); }
  /* A bot's words: an answer's bubble (`.answer-bubble`, app.css), as a thread draws them; the lines around it stay outside. */
  .body { flex: 0 1 auto; min-width: 0; overflow-wrap: anywhere; }
  /* The owner's own words: a prompt's bubble (UserMessage.svelte). */
  .bubble { padding: 12px 16px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: var(--radius-bubble); border-bottom-right-radius: var(--radius-sm); }
  .post.private .body { border-style: dashed; border-color: var(--color-edge); }
  .reply { flex: none; opacity: 0; color: var(--color-muted-foreground); transition: opacity var(--dur-2); }
  .post.own .reply { align-self: center; }
  .post:hover .reply, .post:focus-within .reply { opacity: 1; }
  @media (hover: none) { .reply { opacity: 1; } }

  .banner, .closed { display: flex; align-items: center; justify-content: center; gap: 8px; flex: none; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .banner { margin: 0 auto; padding: 6px 20px 0; max-width: var(--content); }
  .closed {
    width: min(calc(100% - 40px), var(--content));
    margin: 8px auto 16px;
    padding: 12px 14px;
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    text-align: center;
  }

  @media (prefers-reduced-motion: reduce) { .post.fresh { animation: none; } }
  @media (max-width: 720px) {
    .scroller { padding: 0 12px; }
    .column { padding: 12px 0 8px; }
    .about { margin-bottom: 16px; }
    .member { height: var(--touch-target); }
    .bubble { padding: 10px 14px; }
    .post.own .said, .post.own .quote { max-width: 92%; }
    .reply { width: var(--touch-target); height: var(--touch-target); margin: -8px 0; }
  }
</style>
