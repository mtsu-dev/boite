<script lang="ts">
  import PrivateText from './PrivateText.svelte';
  import { Bot, Inbox, Settings, UsersRound } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { count } from '../lib/format';
  import { workspace } from '../lib/workspace.svelte';
  import { experimentOn } from '../lib/experiments.svelte';
  import { featureOn } from '../lib/features.svelte';
  import { agentDirectory } from '../lib/agent-directory.svelte';
  import { agentRows } from '../lib/agents.svelte';
  import { contactsShown } from '../lib/contacts-rail.svelte';
  import { machineFilter } from '../lib/machine-filter.svelte';
  import { projectView } from '../lib/project-view.svelte';
  import { threadsNeedingYou } from '../lib/app-rail';
  import { feedThread, inbox } from '../lib/inbox.svelte';
  import { activityFeed, readableThreads } from '../lib/activity-feed';
  import { agentsAtWork } from '../lib/work-counts';
  import MachineStatus, { type MachineLine } from './MachineStatus.svelte';
  import { whipEntry } from '../lib/whip-entry.svelte';
  import Deferred from './Deferred.svelte';
  import LimitsButton from './LimitsButton.svelte';
  import { parts } from '../lib/deferred-parts';

  /**
   * The sidebar's compact desktop foot while the Mochi layout rail is off:
   * Activity, Contacts and Mochis on the left, then machines, updates, limits
   * and Settings on the right. Every button opens its own tooltip card above
   * it so nothing clips past the window's left edge, and every popover opens
   * beside the sidebar column.
   */
  let { store }: { store: Store } = $props();

  const machines = $derived(workspace.machinesOr(store));
  const stores = $derived(machines.map(machine => machine.store));
  const botsOn = $derived(experimentOn('resident-agents'));
  const contactsOn = $derived(contactsShown(store));

  const waiting = $derived(threadsNeedingYou(stores) + inbox.contacts);
  const waitingLabel = $derived(waiting === 1 ? strings.app.rail.waitingOne : fill(strings.app.rail.waitingMany, { count: String(waiting) }));
  const atWork = $derived(botsOn ? agentsAtWork(stores) : { count: 0, waiting: false });
  const unreadBots = $derived(botsOn ? stores.reduce((sum, s) => sum + agentRows(agentDirectory(s).snapshot).reduce((n, row) => n + (row.status?.unread ?? 0), 0), 0) : 0);
  const botsNote = $derived(atWork.count
    ? fill(atWork.waiting ? strings.sidebar.surfaceWaiting : strings.sidebar.surfaceWorking, { count: String(atWork.count) })
    : unreadBots ? (unreadBots === 1 ? strings.app.rail.unreadOne : fill(strings.app.rail.unreadMany, { count: String(unreadBots) })) : null);
  const tally = (value: number) => value > 99 ? '99+' : count(value);

  const onActivity = $derived(store.page === 'chat' && inbox.open);
  const onContacts = $derived(store.page === 'home');
  const onAgents = $derived(store.page === 'agents');
  const settingsKey = $derived(store.keyLabel('settings'));

  function showThreads() {
    inbox.open = false;
    if (store.page !== 'chat') store.showChat();
    store.sidebarCollapsed = false;
  }

  function toggleActivity() {
    if (onActivity) { showThreads(); return; }
    inbox.open = true;
    if (store.page !== 'chat') store.showChat();
    if (store.openThread) store.startDraft(undefined, { refresh: false });
    store.sidebarCollapsed = false;
  }

  function toggleContacts() {
    if (onContacts) { showThreads(); return; }
    store.showHome();
  }

  function toggleAgents() {
    if (onAgents) { showThreads(); return; }
    store.showAgents();
  }

  function holdMiddle(event: MouseEvent) {
    if (event.button === 1) event.preventDefault();
  }

  function clearFinished(event: MouseEvent) {
    if (event.button !== 1) return;
    const rows = activityFeed(machines.flatMap(machine => machine.store.threads.filter(feedThread).map(thread => ({ machine, thread, project: undefined }))));
    for (const [machine, requests] of readableThreads(rows, ['done'])) void machine.store.markRead(requests);
  }

  function pickMachine(id: string | null) {
    const entries = machines.flatMap(machine => machine.store.projects.map(project => ({ machine, project })));
    const selected = projectView.selected(entries);
    if (id && selected && selected.machine.id !== id) projectView.pick('all');
    machineFilter.set(id);
  }
</script>

{#snippet railName(label: string, key: string | null = null, note: string | null = null, keyId: string | undefined = undefined)}
  <span class="rail-name tooltip-surface" aria-hidden="true"><span class="ui-label">{label}</span>{#if note}<span class="ui-label note">{note}</span>{/if}{#if key}<span class="kbd" id={keyId}>{key}</span>{/if}</span>
{/snippet}
{#snippet statusName(label: string, note: string | null)}{@render railName(label, null, note)}{/snippet}
{#snippet limitsName(label: string, lines: string[])}
  <span class="rail-name tooltip-surface stack-name" aria-hidden="true" data-testid="limits-card"><span class="ui-label"><PrivateText text={label} /></span>{#each lines as line, index (index)}<span class="ui-label note"><PrivateText text={line} /></span>{/each}</span>
{/snippet}
{#snippet machinesName(label: string, hint: string | null, note: string | null, lines: MachineLine[])}
  <span class="rail-name tooltip-surface machines-name" aria-hidden="true" data-testid="machine-status-card">
    <span class="title"><span class="ui-label">{label}</span>{#if hint}<span class="ui-label note">· {hint}</span>{/if}</span>{#if note}<span class="ui-label note">{note}</span>{/if}
    {#each lines as line (line.id)}<span class="machine-line" data-tone={line.tone}><span class="state-dot" aria-hidden="true"></span><span class="ui-label">{line.name}</span><span class="ui-label note">{line.state}</span></span>{/each}
  </span>
{/snippet}

<nav class="sidebar-foot" aria-label={strings.app.rail.label} data-testid="sidebar-foot">
  <div class="group">
    <div class="slot" class:selected={onActivity}>
      <button type="button" class="ghost icon foot-btn" class:on={onActivity} aria-current={onActivity ? 'page' : undefined}
        aria-label={waiting ? `${strings.mobile.activity}, ${waitingLabel}` : strings.mobile.activity}
        data-testid="nav-activity" onclick={toggleActivity} onmousedown={holdMiddle} onauxclick={clearFinished}>
        <Inbox size={17} strokeWidth={1.75} />
        {#if waiting}<span class="count" data-testid="rail-activity-waiting">{tally(waiting)}</span>{/if}
      </button>
      {@render railName(strings.mobile.activity, null, [waiting ? waitingLabel : null, strings.app.rail.middleClickFinished].filter(Boolean).join(' · '))}
    </div>
    {#if contactsOn}
      <div class="slot" class:selected={onContacts}>
        <button type="button" class="ghost icon foot-btn" class:on={onContacts} aria-current={onContacts ? 'page' : undefined}
          aria-label={strings.contacts.heading} data-testid="rail-contacts" data-preload-view="home" onclick={toggleContacts}>
          <UsersRound size={17} strokeWidth={1.75} />
        </button>
        {@render railName(strings.contacts.heading)}
      </div>
    {/if}
    {#if botsOn}
      <div class="slot" class:selected={onAgents}>
        <button type="button" class="ghost icon foot-btn" class:on={onAgents} aria-current={onAgents ? 'page' : undefined}
          aria-label={botsNote ? `${strings.agents.heading}, ${botsNote}` : strings.agents.heading}
          data-testid="nav-agents" data-preload-view="agents" onclick={toggleAgents}>
          <Bot size={17} strokeWidth={1.75} />
          {#if atWork.count}
            <span class="dot" class:working={!atWork.waiting} data-testid="foot-agents-at-work" data-waiting={atWork.waiting}></span>
          {:else if unreadBots > 0 && !onAgents}
            <span class="dot unread" data-testid="foot-agents-unread"></span>
          {/if}
        </button>
        {@render railName(strings.agents.heading, null, botsNote)}
      </div>
    {/if}
  </div>

  <span class="grow"></span>

  <div class="group">
    <div class="slot status" class:selected={machineFilter.shown(machines) !== null}>
      <MachineStatus {store} filter={machineFilter.shown(machines)} onfilter={pickMachine} card={machinesName} />
    </div>
    <div class="slot extra">
      <Deferred part={parts.UpdatesNotice} quiet>{#snippet children(UpdatesNotice)}<UpdatesNotice name={statusName} />{/snippet}</Deferred>
    </div>
    {#if featureOn('whip') && whipEntry.feature}
      {@const WhipButton = whipEntry.feature.WhipButton}
      <div class="slot extra"><WhipButton name={statusName} /></div>
    {/if}
    <div class="slot extra limits-slot"><LimitsButton {store} name={limitsName} /></div>
    <div class="slot" class:selected={store.page === 'settings'}>
      <button type="button" class="ghost icon foot-btn" class:on={store.page === 'settings'} aria-current={store.page === 'settings' ? 'page' : undefined}
        aria-label={strings.sidebar.settings} aria-describedby={settingsKey ? 'rail-settings-key' : undefined}
        data-testid="nav-settings" data-preload-view="settings" onclick={() => store.showSettings()}>
        <Settings size={17} strokeWidth={1.75} />
      </button>
      {@render railName(strings.sidebar.settings, settingsKey, null, 'rail-settings-key')}
    </div>
  </div>
</nav>

<style>
  .sidebar-foot {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 0 10px;
    padding: 6px 0 8px;
    border-top: 1px solid transparent;
    transition: border-color var(--motion-duration) var(--motion-curve);
    user-select: none;
    -webkit-user-select: none;
    --foot-btn: 32px;
    --foot-ring: var(--color-frame);
  }
  /* Rows still below the fold: a quiet hairline mirrors the scrolled head above. */
  :global(.rail.more) .sidebar-foot { border-top-color: var(--color-border); }

  .group { display: flex; align-items: center; gap: 2px; min-width: 0; }
  .grow { flex: 1; min-width: 4px; }
  .slot { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none; }

  .sidebar-foot :global(button.icon) {
    --button-icon: 17px;
    position: relative;
    width: var(--foot-btn);
    height: var(--foot-btn);
    padding: 0;
    border-radius: var(--radius-md);
    color: var(--color-muted-foreground);
  }
  .sidebar-foot :global(button.icon:hover:not(:disabled)) { background: var(--color-hover); color: var(--color-foreground); --foot-ring: var(--color-hover); }
  .sidebar-foot :global(button.icon.on),
  .sidebar-foot :global(button.icon.on:hover:not(:disabled)) {
    background: var(--color-active);
    color: var(--color-foreground);
    box-shadow: inset 0 0 0 1px var(--color-edge);
    --foot-ring: var(--color-active);
  }

  .sidebar-foot :global(.machines .trigger) { width: var(--foot-btn); height: var(--foot-btn); }
  .sidebar-foot :global(.machines .trigger svg) { width: 17px; height: 17px; }
  .sidebar-foot :global(.limits .trigger svg:not(.ring)) { width: 17px; height: 17px; }
  .sidebar-foot :global(.limits .ring) { width: 19px; height: 19px; }
  .sidebar-foot :global(.machines:not(:has(.trigger))) { display: none; }
  .status:not(:has(:global(.trigger))) { display: none; }
  .extra:not(:has(:global(button))) { display: none; }
  .sidebar-foot :global(.machines.filtered .trigger),
  .sidebar-foot :global(.machines .trigger[aria-expanded='true']) {
    background: var(--color-active);
    color: var(--color-foreground);
    box-shadow: inset 0 0 0 1px var(--color-edge);
  }
  .sidebar-foot :global(.machines .name) { display: none; }

  /* Activity's waiting count pill: cut out of the bar, matching AppRail. */
  .count {
    position: absolute;
    left: calc(50% + 2px);
    top: calc(50% - 1px);
    min-width: 16px;
    height: 15px;
    box-sizing: border-box;
    padding: 0 4px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--segment-on);
    box-shadow: 0 0 0 2px var(--foot-ring);
    color: var(--color-live);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  /* Mochis dot: amber when asking, muted while working, foreground when unread replies wait. */
  .dot {
    position: absolute;
    right: 4px;
    top: 4px;
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    background: var(--color-live);
    box-shadow: 0 0 0 2px var(--foot-ring);
  }
  .dot.working { background: var(--color-accent); }
  .dot.unread { background: var(--color-foreground); }

  /* Tooltip cards open above the button, aligned to its left edge so nothing clips off the window's left edge. */
  .rail-name {
    position: absolute;
    left: 0;
    bottom: calc(100% + 6px);
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 9px;
    --tooltip-radius: var(--radius-sm);
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity var(--dur-1) var(--ease-out-quint), transform var(--dur-1) var(--ease-out-quint);
  }
  .rail-name .note { color: var(--color-muted-foreground); font-weight: 400; }
  .rail-name.stack-name { flex-direction: column; align-items: flex-start; gap: 6px; padding: 7px 10px; }
  .rail-name.machines-name {
    width: max-content;
    display: grid;
    grid-template-columns: 7px auto auto;
    grid-auto-rows: 20px;
    align-items: center;
    gap: 4px 8px;
    padding: 8px 12px;
    line-height: 20px;
  }
  .machines-name > :is(.title, .ui-label) { grid-column: 1 / -1; margin-bottom: 2px; }
  .machines-name > .title { display: flex; align-items: center; gap: 4px; }
  .machine-line { display: contents; font-weight: 400; }
  .machine-line .ui-label { font-weight: 400; }
  .machine-line .note { padding-left: 12px; }
  .state-dot { width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--color-live); }
  .machine-line[data-tone='success'] .state-dot { background: var(--color-success); }
  .machine-line[data-tone='offline'] .state-dot { background: transparent; box-shadow: inset 0 0 0 1.5px var(--color-muted-foreground); }

  .slot:hover .rail-name { opacity: 1; transform: translateY(0); transition-delay: var(--tip-delay) !important; }
  .slot:has(:global(:focus-visible)) .rail-name { opacity: 1; transform: translateY(0); }
  .slot:has(:global([aria-expanded='true'])) .rail-name { opacity: 0; transition-delay: 0ms !important; }

  @container sidebar (max-width: 239px) {
    .sidebar-foot { --foot-btn: 28px; margin: 0 8px; }
    .group { gap: 0; }
  }
  @media (max-width: 720px) {
    .sidebar-foot { display: none; }
  }
</style>
