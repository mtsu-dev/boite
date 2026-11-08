<script lang="ts">
  import { Activity, Bot, Contact, MessageSquare, Settings } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { experimentOn } from '../lib/experiments.svelte';
  import { contactsShown } from '../lib/contacts-rail.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { followAgentDirectories } from '../lib/agent-directory.svelte';
  import { agentsAtWork } from '../lib/work-counts';

  /**
   * The phone's places, along the bottom edge where a thumb rests, the
   * desktop rail's in the same order. A new conversation is the list header's
   * "+". A conversation, a draft and an open keyboard hide the bar; the list's
   * header names the machine. Four places: with the bots on, Contacts lives
   * in the Bots tab, behind the two-way switch at the top of its page
   * (MobileNavigation.svelte), so the tab stands for both.
   */
  let { store, screen, waiting, navigate, inert = false }: {
    store: Store;
    screen: 'chat' | 'threads' | 'activity';
    /** Conversations waiting on the user, on every machine: Activity carries their count. */
    waiting: number;
    navigate: (screen: 'threads' | 'activity') => void;
    /** Out of reach, to the keyboard and assistive tech too: under a conversation sliding in over it. */
    inert?: boolean;
  } = $props();
  const bots = $derived(experimentOn('resident-agents'));
  const current = $derived(store.page === 'settings' ? 'settings' : store.page === 'agents' || (bots && store.page === 'home') ? 'agents' : store.page === 'home' ? 'contacts' : screen === 'activity' ? 'activity' : 'threads');
  const page = (place: string) => current === place ? 'page' as const : undefined;

  /** The bots at work on every machine, as the desktop's switch counts them: the waiting colour once one needs the user. */
  const stores = $derived(workspace.machines.length ? workspace.machines.map(machine => machine.store) : [store]);
  const atWork = $derived(bots ? agentsAtWork(stores) : { count: 0, waiting: false });
  followAgentDirectories(() => stores, () => bots);
</script>

<nav class="mobile-tabs" data-testid="mobile-tabs" aria-label={strings.mobile.navigation} {inert}>
  <button type="button" class="tab" data-testid="mobile-conversations" aria-current={page('threads')} onclick={() => navigate('threads')}>
    <span class="glyph"><MessageSquare size={20} /></span><span class="name ui-label">{strings.sidebar.threads}</span>
  </button>
  <button type="button" class="tab" data-testid="mobile-activity" aria-current={page('activity')} aria-label={waiting ? `${strings.mobile.activity}, ${fill(strings.mobile.waitingElsewhere, { count: String(waiting) })}` : undefined} onclick={() => navigate('activity')}>
    <span class="glyph"><Activity size={20} />{#if waiting}<span class="badge" data-testid="mobile-activity-waiting">{waiting > 99 ? '99+' : waiting}</span>{/if}</span><span class="name ui-label">{strings.mobile.activity}</span>
  </button>
  {#if bots}
    <button type="button" class="tab" data-testid="mobile-agents" data-preload-view="agents" aria-current={page('agents')} aria-label={atWork.count ? `${strings.agents.heading}, ${fill(atWork.waiting ? strings.sidebar.surfaceWaiting : strings.sidebar.surfaceWorking, { count: String(atWork.count) })}` : undefined} onclick={() => store.showAgents()}>
      <span class="glyph"><Bot size={20} />{#if atWork.count}<span class="badge" class:working={!atWork.waiting} data-testid="mobile-agents-at-work" data-waiting={atWork.waiting}>{atWork.count > 99 ? '99+' : atWork.count}</span>{/if}</span><span class="name ui-label">{strings.agents.heading}</span>
    </button>
  {/if}
  {#if contactsShown(store) && !bots}
    <button type="button" class="tab" data-testid="mobile-contacts" data-preload-view="home" aria-current={page('contacts')} onclick={() => store.showHome()}>
      <span class="glyph"><Contact size={20} /></span><span class="name ui-label">{strings.contacts.heading}</span>
    </button>
  {/if}
  <button type="button" class="tab" data-testid="mobile-settings" data-preload-view="settings" aria-current={page('settings')} onclick={() => store.showSettings()}>
    <span class="glyph"><Settings size={20} /></span><span class="name ui-label">{strings.settings.heading}</span>
  </button>
</nav>

<style>
  .mobile-tabs { display: none; }
  @media (max-width: 720px) {
    .mobile-tabs {
      grid-row: 3; grid-column: 1; z-index: 2;
      display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); align-items: start;
      padding: 6px max(4px, env(safe-area-inset-right)) max(6px, env(safe-area-inset-bottom)) max(4px, env(safe-area-inset-left));
      background: var(--color-background); border-top: 1px solid var(--color-border);
    }
    /* The keyboard is up: the bar would ride on top of it. */
    :global(html[data-keyboard='open']) .mobile-tabs { display: none; }
    .tab {
      display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; height: auto; min-height: 52px; padding: 2px 0 0;
      border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-muted-foreground);
      font-size: var(--text-meta); font-weight: 500; letter-spacing: -0.2px; -webkit-tap-highlight-color: transparent;
    }
    .glyph {
      position: relative; display: grid; place-items: center; width: 48px; height: 30px; border-radius: var(--radius-full);
      transition: background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint);
    }
    .name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab[aria-current=page] { color: var(--color-foreground); }
    .tab[aria-current=page] .glyph { background: var(--color-surface-3); }
    .tab:active .glyph { background: var(--color-surface-2); }
    .badge {
      position: absolute; top: -2px; left: calc(50% + 6px); min-width: 17px; height: 17px; padding: 0 4px; box-sizing: border-box;
      border-radius: var(--radius-full); background: var(--color-live); color: var(--color-accent-ink);
      box-shadow: 0 0 0 2px var(--color-background); font-size: 10px; font-weight: 700; line-height: 17px; text-align: center;
    }
    /* Bots at work and none asking: a neutral count, the accent stays on actions. */
    .badge.working { background: var(--color-surface-3); color: var(--color-foreground); }
  }
</style>
