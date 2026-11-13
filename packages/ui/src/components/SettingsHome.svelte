<script lang="ts" module>
  import type { SettingsTab } from '../lib/store.svelte';

  /** A family of Home: its head and one tile per page, as `lib/settings-tabs.ts` lists them. */
  export type SettingsHomeFamily = { id: string; label: string; pages: { id: SettingsTab; label: string }[] };
</script>

<script lang="ts">
  import { connected } from '../lib/provider-setup';
  import { providerRows } from '../lib/provider-family';
  import { SETTINGS_ICONS } from '../lib/settings-icons';
  import { fill, strings } from '../lib/strings';
  import { readTheme } from '../lib/theme';
  import { activeLocale } from '../lib/i18n.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import type { Store } from '../lib/store.svelte';

  /**
   * Where Settings opens on a desktop: one tile per page under its family's
   * head, the nav's search beside it. A tile says something only when there is
   * a state worth reading from here: how many providers answer, how many
   * machines are paired, the theme and the language, whether dictation is ready.
   * `target` is the machine the settings bar picked, the one Voice would show.
   */
  let { store, target = store, families, onopen }: {
    store: Store;
    target?: Store;
    families: SettingsHomeFamily[];
    onopen: (tab: SettingsTab) => void;
  } = $props();

  let rows = $derived(providerRows(store.providers));
  let ready = $derived(rows.filter((row) => row.members.some((provider) => connected(provider, store.shownAccounts()))).length);
  let machines = $derived(Math.max(1, workspace.machines.length));

  /** The last answer and the machine it came from: shown only while that machine is the one picked and in reach. */
  let voice = $state.raw<{ of: Store; ready: boolean } | null>(null);
  let voiceReady = $derived(voice && voice.of === target && target.connection === 'ready' ? voice.ready : null);
  $effect(() => {
    const client = target.client, of = target;
    if (!client || target.connection !== 'ready') return;
    let live = true;
    client.call('speech.status', {}).then((status) => { if (live) voice = { of, ready: status.ready }; }, () => { if (live) voice = null; });
    return () => { live = false; };
  });

  $effect(() => {
    if (store.connection === 'ready' && store.owner) void store.loadSessions();
  });

  /** The state line under a tile, null when the page has none worth a glance. */
  function status(tab: SettingsTab): { text: string; tone?: 'call' } | null {
    if (tab === 'accounts' && store.providers.length > 0) {
      return ready === 0 ? { text: strings.settings.connectProvider, tone: 'call' } : { text: ready === 1 ? strings.settings.providersOne : fill(strings.settings.providersReady, { count: String(ready) }) };
    }
    if (tab === 'machines') {
      const parts = machines > 1 ? [fill(strings.settings.machinesCount, { count: String(machines) })] : [];
      if (store.sessions.length > 0) parts.push(store.sessions.length === 1 ? strings.settings.devicesOne : fill(strings.settings.devicesCount, { count: String(store.sessions.length) }));
      return parts.length > 0 ? { text: parts.join(' · ') } : null;
    }
    if (tab === 'appearance') {
      // Read through `strings` each time, so the theme word follows a language just picked.
      const words = { system: strings.settings.themeSystem, dark: strings.settings.themeDark, light: strings.settings.themeLight, grain: strings.settings.themeGrain };
      return { text: `${words[readTheme()]} · ${strings.settings.languageNames[activeLocale()]}` };
    }
    if (tab === 'voice' && voiceReady !== null) return { text: voiceReady ? strings.settings.homeOn : strings.settings.homeOff };
    return null;
  }

  /** Each tile's place in the whole grid, so they rise one after the other across the families. */
  let order = $derived(new Map(families.flatMap((family) => family.pages).map((page, index) => [page.id, index])));
</script>

<div class="page home" data-testid="settings-home-page">
  {#each families as family (family.id)}
    <section class="family" aria-labelledby="settings-home-family-{family.id}" data-testid="settings-home-family" data-family={family.id}>
      <h2 class="ui-label" id="settings-home-family-{family.id}">{family.label}</h2>
      <div class="tiles">
        {#each family.pages as page (page.id)}
          {@const Icon = SETTINGS_ICONS[page.id]}
          {@const line = status(page.id)}
          <button type="button" class="tile" style:--i={order.get(page.id) ?? 0} data-testid="settings-home-{page.id}" onclick={() => onopen(page.id)}>
            <span class="glyph"><Icon size={18} strokeWidth={1.75} aria-hidden="true" /></span>
            <span class="text">
              <span class="label ui-label">{page.label}</span>
              {#if line}<span class="status ui-label" class:call={line.tone === 'call'} data-testid="settings-home-{page.id}-status">{line.text}</span>{/if}
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  /* Four tiles a row while the longest French label still fits on one line,
     else two, else one. Every tile is as tall as the others, status line or not. */
  .home { container-type: inline-size; }

  .family { max-width: var(--settings-width); }
  .family + .family { margin-top: var(--space-6); }
  .family:first-child { margin-top: var(--space-2); }

  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-meta);
    font-weight: 500;
    color: var(--color-subtle);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
  }

  /* The glyph sits above the words, so a long French label keeps the tile's
     whole width instead of the room left beside an icon. */
  .tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: var(--space-4);
    height: auto;
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    box-shadow: none;
    text-align: left;
    white-space: normal;
    font-weight: normal;
    color: var(--color-foreground);
    transition: background var(--dur-2), border-color var(--dur-2), transform var(--dur-2) var(--ease-out-quint);
    /* One after the other, a fifth of the short step apart: with motion reduced the steps are gone with it. */
    animation: rise var(--dur-3) var(--ease-out-quint) backwards;
    animation-delay: calc(var(--i) * var(--dur-1) / 5);
  }
  @media (hover: hover) {
    .tile:hover:not(:disabled) { background: var(--color-surface-3); border-color: var(--color-edge); transform: translateY(calc(-2px * var(--motion))); }
    .tile:hover .glyph { color: var(--color-foreground); background: var(--color-active); }
  }
  .tile:active:not(:disabled) { transform: none; background: var(--color-active); }

  .glyph {
    display: grid;
    place-items: center;
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-md);
    background: var(--color-surface-3);
    color: var(--color-muted-foreground);
    transition: color var(--dur-2), background var(--dur-2);
  }

  /* Room for a label and one status line on every tile, so a tile with nothing
     to report stands as tall as one that has. The labels are trimmed to their
     letters (`.ui-label`), so the gap between the two is the whole air there. */
  .text { display: grid; align-content: start; gap: 10px; width: 100%; min-width: 0; min-height: calc(var(--text-head) * 0.75 + 10px + var(--text-meta) * 0.75); }
  .label { font-size: var(--text-head); font-weight: 500; line-height: 1.3; overflow-wrap: break-word; }
  .status { font-size: var(--text-meta); line-height: 1.35; color: var(--color-muted-foreground); overflow-wrap: break-word; }
  .status.call { color: var(--color-accent); }

  /* Two a row, the glyph goes back beside the words: a half-width tile is wide
     enough for both and a tall one would be mostly empty. */
  @container (max-width: 760px) {
    .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tile { flex-direction: row; align-items: center; }
    .text { align-content: center; }
  }
  @container (max-width: 400px) {
    .tiles { grid-template-columns: minmax(0, 1fr); }
  }
</style>
