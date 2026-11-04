<script lang="ts">
  import { Bot, Inbox, MessageSquare, Plus, Settings } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { experimentOn } from '../lib/experiments.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { followAgentDirectories } from '../lib/agent-directory.svelte';
  import { agentsAtWork } from '../lib/work-counts';
  import { mobileChrome } from '../lib/mobile-chrome.svelte';

  /**
   * The phone's places, along the bottom edge where a thumb rests: Threads,
   * Inbox, Bots when that experiment is on, Settings. New thread floats over
   * the two lists, at the bottom right, as phone apps place their main action.
   * A conversation, a draft and an open keyboard hide the bar; the list's
   * header names the machine. Contacts live in the Bots page's header, or in
   * Settings without bots (MobileNavigation, MobileSettings).
   */
  let { store, screen, waiting, navigate, onnew, newDisabled = false, inert = false }: {
    store: Store;
    screen: 'chat' | 'threads' | 'activity';
    /** Conversations waiting on the user, on every machine: Inbox carries their count. */
    waiting: number;
    navigate: (screen: 'threads' | 'activity') => void;
    onnew: () => void;
    newDisabled?: boolean;
    /** Out of reach, to the keyboard and assistive tech too: under a conversation sliding in over it. */
    inert?: boolean;
  } = $props();

  /** The bots at work on every machine, as the desktop's switch counts them: the waiting colour once one needs the user. */
  const bots = $derived(experimentOn('resident-agents'));
  // Contacts sit under Bots, or under Settings without them: the tab that holds them stays lit on their page.
  const current = $derived(store.page === 'settings' ? 'settings' : store.page === 'agents' ? 'agents' : store.page === 'home' ? (bots ? 'agents' : 'settings') : screen === 'activity' ? 'activity' : 'threads');
  const page = (place: string) => current === place ? 'page' as const : undefined;
  const stores = $derived(workspace.machines.length ? workspace.machines.map(machine => machine.store) : [store]);
  const atWork = $derived(bots ? agentsAtWork(stores) : { count: 0, waiting: false });
  followAgentDirectories(() => stores, () => bots);
  /** The floating New thread belongs to the two lists, not to a page. */
  const listed = $derived(store.page === 'chat' && (current === 'threads' || current === 'activity'));
</script>

<nav class="mobile-tabs" data-testid="mobile-tabs" aria-label={strings.mobile.navigation} {inert}>
  <button type="button" class="tab" data-testid="mobile-conversations" aria-current={page('threads')} onclick={() => navigate('threads')}>
    <span class="glyph"><MessageSquare size={20} /></span><span class="name ui-label">{strings.mobile.threads}</span>
  </button>
  <button type="button" class="tab" data-testid="mobile-activity" aria-current={page('activity')} aria-label={waiting ? `${strings.mobile.activity}, ${fill(strings.mobile.waitingElsewhere, { count: String(waiting) })}` : undefined} onclick={() => navigate('activity')}>
    <span class="glyph"><Inbox size={20} />{#if waiting}<span class="badge" data-testid="mobile-activity-waiting">{waiting > 99 ? '99+' : waiting}</span>{/if}</span><span class="name ui-label">{strings.mobile.activity}</span>
  </button>
  {#if bots}
    <button type="button" class="tab" data-testid="mobile-agents" data-preload-view="agents" aria-current={page('agents')} aria-label={atWork.count ? `${strings.agents.heading}, ${fill(atWork.waiting ? strings.sidebar.surfaceWaiting : strings.sidebar.surfaceWorking, { count: String(atWork.count) })}` : undefined} onclick={() => store.showAgents()}>
      <span class="glyph"><Bot size={20} />{#if atWork.count}<span class="badge" class:working={!atWork.waiting} data-testid="mobile-agents-at-work" data-waiting={atWork.waiting}>{atWork.count > 99 ? '99+' : atWork.count}</span>{/if}</span><span class="name ui-label">{strings.agents.heading}</span>
    </button>
  {/if}
  <button type="button" class="tab" data-testid="mobile-settings" data-preload-view="settings" aria-current={page('settings')} onclick={() => store.showSettings()}>
    <span class="glyph"><Settings size={20} /></span><span class="name ui-label">{strings.settings.heading}</span>
  </button>
  {#if listed}
    <button type="button" class="fab" class:tucked={mobileChrome.fabTucked} data-testid="mobile-new" aria-label={strings.sidebar.newThread} title={strings.sidebar.newThread} disabled={newDisabled} onclick={onnew}>
      <Plus size={24} strokeWidth={2.25} />
    </button>
  {/if}
</nav>

<style>
  .mobile-tabs { display: none; }
  @media (max-width: 720px) {
    .mobile-tabs {
      position: relative; grid-row: 3; grid-column: 1; z-index: 2;
      display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); align-items: start;
      padding: 6px max(4px, env(safe-area-inset-right)) max(6px, env(safe-area-inset-bottom)) max(4px, env(safe-area-inset-left));
      background: var(--color-background); border-top: 1px solid var(--color-border);
    }
    /* The keyboard is up: the bar would ride on top of it. */
    :global(html[data-keyboard='open']) .mobile-tabs { display: none; }
    .tab {
      display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; height: auto; min-height: 52px; padding: 2px 2px 0;
      border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-muted-foreground);
      font-size: 11px; font-weight: 500; letter-spacing: -0.1px; -webkit-tap-highlight-color: transparent;
    }
    .glyph {
      position: relative; display: grid; place-items: center; width: 56px; height: 30px; border-radius: var(--radius-full);
      transition: background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint);
    }
    .name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab[aria-current=page] { color: var(--color-accent); }
    .tab[aria-current=page] .glyph { background: var(--color-accent-soft); }
    .tab[aria-current=page] .name { color: var(--color-foreground); font-weight: 600; }
    .tab:active .glyph { background: var(--color-surface-3); }
    /* New thread over the lists, clear of the bar and of the home indicator the bar already keeps. */
    .fab {
      position: absolute; right: max(16px, env(safe-area-inset-right)); bottom: calc(100% + 16px);
      display: grid; place-items: center; width: 56px; height: 56px; min-height: 56px; padding: 0;
      border: 0; border-radius: var(--radius-full); background: var(--color-accent); color: var(--color-accent-ink);
      box-shadow: var(--shadow-e2), 0 6px 18px -4px color-mix(in oklch, var(--color-accent) 55%, transparent);
      -webkit-tap-highlight-color: transparent;
      transition: filter var(--dur-1) var(--ease-out-quint), scale var(--dur-1) var(--ease-out-quint), translate var(--dur-3) var(--ease-out-quint), opacity var(--dur-2) var(--ease-out-quint);
    }
    .fab.tucked:not(:focus-visible) { translate: 0 calc(100% + 32px); opacity: 0; pointer-events: none; }
    .fab:active { filter: brightness(0.92); scale: 0.96; }
    .fab:disabled { opacity: 0.5; }
    .badge {
      position: absolute; top: -2px; left: calc(50% + 6px); min-width: 17px; height: 17px; padding: 0 4px; box-sizing: border-box;
      border-radius: var(--radius-full); background: var(--color-live); color: var(--color-accent-ink);
      box-shadow: 0 0 0 2px var(--color-background); font-size: 10px; font-weight: 700; line-height: 17px; text-align: center; font-variant-numeric: tabular-nums;
    }
    /* Bots at work and none asking: the accent, as the desktop's switch draws it. */
    .badge.working { background: var(--color-accent); }
  }
</style>
