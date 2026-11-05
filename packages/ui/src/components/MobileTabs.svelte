<script lang="ts">
  import { Bot, Inbox, MessageSquare, Plus, Settings } from '@lucide/svelte';
  import type { Store } from '../lib/store.svelte';
  import { fill, strings } from '../lib/strings';
  import { experimentOn } from '../lib/experiments.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import { followAgentDirectories } from '../lib/agent-directory.svelte';
  import { workTally } from '../lib/work-counts';

  /**
   * The phone's places, along the bottom edge where a thumb rests: Threads,
   * Inbox, New thread in the centre slot (a round accent `+`, part of the bar,
   * so nothing floats over the rows), Bots when that experiment is on,
   * Settings. A conversation, a draft and an open keyboard hide the bar; the
   * list's header names the machine. Contacts live in the Bots page's header,
   * or in Settings without bots (MobileNavigation, MobileSettings).
   */
  let { store, screen, waiting, navigate, onnew, newDisabled = false, inert = false }: {
    store: Store;
    screen: 'chat' | 'threads' | 'activity';
    /** Project threads waiting on the user, on every machine, by the one count rule (`workTally`): Inbox carries their count. */
    waiting: number;
    navigate: (screen: 'threads' | 'activity') => void;
    onnew: () => void;
    newDisabled?: boolean;
    /** Out of reach, to the keyboard and assistive tech too: under a conversation sliding in over it. */
    inert?: boolean;
  } = $props();

  /** Bots, when that experiment is on. A tab's badge is only ever what needs the user: work in progress is the lists' to show. */
  const bots = $derived(experimentOn('resident-agents'));
  // Contacts sit under Bots, or under Settings without them: the tab that holds them stays lit on their page.
  const current = $derived(store.page === 'settings' ? 'settings' : store.page === 'agents' ? 'agents' : store.page === 'home' ? (bots ? 'agents' : 'settings') : screen === 'activity' ? 'activity' : 'threads');
  const page = (place: string) => current === place ? 'page' as const : undefined;
  const stores = $derived(workspace.machines.length ? workspace.machines.map(machine => machine.store) : [store]);
  const botNeeds = $derived(bots ? workTally(stores).bots.needs : 0);
  followAgentDirectories(() => stores, () => bots);
</script>

{#snippet create()}
  <span class="slot">
    <button type="button" class="new" data-testid="mobile-new" aria-label={strings.sidebar.newThread} title={strings.sidebar.newThread} disabled={newDisabled} onclick={onnew}>
      <Plus size={24} strokeWidth={2.25} aria-hidden="true" />
    </button>
  </span>
{/snippet}

<nav class="mobile-tabs" data-testid="mobile-tabs" aria-label={strings.mobile.navigation} {inert}>
  <button type="button" class="tab" data-testid="mobile-conversations" aria-current={page('threads')} onclick={() => navigate('threads')}>
    <span class="glyph"><MessageSquare size={20} /></span><span class="name ui-label">{strings.mobile.threads}</span>
  </button>
  <button type="button" class="tab" data-testid="mobile-activity" aria-current={page('activity')} aria-label={waiting ? `${strings.mobile.activity}, ${fill(strings.mobile.waitingElsewhere, { count: String(waiting) })}` : undefined} onclick={() => navigate('activity')}>
    <span class="glyph"><Inbox size={20} />{#if waiting}<span class="badge" data-testid="mobile-activity-waiting">{waiting > 99 ? '99+' : waiting}</span>{/if}</span><span class="name ui-label">{strings.mobile.activity}</span>
  </button>
  {@render create()}
  {#if bots}
    <button type="button" class="tab" data-testid="mobile-agents" data-preload-view="agents" aria-current={page('agents')} aria-label={botNeeds ? `${strings.agents.heading}, ${fill(strings.sidebar.surfaceNeeds, { count: String(botNeeds) })}` : undefined} onclick={() => store.showAgents()}>
      <span class="glyph"><Bot size={20} />{#if botNeeds}<span class="badge" data-testid="mobile-agents-at-work" data-waiting="true">{botNeeds > 99 ? '99+' : botNeeds}</span>{/if}</span><span class="name ui-label">{strings.agents.heading}</span>
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
      position: relative; grid-row: 3; grid-column: 1; z-index: 2; align-self: end;
      /* A capsule of frosted glass floating over the list's last rows. The tabs share what the centre
         disc leaves; with 10 px labels at weight 500, as iOS draws its own, "Conversations" fits its
         68 px at 360 px. The current tab keeps that weight: 600 widened it past the slot. */
      display: flex; align-items: center;
      margin: 0 max(10px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));
      padding: 5px 4px;
      border-radius: var(--radius-full);
      background: var(--color-float);
      -webkit-backdrop-filter: var(--float-blur);
      backdrop-filter: var(--float-blur);
      box-shadow: var(--shadow-float);
    }
    /* The keyboard is up: the bar would ride on top of it. */
    :global(html[data-keyboard='open']) .mobile-tabs { display: none; }
    .tab {
      display: flex; flex: 1 1 0; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 0; height: auto; min-height: 52px; padding: 2px 1px;
      border: 0; border-radius: var(--radius-full); background: transparent; color: var(--color-muted-foreground);
      font-size: 10px; font-weight: 500; letter-spacing: -0.1px; -webkit-tap-highlight-color: transparent;
    }
    .glyph {
      position: relative; display: grid; place-items: center; width: 52px; height: 28px; border-radius: var(--radius-full);
      transition: background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint);
    }
    .name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab[aria-current=page] { color: var(--color-accent); }
    .tab[aria-current=page] .glyph { background: var(--color-accent-soft); }
    .tab[aria-current=page] .name { color: var(--color-foreground); }
    .tab:active .glyph { background: var(--color-active); }
    /* New thread in the centre slot: a 48 px accent disc inside the bar, never over the rows. */
    .slot { display: grid; flex: 0 0 52px; place-items: center; min-height: 52px; }
    .new {
      display: grid; place-items: center; width: 48px; height: 48px; min-height: 48px; padding: 0;
      border: 0; border-radius: var(--radius-full); background: var(--primary-glaze) var(--color-accent); color: var(--color-accent-ink);
      box-shadow: 0 6px 16px -4px color-mix(in oklch, var(--color-accent) 55%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.25);
      -webkit-tap-highlight-color: transparent;
      transition: filter var(--dur-1) var(--ease-out-quint), scale var(--dur-1) var(--ease-out-quint);
    }
    .new:active { filter: brightness(0.92); scale: 0.96; }
    .new:disabled { opacity: 0.5; }
    .badge {
      position: absolute; top: -2px; left: calc(50% + 6px); min-width: 17px; height: 17px; padding: 0 4px; box-sizing: border-box;
      border-radius: var(--radius-full); background: var(--color-live); color: var(--color-accent-ink);
      font-size: 10px; font-weight: 700; line-height: 17px; text-align: center; font-variant-numeric: tabular-nums;
    }
    /* Bots at work and none asking: the accent, as the desktop's switch draws it. */
  }
</style>
