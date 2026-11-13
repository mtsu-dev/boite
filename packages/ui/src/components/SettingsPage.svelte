<script lang="ts">
  import { Network } from '@lucide/svelte';
  import AccountsPage from './AccountsPage.svelte';
  import AgentRepliesSettings from './AgentRepliesSettings.svelte';
  import AppearancePage from './AppearancePage.svelte';
  import ArchivedThreads from './ArchivedThreads.svelte';
  import BrainPage from './BrainPage.svelte';
  import BrowserProfilesCard from './BrowserProfilesCard.svelte';
  import CompactionSettings from './CompactionSettings.svelte';
  import ConversationCard from './ConversationCard.svelte';
  import CoreCard from './CoreCard.svelte';
  import DeviceCard from './DeviceCard.svelte';
  import DiagnosticsPage from './DiagnosticsPage.svelte';
  import ExperimentsPage from './ExperimentsPage.svelte';
  import HarnessUpdatesCard from './HarnessUpdatesCard.svelte';
  import KeyboardPage from './KeyboardPage.svelte';
  import LimitsPage from './LimitsPage.svelte';
  import LocalAcpCard from './LocalAcpCard.svelte';
  import MachinesPage from './MachinesPage.svelte';
  import MainMachine from './MainMachine.svelte';
  import NotificationsCard from './NotificationsCard.svelte';
  import OriginsCard from './OriginsCard.svelte';
  import PhoneSettings from './PhoneSettings.svelte';
  import PluginsPage from './PluginsPage.svelte';
  import PolicySettings from './PolicySettings.svelte';
  import QuietCard from './QuietCard.svelte';
  import ResourcesPage from './ResourcesPage.svelte';
  import SchedulerSettings from './SchedulerSettings.svelte';
  import SecretsCard from './SecretsCard.svelte';
  import SubscriptionProxySettings from './SubscriptionProxySettings.svelte';
  import TaskManagerLoader from './TaskManagerLoader.svelte';
  import TelemetrySettings from './TelemetrySettings.svelte';
  import TerminalCard from './TerminalCard.svelte';
  import TourCard from './TourCard.svelte';
  import UpdatesCard from './UpdatesCard.svelte';
  import UsagePage from './UsagePage.svelte';
  import VoiceSettings from './VoiceSettings.svelte';
  import WindowAllowlistCard from './WindowAllowlistCard.svelte';
  import WindowExclusionsCard from './WindowExclusionsCard.svelte';
  import WorkspaceCard from './WorkspaceCard.svelte';
  import WorktreesCard from './WorktreesCard.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { blocksOf, navSectionsOf, type SettingsBlock, type SettingsCard, type SettingsCardId, type SettingsPage, type SettingsScope } from '../lib/settings-tabs';
  import { cardWords } from '../lib/settings-index';

  /**
   * One page of the map (`lib/settings-tabs.ts`), the same on a desktop and on
   * a phone: a column of blocks in the map's order, an older page whole or a
   * single card, each on the machine or the device it belongs to. `phone`
   * draws the cards a phone has, in the form a phone gives them. `line` is
   * the scope the screen states under the page's title, so a block that
   * differs tags itself.
   */
  let { store, target = store, page, phone = false, line, onopenthread }: {
    store: Store;
    target?: Store;
    page: SettingsPage;
    phone?: boolean;
    line: SettingsScope | null;
    onopenthread?: () => void;
  } = $props();

  let words = $derived(cardWords());
  let blocks = $derived(blocksOf(page, store.owner, phone));
  let long = $derived(navSectionsOf(page, store.owner, phone).length > 0);

  /**
   * The blocks that are an older page whole: each brings its own `.page`. The
   * others are one card, which the screen wraps in a page of its own.
   */
  const WHOLE: ReadonlySet<SettingsBlock> = new Set(['appearance', 'keyboard', 'voice', 'providers', 'quotas', 'usage', 'brain', 'plugins', 'limits', 'machines', 'experiments', 'diagnostics', 'tasks', 'task-manager']);
  /** The whole pages with no card title of their own to say what they are: the screen heads them, and their route lands on that head. */
  const HEADED: ReadonlySet<SettingsBlock> = new Set(['keyboard', 'voice', 'providers', 'quotas', 'usage', 'brain', 'plugins', 'experiments', 'task-manager']);
  const has = (cards: readonly SettingsCard[], id: SettingsCardId): boolean => cards.some((card) => card.id === id);
</script>

<div class="map" class:long class:phone data-testid="settings-page" data-page={page}>
  {#each blocks as entry (entry.block)}
    {#if WHOLE.has(entry.block)}
      <div class="block" data-block={entry.block}>
        {#if HEADED.has(entry.block) && blocks.length > 1}
          <div class="page"><div class="group-heading" id="settings-{entry.block}">
            <h2>{words[entry.cards[0]!.id as SettingsCardId].title}</h2>
            {#if entry.cards[0]!.scope === 'group' && line !== 'group'}<span class="card-scope" data-testid="card-scope" data-kind="group"><Network size={13} strokeWidth={1.75} aria-hidden="true" /><span class="ui-label">{strings.settingsMap.scope.group}</span></span>{/if}
          </div></div>
        {/if}
        {@render block(entry.block, entry.cards)}
      </div>
    {:else}
      <div class="page" data-block={entry.block}>{@render block(entry.block, entry.cards)}</div>
    {/if}
  {/each}
</div>

<!-- One block of the map: the component that draws its cards. -->
{#snippet block(id: SettingsBlock, cards: readonly SettingsCard[])}
  {#if id === 'appearance'}<AppearancePage {store} {phone} />
  {:else if id === 'workspace'}<WorkspaceCard />
  {:else if id === 'details'}<TerminalCard />
  {:else if id === 'keyboard'}<KeyboardPage store={target} />
  {:else if id === 'voice'}<VoiceSettings store={target} readOnly={phone} />
  {:else if id === 'thread-list'}<ConversationCard part="list" />
  {:else if id === 'conversations'}<ConversationCard part="conversation" {phone} />
  {:else if id === 'notifications'}<NotificationsCard {store} />
  {:else if id === 'agent-replies'}<AgentRepliesSettings store={target} />
  {:else if id === 'archived'}<ArchivedThreads store={target} />
  {:else if id === 'worktrees'}<WorktreesCard store={target} />
  {:else if id === 'providers'}<AccountsPage store={target} extras={false} />
  {:else if id === 'local-acp'}<LocalAcpCard store={target} />
  {:else if id === 'secrets'}<SecretsCard />
  {:else if id === 'quotas'}<LimitsPage store={target} proxyCard={false} />
  {:else if id === 'subscription-proxy'}<SubscriptionProxySettings store={target} />
  {:else if id === 'usage'}<UsagePage {store} />
  {:else if id === 'brain'}<BrainPage store={target} />
  {:else if id === 'plugins'}<PluginsPage store={target} />
  {:else if id === 'auto-compact'}<CompactionSettings store={target} />
  {:else if id === 'execution'}<SchedulerSettings store={target} />
  {:else if id === 'quiet'}<QuietCard store={target} />
  {:else if id === 'windows'}<WindowAllowlistCard store={target} />
  {:else if id === 'window-exclusions'}<WindowExclusionsCard store={target} />
  {:else if id === 'limits'}<ResourcesPage store={target} part="limits" />
  {:else if id === 'browser-profiles'}<BrowserProfilesCard />
  {:else if id === 'privacy'}<TelemetrySettings store={target} />
  {:else if id === 'policy'}<PolicySettings store={target} />
  {:else if id === 'app'}{#if has(cards, 'app')}<DeviceCard />{/if}{#if has(cards, 'main-machine')}<MainMachine />{/if}
  {:else if id === 'machines'}<MachinesPage mobile={phone} {onopenthread} {store} extras={false} />
  <!-- A phone shows its own share of the card: what reaches it, and the app on its home screen. -->
  {:else if id === 'phone'}{#if phone}<PhoneSettings {store} showServerSettings={false} />{:else}<PhoneSettings store={target} />{/if}
  {:else if id === 'origins'}<OriginsCard store={target} />
  {:else if id === 'updates'}<UpdatesCard />
  {:else if id === 'agent-updates'}<HarnessUpdatesCard store={target} />
  {:else if id === 'experiments'}<ExperimentsPage {store} {target} />
  {:else if id === 'diagnostics'}<DiagnosticsPage store={target} {onopenthread} />
  {:else if id === 'tasks'}<ResourcesPage store={target} part="tasks" />
  {:else if id === 'task-manager'}<TaskManagerLoader {store} {onopenthread} />
  {:else if id === 'core'}<CoreCard store={target} />
  {:else if id === 'tour'}<TourCard {store} />
  {/if}
{/snippet}

<style>
  /* A page of the map is a column of blocks: an old page whole, or a card. Each keeps the settings
     column and gives up its own scroll and its own top and bottom room, so the blocks read as one page. */
  .map { padding: var(--space-4) 0 var(--space-8); }
  .map > .block > :global(.page), .map > :global(.page) { height: auto; overflow: visible; padding-block: 0; padding-inline: max(var(--settings-gutter), calc((100% - var(--settings-width)) / 2)); }
  /* The last block fills the panel, so its route can scroll it to the top. */
  .map.long > .block:last-child { min-height: 100%; }

  /* The screen carries the page's title and a block its section's: the old page's own heading steps aside,
     and its header with it unless it holds an action. A lock or another mark in the title stays. */
  .map > .block > :global(.page > header h1 > .ui-label),
  .map > .block > :global(.page > header h1 > .ui-label + .info-tip),
  .map > .block > :global(.page > header h1:not(:has(> :not(.ui-label, .ui-label + .info-tip)))),
  .map > .block > :global(.limits-page > header h1),
  .map > .block > :global(.machines-page .head h1) { display: none; }
  .map > .block > :global(.page > header:not(:has(button:not(.ui-label + .info-tip), [role='status'], .policy-lock))),
  .map > .block > :global(.machines-page .head:not(:has(button:not(.ui-label + .info-tip)))) { display: none; }
  .map > .block > :global(.page > header) { justify-content: flex-end; }

  /* The first card's title follows the screen's title at the normal step, with no empty band between. */
  .map > :first-child:is(.block) > :global(.page:first-child > .card:first-child:has(> h2:first-child)),
  .map > :first-child:is(.block) > :global(.page:first-child > header:first-child + .card:has(> h2:first-child)),
  .map > :global(.page:first-child > .card:first-child:has(> h2:first-child)),
  .map > :global(.page:first-child > .card:first-child:has(> .card-head:first-child)) { margin-top: var(--card-head); }
  .map > :first-child:is(.block) > :global(.page:first-child > .group-heading:first-child) { margin-top: 0; }

  /* A phone's header sits close over the page: half the room above the first card. */
  .map.phone { padding-top: var(--space-2); }
</style>
