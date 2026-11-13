<script lang="ts" module>
  import type { TeamMemberKey, TeamParty } from '@boite/contracts';

  /** The post the owner answers: its id, its author and its first words. */
  export interface TeamReply { id: string; author: TeamParty; excerpt: string }

  /** What the owner was writing in each team, kept while the app runs, as a thread's draft is. */
  const drafts = new Map<string, { text: string; privateTo: TeamMemberKey | null }>();
</script>

<script lang="ts">
  import { markFeature } from '@boite/contracts';
  import { untrack } from 'svelte';
  import { ArrowUp, AtSign, ChevronDown, CornerDownRight, Lock, LoaderCircle, UsersRound, X } from '@lucide/svelte';
  import { routeTeamPost, TEAM_OWNER, TEAM_POST_MAX, type Team, type TeamMember } from '@boite/contracts';
  import { errorText } from '../../lib/errors';
  import { hasKeyboard } from '../../lib/live-input';
  import { separator, type MenuItem } from '../../lib/menu';
  import { secureId } from '../../lib/secure-id';
  import { count } from '../../lib/format';
  import { fill, strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';
  import { listNames, partyName } from '../../lib/teams.svelte';
  import Menu from '../Menu.svelte';

  /**
   * The owner's composer in a team chat (`docs/internals/teams.md`). A post that names
   * nobody wakes every member; `@name` or the mention menu wakes only the bots
   * it names, `@everyone` or `@tous` every member, and the words beside the send
   * button, where a thread's composer keeps its hint, say who the core will
   * wake, from the same rule it applies (`routeTeamPost`). The card and its bar
   * are the thread composer's (`Composer.svelte`, `ComposerBar.svelte`). The audience menu makes the post private
   * to one member. A post keeps its id until it lands, so a retry after a lost
   * answer returns the same post.
   */
  let { store, team, draftKey, reply = $bindable(null), onsent }: {
    store: Store;
    team: Team;
    /** The machine and team the draft belongs to. */
    draftKey: string;
    reply?: TeamReply | null;
    onsent?: () => void;
  } = $props();
  const labels = $derived(strings.teamChat.composer);

  const kept = untrack(() => drafts.get(draftKey));
  let text = $state(kept?.text ?? '');
  let privateTo = $state<TeamMemberKey | null>(kept?.privateTo ?? null);
  let sending = $state(false);
  let error = $state<string | null>(null);
  let field = $state<HTMLTextAreaElement>();
  /** The id of the post on its way, for as long as its content stays the same. */
  let attempt: { id: string; fingerprint: string } | null = null;

  function keep() {
    if (text || privateTo) drafts.set(draftKey, { text, privateTo });
    else drafts.delete(draftKey);
  }

  /** A member who left, or a team that changed: the post goes to the whole team again. */
  const recipient = $derived(privateTo === null ? null : team.members.find(member => member.key === privateTo) ?? null);
  const body = $derived(text.trim());
  const tooLong = $derived(body.length > TEAM_POST_MAX);
  const ready = $derived(store.connection === 'ready' && !!store.client);
  const canSend = $derived(ready && !sending && body.length > 0 && !tooLong);

  const routing = $derived(routeTeamPost(team, {
    author: TEAM_OWNER,
    text: body,
    audience: recipient ? 'private' : 'team',
    to: recipient ? [recipient.key] : [],
    inReplyTo: reply?.id ?? null,
  }, reply?.author ?? null));
  /** Who the post wakes, said before it goes: a post that names nobody wakes every member. */
  const wakes = $derived.by(() => {
    if (recipient) return fill(labels.wakesPrivate, { name: recipient.name });
    if (routing.routedBy === 'everyone') return labels.wakesEveryone;
    const woken = routing.to.filter(party => party !== TEAM_OWNER);
    if (routing.routedBy === 'reply') return fill(labels.wakesReply, { name: partyName(team, woken[0]!) });
    return fill(labels.wakes, { names: listNames(woken.map(party => partyName(team, party))) });
  });

  /** A bot of another machine says which, beside its name. */
  const machineHint = (member: TeamMember) => (member.machine ? { hint: member.machine } : {});
  const audienceItems = $derived<MenuItem[]>([
    { id: 'team', label: labels.everyoneReads, glyph: UsersRound, active: !recipient },
    separator(),
    ...team.members.map(member => ({ id: member.key, label: fill(labels.onlyReads, { name: member.name }), glyph: Lock, active: recipient?.key === member.key, ...machineHint(member) })),
  ]);
  const mentionItems = $derived<MenuItem[]>([
    { id: 'everyone', label: labels.everyone, hint: labels.everyoneLabel },
    separator(),
    ...team.members.map(member => ({ id: member.key, label: `@${member.name.trim()}`, ...machineHint(member) })),
  ]);

  function pickAudience(id: string) {
    privateTo = id === 'team' ? null : id as TeamMemberKey;
    keep();
    field?.focus();
  }
  /** The mention goes where the caret is, with a space on each side it needs. */
  function mention(id: string) {
    const name = id === 'everyone' ? labels.everyone : `@${team.members.find(member => member.key === id)?.name.trim() ?? ''}`;
    if (name === '@') return;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const inserted = `${lead}${name} `;
    text = `${before}${inserted}${after.replace(/^ /, '')}`;
    keep();
    const caret = before.length + inserted.length;
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(caret, caret); });
  }

  async function send() {
    const client = store.client;
    if (!client || !canSend) return;
    const params = {
      teamId: team.id,
      text: body,
      ...(recipient ? { audience: 'private' as const, to: [recipient.botId] } : {}),
      ...(reply ? { inReplyTo: reply.id } : {}),
    };
    const fingerprint = JSON.stringify(params);
    if (attempt?.fingerprint !== fingerprint) attempt = { id: secureId(), fingerprint };
    sending = true;
    error = null;
    try {
      await client.call('teams.post', { ...params, id: attempt.id });
      attempt = null;
      text = '';
      reply = null;
      keep();
      onsent?.();
    } catch (failure) {
      error = errorText(failure);
    } finally {
      sending = false;
    }
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && reply) {
      event.preventDefault();
      event.stopPropagation();
      reply = null;
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !hasKeyboard()) return;
    event.preventDefault();
    void send();
  }

  // Answering a post brings the caret to the field.
  $effect(() => { if (reply) untrack(() => field?.focus()); });
  // Marks this module in a bundle: a call no bundler drops (scripts/ci/feature-cut.ts).
  markFeature('boite-feature:teams');
</script>

<div class="composer-wrap team-composer-wrap">
  <div class="composer" data-testid="team-composer" data-private={recipient ? 'true' : undefined}>
    {#if reply}
      <div class="replying" data-testid="team-replying">
        <CornerDownRight size={14} />
        <span class="ui-label">{fill(labels.replying, { name: partyName(team, reply.author, true) })}</span>
        <span class="excerpt">{reply.excerpt}</span>
        <button type="button" class="ghost small icon" title={labels.cancelReply} aria-label={labels.cancelReply} onclick={() => { reply = null; field?.focus(); }} data-testid="team-reply-cancel"><X size={14} /></button>
      </div>
    {/if}
    <textarea
      bind:this={field}
      bind:value={text}
      rows="1"
      placeholder={recipient ? fill(labels.placeholderPrivate, { name: recipient.name }) : labels.placeholder}
      aria-label={recipient ? fill(labels.placeholderPrivate, { name: recipient.name }) : labels.placeholder}
      oninput={keep}
      onkeydown={keydown}
      data-testid="team-composer-input"
    ></textarea>
    <div class="bar">
      <div class="chips">
        <Menu items={audienceItems} onpick={pickAudience} label={labels.audience} testid="team-audience">
          {#if recipient}<Lock size={14} /><span class="ui-label">{fill(labels.onlyReads, { name: recipient.name })}</span>
          {:else}<UsersRound size={14} /><span class="ui-label">{labels.everyoneReads}</span>{/if}
          <ChevronDown size={14} />
        </Menu>
        {#if !recipient}
          <Menu items={mentionItems} onpick={mention} label={labels.mention} testid="team-mention">
            <AtSign size={14} /><span class="ui-label mention-label">{labels.mention}</span>
          </Menu>
        {/if}
      </div>
      {#if !error && !tooLong}<span class="wakes" title={wakes} data-testid="team-wakes" aria-live="polite">{wakes}</span>{/if}
      <button
        type="button"
        class="primary icon send"
        data-testid="team-send"
        title={sending ? labels.sending : labels.send}
        aria-label={sending ? labels.sending : labels.send}
        disabled={!canSend}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => void send()}
      >{#if sending}<LoaderCircle class="spinner" size={16} />{:else}<ArrowUp size={16} strokeWidth={2.25} />{/if}</button>
    </div>
  </div>
  {#if error}<p class="note error" role="alert" data-testid="team-composer-error">{error}</p>
  {:else if tooLong}<p class="note error" role="alert" data-testid="team-composer-error">{fill(labels.tooLong, { max: count(TEAM_POST_MAX) })}</p>{/if}
</div>

<style>
  /* The thread composer's card (Composer.svelte): `composer-wrap` and `composer` also take the app's focus edge (app.css). */
  .composer-wrap { position: relative; flex: none; padding: 8px 20px 16px; }
  .composer {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--content);
    margin: 0 auto;
    background: var(--color-composer-surface);
    border: 1px solid var(--color-composer-edge);
    border-radius: var(--radius-composer);
    container: composer / inline-size;
    box-shadow: var(--shadow-composer);
    transition: border-color var(--motion-duration) var(--motion-curve), box-shadow var(--motion-duration) var(--motion-curve);
  }
  /* A private post is written in a dashed card, as it will read in the chat. */
  .composer[data-private] { border-style: dashed; }
  textarea {
    display: block;
    width: 100%;
    min-height: calc(1lh + 14px);
    max-height: min(200px, calc(8lh + 16px));
    field-sizing: content;
    resize: none;
    padding: 14px 16px 0;
    border: 0;
    background: transparent;
    color: var(--color-foreground);
    font: inherit;
    font-size: var(--text-reading);
    line-height: var(--leading-reading);
    outline: none;
  }
  textarea::placeholder { color: var(--color-subtle); }

  /* The thread bar's row and chips (ComposerBar.svelte): no frame, muted ink, a fill only under the pointer or while the menu is open. */
  .bar { display: flex; align-items: flex-end; gap: 8px; padding: 4px 8px 8px 10px; }
  .chips { flex: 0 1 auto; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
  .chips :global(.trigger) {
    width: auto;
    height: var(--control-head);
    padding: 0 10px;
    gap: 7px;
    border-color: transparent;
    border-radius: var(--radius-md);
    background: transparent;
    box-shadow: none;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
    transition: background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint), transform var(--motion-duration) var(--motion-curve);
  }
  .chips :global(.trigger > .lucide-chevron-down) { flex: none; opacity: .6; }
  .chips :global(.trigger[aria-expanded='true']) { border-color: transparent; background: var(--color-hover); color: var(--color-foreground); }
  @media (hover: hover) { .chips :global(.trigger:hover) { border-color: transparent; background: var(--color-hover); color: var(--color-foreground); } }
  .chips :global(button.trigger:active:not(:disabled)), .send:active:not(:disabled) { transform: scale(calc(1 - .06 * var(--motion))); transition-duration: var(--dur-1); }
  .composer[data-private] .chips :global(.menu:first-child .trigger) { color: var(--color-foreground); }

  /* Who the post wakes, where a thread's composer keeps its hint: beside send, in the subtle ink. */
  .wakes { flex: 1 1 0; align-self: center; min-width: 0; text-align: right; overflow: hidden; color: var(--color-subtle); font-size: var(--text-sm); text-overflow: ellipsis; white-space: nowrap; }
  .send { flex: none; width: 32px; height: 32px; border-radius: var(--radius-full); box-shadow: var(--shadow-send); transition: background var(--dur-2) var(--ease-out-quint), opacity var(--dur-2) var(--ease-out-quint), transform var(--motion-duration) var(--motion-curve); }
  .send :global(.spinner) { animation: spin 1s linear infinite var(--loops); }

  .replying { display: flex; align-items: center; gap: 8px; margin: 8px 8px 0; padding: 2px 4px 2px 10px; border-radius: var(--radius-md); background: var(--color-hover); color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .replying :global(svg) { flex: none; }
  .replying .ui-label { flex: none; color: var(--color-foreground); font-weight: 500; }
  .excerpt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .note { max-width: var(--content); margin: 6px auto 0; padding: 0 14px; color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .note.error { color: var(--color-danger); }
  @media (prefers-reduced-motion: reduce) { .send :global(.spinner) { animation: none; } }
  @media (max-width: 720px) {
    .composer-wrap { padding: 8px 12px max(10px, env(safe-area-inset-bottom)); }
    .composer { border-radius: var(--radius-xl); }
    textarea { font-size: var(--text-md); }
    .bar { align-items: center; }
    .chips { flex: none; flex-wrap: nowrap; max-width: 70%; }
    .chips :global(.trigger) { height: var(--touch-target); }
    .mention-label { display: none; }
    .send { width: var(--touch-target); height: var(--touch-target); }
  }
  @media (max-width: 400px) { .composer-wrap { padding-inline: 8px; } }
</style>
