<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Check, X } from '@lucide/svelte';
  import type { Team } from '@boite/contracts';
  import type { AgentsView } from '../../lib/agents.svelte';
  import { Closing } from '../../lib/closing.svelte';
  import { errorText } from '../../lib/errors';
  import { focusedElement, restoreFocus } from '../../lib/focus';
  import { count } from '../../lib/format';
  import { mobileOverlay } from '../../lib/mobile-history';
  import { fill, strings } from '../../lib/strings';
  import { draftKey, draftProblem, saveTeam, teamChoices, TEAM_LIMITS, type TeamChoice } from '../../lib/team-draft';
  import { teamsOf } from '../../lib/teams.svelte';
  import type { Machine } from '../../lib/workspace.svelte';
  import AgentAvatar from '../agents/AgentAvatar.svelte';
  import InfoTip from '../InfoTip.svelte';

  /**
   * A team written by hand (`docs/teams.md`, In the app): its name, its brief
   * and its members, picked among the bots of the page's machine and of the
   * other machines of its group, each of those with its machine's name. A bot
   * of a machine outside the group, and a bot on its way to another machine,
   * are listed and cannot be picked; the "i" beside says why. Without `team` it
   * creates one on the page's machine; with it, it brings that team to what
   * was written.
   */
  let { view, others = [], team = null, onclose, ondone }: {
    /** The page's machine: the one the team is created on. */
    view: AgentsView;
    /** The other machines' bots: those of its group can join, the rest are listed greyed. */
    others?: readonly { machine: Machine; view: AgentsView }[];
    team?: Team | null;
    onclose: () => void;
    ondone: (team: Team) => void;
  } = $props();

  const words = $derived(strings.teamChat.dialog);
  const uid = $props.id();
  const overlay = new Closing();
  // The form starts from the team it edits, once: a `teams.changed` under it must not overwrite what is typed.
  const initial = (() => team)();
  let name = $state(initial?.name ?? '');
  let brief = $state(initial?.brief ?? '');
  let picked = $state<string[]>(initial?.members.map(draftKey) ?? []);
  let tried = $state(false);
  let busy = $state(false);
  let failure = $state<string | null>(null);
  /** The bot whose reason a tap on its greyed row put under the list, for a screen with no hover. */
  let told = $state<string | null>(null);
  let dialog = $state<HTMLDivElement>();
  let nameField = $state<HTMLInputElement>();
  let previous: HTMLElement | null = null;

  const choices = $derived(teamChoices(view, others, initial));
  const full = $derived(picked.length >= TEAM_LIMITS.members);
  /** Why a row cannot be picked now: its own reason, or a full team. A picked member can always be taken out. */
  function blocked(choice: TeamChoice): string | null {
    if (picked.includes(choice.key)) return null;
    if (choice.gone) return words.goneOut;
    return choice.reason ?? (initial?.archived ? words.archived : full ? fill(words.full, { max: count(TEAM_LIMITS.members) }) : null);
  }
  /** What the row's "i" says: why it cannot be picked, or, picked, what keeps it from staying (gone, moving), so the row to clear shows. */
  const why = (choice: TeamChoice): string | null => blocked(choice) ?? choice.reason;
  const problem = $derived(draftProblem({ name, brief, members: picked }, teamsOf(view.store).teams, initial?.id ?? null));
  /** A taken name says so as it is typed; the rest waits for the first try. */
  const shown = $derived(failure ?? (problem && (tried || problem.field === 'taken') ? problem.text : null));
  const nameWrong = $derived(failure === null && !!problem && problem.field !== 'members' && (tried || problem.field === 'taken'));
  /** This machine's bots, moving ones included: those are listed greyed, so the list is not empty. */
  const localBots = $derived((view.snapshot?.profiles ?? []).filter(profile => profile.status !== 'archived').length);

  function portal(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }

  onMount(() => {
    previous = focusedElement();
    overlay.show();
    void tick().then(() => { nameField?.focus({ preventScroll: true }); if (initial) nameField?.select(); });
  });
  $effect(() => { if (overlay.open) return mobileOverlay(close); });

  function close() { if (!overlay.open) return; overlay.hide(); restoreFocus(previous); }
  let opened = false;
  $effect(() => { if (overlay.shown) opened = true; else if (opened) onclose(); });

  function toggle(choice: TeamChoice) {
    const reason = blocked(choice);
    if (reason) { told = choice.key; return; }
    told = null;
    failure = null;
    picked = picked.includes(choice.key) ? picked.filter(key => key !== choice.key) : [...picked, choice.key];
  }

  async function submit() {
    tried = true;
    if (problem || busy) return;
    busy = true;
    failure = null;
    try {
      const saved = await saveTeam(view, initial, { name, brief, members: picked });
      void teamsOf(view.store).refresh();
      ondone(saved);
      close();
    } catch (error) {
      failure = errorText(error);
      void teamsOf(view.store).refresh();
    } finally { busy = false; }
  }

  const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
  function onkeydown(event: KeyboardEvent) {
    if (!overlay.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') trap(event);
    if (event.key === 'Enter' && !event.isComposing && dialog?.contains(event.target as Node)
      && (event.target instanceof HTMLInputElement || (event.target instanceof HTMLTextAreaElement && (event.ctrlKey || event.metaKey)))) {
      event.preventDefault();
      event.stopPropagation();
      void submit();
    }
  }
  /** While the dialog is up the keyboard cannot leave it. */
  function trap(event: KeyboardEvent) {
    const stops = Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = stops[0], last = stops.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    const inside = active instanceof Node && !!dialog?.contains(active);
    if (inside && active !== (event.shiftKey ? first : last)) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if overlay.shown}
  <div class="scrim" class:closing={overlay.closing} role="presentation" use:portal use:overlay.attach onanimationend={overlay.end}
    onclick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div class="dialog" class:closing={overlay.closing} role="dialog" aria-modal="true" aria-labelledby="{uid}-title" tabindex="-1" data-testid="team-dialog" bind:this={dialog}>
      <div class="head">
        <div class="titles">
          <h2 id="{uid}-title">{initial ? fill(words.editTitle, { team: initial.name }) : words.createTitle}</h2>
          {#if !initial}<p class="muted">{words.intro}</p>{/if}
        </div>
        <button type="button" class="ghost icon" aria-label={strings.common.close} title={strings.common.close} onclick={close} data-testid="team-dialog-close"><X size={16} /></button>
      </div>

      <div class="body">
        <label class="field">{words.name}
          <input bind:this={nameField} bind:value={name} maxlength={TEAM_LIMITS.name} placeholder={words.namePlaceholder} autocomplete="off" aria-invalid={nameWrong ? 'true' : undefined} data-testid="team-dialog-name" />
        </label>
        <label class="field"><span>{words.brief}<span class="hint">{words.briefHint}</span></span>
          <textarea bind:value={brief} rows="2" maxlength={TEAM_LIMITS.brief} placeholder={words.briefPlaceholder} data-testid="team-dialog-brief"></textarea>
        </label>

        <div class="field">
          <div class="members-head"><span id="{uid}-members">{words.members}</span><span class="mono count" data-testid="team-dialog-count">{fill(words.selected, { count: count(picked.length), max: count(TEAM_LIMITS.members) })}</span></div>
          {#if localBots === 0 && !initial}<p class="note" data-testid="team-dialog-nobots">{words.noBots}</p>{/if}
          <ul class="choices" role="group" aria-labelledby="{uid}-members" data-testid="team-dialog-members">
            {#each choices as choice (choice.key)}
              {@const on = picked.includes(choice.key)}
              {@const reason = blocked(choice)}
              {@const tip = why(choice)}
              <li class="choice-row">
                <button type="button" class="choice" class:on aria-pressed={on} aria-disabled={reason ? 'true' : undefined} title={reason ?? undefined}
                  onclick={() => toggle(choice)} data-testid="team-dialog-member" data-bot-id={choice.botId} data-key={choice.key}>
                  <AgentAvatar kind="profile" id={choice.botId} name={choice.name} avatar={choice.avatar} size={26} />
                  <span class="choice-name">{choice.name}</span>
                  {#if choice.machine}<span class="choice-machine ui-label" data-testid="team-dialog-machine">{choice.machine}</span>{/if}
                  <span class="mark" aria-hidden="true">{#if on}<Check size={14} strokeWidth={2.25} />{/if}</span>
                </button>
                {#if tip}<InfoTip topic={fill(words.why, { name: choice.name })} text={tip} testid="team-dialog-why" />{/if}
              </li>
            {/each}
          </ul>
          {#if told}{@const reason = choices.find(choice => choice.key === told)}{#if reason && blocked(reason)}<p class="note" role="status" data-testid="team-dialog-told">{blocked(reason)}</p>{/if}{/if}
        </div>
      </div>

      <div class="foot">
        {#if shown}<p class="problem" role="alert" data-testid="team-dialog-problem">{shown}</p>{/if}
        <div class="actions">
          <button type="button" class="ghost" onclick={close} data-testid="team-dialog-cancel"><span class="ui-label">{strings.common.cancel}</span></button>
          <button type="button" class="primary" disabled={busy} onclick={() => void submit()} data-testid="team-dialog-submit">
            <span class="ui-label">{busy ? (initial ? words.saving : words.creating) : initial ? words.save : words.create}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 70; display: flex; align-items: flex-start; justify-content: center; padding-top: min(10vh, 90px);
    background: var(--color-scrim); animation: fade var(--dur-2) var(--ease-out-quint); }
  .scrim.closing { animation-name: fade-out; pointer-events: none; }
  .dialog { width: min(460px, calc(100vw - 32px)); max-height: min(80vh, 720px); display: flex; flex-direction: column;
    background: var(--color-surface); border: 1px solid var(--color-edge); border-radius: var(--radius-xl); box-shadow: var(--shadow-e3);
    overflow: hidden; animation: pop var(--dur-2) var(--ease-out-quint); color: var(--color-foreground); }
  .dialog.closing { animation-name: pop-out; }
  .dialog:focus { outline: none; }
  .head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 14px 12px 18px; }
  .titles { flex: 1; min-width: 0; }
  h2 { font-size: var(--text-md); margin: 0 0 4px; overflow-wrap: anywhere; }
  .muted { margin: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .body { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 4px 18px 12px; display: flex; flex-direction: column; gap: 14px; }
  .field { display: flex; flex-direction: column; gap: 6px; font-size: var(--text-sm); font-weight: 500; min-width: 0; }
  .field > span:first-child { display: flex; flex-direction: column; gap: 2px; }
  .hint { font-weight: 400; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .field input, .field textarea { width: 100%; box-sizing: border-box; font-weight: 400; }
  .field textarea { resize: vertical; min-height: 56px; font-family: inherit; line-height: 1.5; }
  .members-head { display: flex; justify-content: space-between; align-items: baseline; }
  .count { font-weight: 400; font-size: var(--text-xs); color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  .choices { list-style: none; margin: 0; padding: 4px; display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow: auto;
    border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--color-surface-2) 55%, transparent); }
  .choice-row { display: flex; align-items: center; gap: 2px; }
  .choice { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; min-height: var(--row); padding: 4px 8px; border: none; border-radius: var(--radius-md);
    background: transparent; color: inherit; font-weight: 400; text-align: left; cursor: pointer; transition: background var(--dur-2) var(--ease-out-quint); }
  .choice:hover, .choice:focus-visible { background: var(--color-hover); }
  .choice.on { background: var(--color-active); }
  .choice[aria-disabled='true'] { cursor: default; opacity: 0.5; }
  .choice[aria-disabled='true']:hover { background: transparent; }
  .choice-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .choice-machine { min-width: 0; max-width: 16ch; overflow: hidden; color: var(--color-muted-foreground); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
  .mark { flex: none; display: grid; place-items: center; width: 18px; height: 18px; border: 1px solid var(--color-edge); border-radius: var(--radius-sm);
    color: var(--color-accent-ink); transition: background var(--dur-2) var(--ease-out-quint), border-color var(--dur-2) var(--ease-out-quint); }
  .choice.on .mark { background: var(--color-foreground); border-color: var(--color-foreground); }
  .note { margin: 0; font-size: var(--text-xs); font-weight: 400; line-height: 1.5; color: var(--color-muted-foreground); }
  .foot { padding: 10px 18px 14px; border-top: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 8px; }
  .problem { margin: 0; font-size: var(--text-xs); color: var(--color-danger); }
  .actions { display: flex; justify-content: flex-end; gap: 6px; }
  @media (max-width: 720px) {
    .scrim { padding-top: 0; align-items: flex-end; }
    .dialog { width: 100%; max-height: calc(100dvh - 24px); border-radius: var(--radius-xl) var(--radius-xl) 0 0; border-bottom: none; }
    .head { padding: 14px 8px 10px 14px; }
    .head .icon { width: var(--touch-target); height: var(--touch-target); }
    .body { padding: 4px 14px 12px; }
    .choice { min-height: var(--touch-target); }
    .foot { padding: 10px 14px calc(14px + env(safe-area-inset-bottom)); }
    .actions button { min-height: var(--touch-target); }
  }
</style>
