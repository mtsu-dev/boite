<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { Puzzle, X } from '@lucide/svelte';
  import type { PluginSettingValue, PluginState } from '@boite/contracts';
  import { pluginSettingValues } from '@boite/contracts';
  import { Closing } from '../lib/closing.svelte';
  import { mobileOverlay } from '../lib/mobile-history';
  import { hasFiles, pluginAuthor } from '../lib/plugin-card';
  import { fill, strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';
  import PluginSettingField from './PluginSettingField.svelte';

  /**
   * The gear of a plugin card: the settings its manifest declares, what its
   * token may call, and the details the card leaves out (its program, its
   * accounts, where it comes from), with Uninstall at the bottom.
   */
  let { plugin, working, onclose, onsave, onuninstall, details }: {
    /** Null closes the dialog. */
    plugin: PluginState | null;
    working: boolean;
    onclose: () => void;
    /** Resolves to the core's refusal, or null once it kept the value. */
    onsave: (plugin: PluginState, key: string, value: PluginSettingValue) => Promise<string | null>;
    onuninstall: (plugin: PluginState) => void;
    details: Snippet<[PluginState]>;
  } = $props();

  const t = strings.plugins;
  const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), a[href]';
  const overlay = new Closing();
  let card = $state<HTMLDivElement | undefined>(undefined);
  /** The plugin last shown, kept while the dialog plays its exit. */
  let shown = $state<PluginState | null>(null);

  $effect(() => {
    const next = plugin;
    if (!next) { overlay.hide(); return; }
    shown = next;
    untrack(() => {
      if (overlay.open) return;
      overlay.show();
      void Promise.resolve().then(() => card?.focus({ preventScroll: true }));
    });
  });
  $effect(() => { if (overlay.open) return mobileOverlay(onclose); });

  function onkeydown(event: KeyboardEvent) {
    if (!overlay.open) return;
    // A menu of choices open inside the dialog takes its own Escape first.
    if (event.key === 'Escape' && card?.querySelector('[role="menu"]')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onclose(); return; }
    if (event.key !== 'Tab' || !card) return;
    const stops = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = stops[0], last = stops[stops.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    const inside = active instanceof Node && card.contains(active);
    if (event.shiftKey ? inside && active !== first : inside && active !== last) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  }

  const settings = $derived(shown?.settings ?? []);
  const values = $derived(shown ? pluginSettingValues(settings, shown.settingValues ?? {}) : {});
  const author = $derived(shown ? pluginAuthor(shown) : null);
  /** A schema 1 plugin's program gets the owner token; a schema 2 one, what it declared. */
  const reach = $derived.by((): 'listed' | 'owner' | null => {
    if (!shown) return null;
    if (shown.permissions !== undefined) return 'listed';
    return shown.commands.length > 0 || shown.app || shown.gateway ? 'owner' : null;
  });
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if overlay.shown && shown}
  {@const current = shown}
  <div class="scrim" class:closing={overlay.closing} role="presentation" use:overlay.attach onanimationend={overlay.end}
    onclick={(event) => { if (event.target === event.currentTarget) onclose(); }}>
    <div class="dialog" class:closing={overlay.closing} role="dialog" aria-modal="true" aria-labelledby="plugin-dialog-title" tabindex="-1"
      bind:this={card} data-testid="plugin-dialog" data-plugin={current.id}>
      <div class="head">
        <span class="glyph" aria-hidden="true"><Puzzle size={18} strokeWidth={1.75} /></span>
        <div class="who">
          <h2 id="plugin-dialog-title">{current.name}{#if current.version ?? current.availableVersion}<span class="version">v{current.version ?? current.availableVersion}</span>{/if}</h2>
          {#if author}<p class="author">{fill(t.byAuthor, { author })}</p>{/if}
        </div>
        <button type="button" class="ghost icon" aria-label={strings.common.close} title={strings.common.close} data-testid="plugin-dialog-close" onclick={onclose}><X size={16} /></button>
      </div>

      <div class="body">
        {#if current.description}<p class="description">{current.description}</p>{/if}

        {#if settings.length > 0}
          <section class="group" aria-labelledby="plugin-dialog-settings" data-testid="plugin-settings">
            <h3 id="plugin-dialog-settings" class="section-label"><span class="ui-label">{t.settingsHeading}</span><InfoTip topic={t.settingsHeading} text={t.settingsHint} /></h3>
            <div class="rows">
              {#each settings as setting (setting.key)}
                <PluginSettingField {setting} value={values[setting.key] ?? setting.default} disabled={working || !hasFiles(current)}
                  onsave={(value) => onsave(current, setting.key, value)} />
              {/each}
            </div>
          </section>
        {/if}

        {#if reach}
          <section class="group" aria-labelledby="plugin-dialog-authorizations">
            <div class="authorizations" data-testid="plugin-authorizations">
              <div class="text">
                <h3 id="plugin-dialog-authorizations" class="label"><span>{t.authorizations}</span><InfoTip topic={t.authorizations} text={t.authorizationsHint} /></h3>
                {#if reach === 'owner'}<p class="hint">{t.authorizationsOwner}</p>{/if}
              </div>
              {#if reach === 'listed'}
                {#if (current.permissions ?? []).length > 0}
                  <ul class="chips">{#each current.permissions ?? [] as permission (permission)}<li class="chip" title={permission} data-testid="plugin-authorization">{t.permission[permission]}</li>{/each}</ul>
                {:else}<span class="hint">{t.reachesNothing}</span>{/if}
              {/if}
            </div>
          </section>
        {/if}

        <section class="group details" aria-label={t.details}>
          {@render details(current)}
        </section>
      </div>

      <div class="actions">
        {#if hasFiles(current) && current.status !== 'installing'}
          <button type="button" class="ghost danger-text" data-testid="plugin-uninstall" data-plugin={current.id} disabled={working} onclick={() => onuninstall(current)}><span class="ui-label">{t.remove}</span></button>
        {/if}
        <button type="button" class="quiet push" onclick={onclose}><span class="ui-label">{strings.common.close}</span></button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0; z-index: 60;
    display: flex; align-items: flex-start; justify-content: center;
    padding-top: min(8vh, 72px);
    background: var(--color-scrim);
    animation: fade var(--dur-2) var(--ease-out-quint);
  }
  .scrim.closing { animation-name: fade-out; pointer-events: none; }
  .dialog {
    width: min(560px, calc(100vw - 32px));
    max-height: min(84vh, 720px);
    display: flex; flex-direction: column;
    background: var(--color-surface);
    border: 1px solid var(--color-edge);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-e3);
    overflow: hidden;
    animation: pop var(--dur-2) var(--ease-out-quint);
  }
  .dialog:focus { outline: none; }
  .dialog.closing { animation-name: pop-out; }
  .head { display: flex; align-items: center; gap: 12px; padding: 14px 12px 12px 18px; border-bottom: 1px solid var(--color-border); }
  .glyph { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--radius-md); background: var(--color-surface-2); color: var(--color-muted-foreground); }
  .who { flex: 1; min-width: 0; display: grid; gap: 3px; }
  h2 { margin: 0; display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: var(--text-md); overflow-wrap: anywhere; }
  .version { flex: none; font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 400; color: var(--color-muted-foreground); }
  .author { margin: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .body { flex: 1; min-height: 0; overflow: auto; padding: 4px 18px 16px; display: grid; gap: 4px; align-content: start; }
  .description { margin: 10px 0 4px; font-size: var(--text-sm); line-height: 1.5; color: var(--color-muted-foreground); }
  .group { padding-top: 10px; }
  .group + .group { border-top: 1px solid var(--color-border); margin-top: 6px; }
  h3.section-label { margin: 0; display: flex; align-items: center; gap: 6px; }
  .rows { display: grid; }
  .authorizations { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px 16px; padding: 4px 0 6px; }
  .authorizations .text { display: grid; gap: 3px; min-width: 0; }
  .label { margin: 0; display: flex; align-items: center; gap: 4px; font-size: var(--text-base); font-weight: 500; }
  .hint { margin: 0; font-size: var(--text-sm); line-height: 1.45; color: var(--color-muted-foreground); }
  .chips { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
  .chips .chip { height: auto; padding: 1px 6px; font-size: var(--text-xs); }
  .details { display: grid; gap: 10px; padding-bottom: 2px; }
  .actions { display: flex; align-items: center; gap: 6px; padding: 8px 12px 10px; border-top: 1px solid var(--color-border); }
  .push { margin-left: auto; }
  .danger-text { color: var(--color-danger); }
  @media (max-width: 720px) {
    .scrim { align-items: flex-end; padding-top: 0; }
    .dialog { width: 100vw; max-height: 90dvh; border-radius: var(--radius-xl) var(--radius-xl) 0 0; padding-bottom: env(safe-area-inset-bottom); }
    .authorizations { grid-template-columns: minmax(0, 1fr); }
    .chips { justify-content: flex-start; }
  }
</style>
