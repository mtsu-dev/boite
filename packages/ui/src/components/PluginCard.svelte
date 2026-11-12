<script lang="ts">
  import { Download, ExternalLink, Puzzle, RefreshCw, Settings } from '@lucide/svelte';
  import type { PluginState } from '@boite/contracts';
  import { hasFiles, isOn, pluginAuthor, pluginChips } from '../lib/plugin-card';
  import { fill, strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';

  /**
   * One plugin on the Plugins page: its name, who publishes it, two lines of
   * what it does, the chips of what it touches, and the switch and the gear.
   * What goes wrong or waits shows here in one line; the rest is behind the gear.
   */
  let { plugin, working, installLocked, error, onopen, ontoggle, oninstall, oncancel }: {
    plugin: PluginState;
    working: boolean;
    installLocked: boolean;
    /** The last action's refusal, cleared by the next one that works. */
    error?: string;
    onopen: () => void;
    ontoggle: (on: boolean) => void;
    oninstall: () => void;
    oncancel: () => void;
  } = $props();

  const t = strings.plugins;
  const on = $derived(isOn(plugin));
  const author = $derived(pluginAuthor(plugin));
  const chips = $derived(pluginChips(plugin));
  const update = $derived(plugin.status === 'installed' && plugin.availableVersion !== null && plugin.availableVersion !== plugin.version ? plugin.availableVersion : null);
  /** Only an installed plugin turns off; one that failed to update still has the files that run. */
  const switchable = $derived(plugin.status === 'installed' || (plugin.status === 'error' && plugin.version !== null));
  const crashed = $derived(plugin.app?.status === 'crashed' ? (plugin.app.kind === 'service' ? t.service : t.app) : plugin.gateway?.status === 'crashed' ? t.gateway : null);

  /** The one line a card spends on its state, worst first; null when there is nothing to say. */
  const status = $derived.by((): { text: string; tone: 'bad' | 'live' | 'muted' | 'ok'; tip?: string } | null => {
    if (plugin.status === 'installing') return { text: `${t.stateInstalling} · ${plugin.progress}%`, tone: 'live' };
    if (plugin.status === 'rejected') return { text: t.stateRejected, tone: 'bad', tip: plugin.rejected?.message };
    if (plugin.status === 'error') return { text: t.stateError, tone: 'bad', tip: plugin.error ?? undefined };
    if (hasFiles(plugin) && !on) return { text: t.stateOff, tone: 'muted', tip: t.offHint };
    if (crashed) return { text: `${crashed} · ${t.appCrashedSignal}`, tone: 'bad', tip: plugin.app?.error ?? plugin.gateway?.error ?? undefined };
    if (update) return { text: fill(t.updateAvailable, { version: `v${update}` }), tone: 'ok' };
    return null;
  });
</script>

<article class="plugin-card" class:off={hasFiles(plugin) && !on} data-testid="plugin-row" data-plugin={plugin.id} data-status={plugin.status} data-enabled={on}>
  <header>
    <span class="glyph" aria-hidden="true"><Puzzle size={16} strokeWidth={1.75} /></span>
    <div class="who">
      <h3>
        <span class="name">{plugin.name}</span>
        <span class="meta">
          {#if plugin.version ?? plugin.availableVersion}<span class="version">v{plugin.version ?? plugin.availableVersion}</span>{/if}
          {#if plugin.homepage && !plugin.source}
            <a class="home" href={plugin.homepage} target="_blank" rel="noreferrer" title={t.source} aria-label={t.source} data-testid="plugin-home"><ExternalLink size={12} /></a>
          {/if}
        </span>
      </h3>
      {#if author}<p class="author" data-testid="plugin-author">{fill(t.byAuthor, { author })}</p>{/if}
    </div>
    <div class="controls">
      {#if plugin.status !== 'installing'}
        <button type="button" class="ghost icon gear" title={fill(t.openSettings, { name: plugin.name })} aria-label={fill(t.openSettings, { name: plugin.name })}
          data-testid="plugin-open" data-plugin={plugin.id} onclick={onopen}><Settings size={16} strokeWidth={1.75} /></button>
      {/if}
      {#if switchable}
        <input type="checkbox" role="switch" checked={on} disabled={working} aria-label={fill(on ? t.turnOff : t.turnOn, { name: plugin.name })}
          data-testid="plugin-enabled" data-plugin={plugin.id}
          onchange={(event) => { event.currentTarget.checked = on; ontoggle(!on); }} />
      {/if}
    </div>
  </header>

  {#if plugin.description}<p class="description" title={plugin.description}>{plugin.description}</p>{/if}

  {#if plugin.status === 'installing'}
    <div class="track" role="progressbar" aria-label={t.stateInstalling} aria-valuemin={0} aria-valuemax={100} aria-valuenow={plugin.progress} data-testid="plugin-progress" data-plugin={plugin.id}>
      <span class="bar" style:width="{plugin.progress}%"></span>
    </div>
  {/if}

  {#if status}
    <p class="status {status.tone}" data-testid="plugin-state" data-field={plugin.rejected?.field}>
      <span class="dot" aria-hidden="true"></span><span class="ui-label">{status.text}</span>
      {#if status.tip}<InfoTip topic={plugin.name} text={status.tip} />{/if}
    </p>
  {/if}
  {#if error}<p class="alert" role="alert" title={error} data-testid="plugin-error">{error}</p>{/if}

  {#if chips.length > 0}
    <ul class="chips">
      {#each chips as chip (chip.id)}<li class="ui-chip" class:accent={chip.tone === 'accent'} class:danger={chip.tone === 'danger'} title={chip.title} data-testid={chip.testid}>{chip.label}</li>{/each}
    </ul>
  {/if}

  {#if plugin.status === 'installing' || plugin.status === 'not-installed' || update || plugin.status === 'error' || (plugin.status === 'rejected' && plugin.origin === 'recommended')}
    <div class="act">
      {#if plugin.status === 'installing'}
        <button class="quiet small" data-testid="plugin-cancel" data-plugin={plugin.id} disabled={working} onclick={oncancel}><span class="ui-label">{strings.common.cancel}</span></button>
      {:else if plugin.status === 'not-installed'}
        <button class="primary small" data-testid="plugin-install" data-plugin={plugin.id} disabled={working || installLocked} onclick={oninstall}><Download size={14} /><span class="ui-label">{t.install}</span></button>
      {:else if update}
        <button class="primary small" data-testid="plugin-update" data-plugin={plugin.id} disabled={working || installLocked} onclick={oninstall}><span class="ui-label">{fill(t.update, { version: `v${update}` })}</span></button>
      {:else}
        <button class="small" data-testid="plugin-retry" data-plugin={plugin.id} disabled={working || installLocked} onclick={oninstall}><RefreshCw size={14} /><span class="ui-label">{plugin.status === 'error' ? strings.common.retry : t.reinstall}</span></button>
      {/if}
    </div>
  {/if}
</article>

<style>
  .plugin-card {
    display: flex; flex-direction: column; gap: 8px; min-width: 0;
    padding: 12px;
    /* A settings card (app.css `.card`): the card fill, no frame and no lift. */
    border-radius: var(--radius-lg);
    background: var(--card-fill);
    transition: opacity var(--motion-duration) var(--motion-curve);
    animation: rise var(--motion-duration) var(--motion-curve);
  }
  /* Off reads as resting, not broken: the words fade, the switch stays sharp. */
  .plugin-card.off :is(.who, .description, .chips) { opacity: .6; }

  header { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
  .glyph { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-md); background: var(--color-active); color: var(--color-muted-foreground); }
  .who { flex: 1; min-width: 0; display: grid; gap: 3px; padding-top: 1px; }
  h3 { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; min-width: 0; font-size: var(--text-base); font-weight: 600; }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { flex: none; display: inline-flex; align-items: baseline; gap: 6px; }
  .meta:empty { display: none; }
  .version { font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 400; color: var(--color-muted-foreground); }
  .home { flex: none; align-self: center; display: inline-grid; place-items: center; color: var(--color-muted-foreground); border-radius: var(--radius-sm); transition: color var(--dur-1) var(--ease-out-quint); }
  .home:hover, .home:focus-visible { color: var(--color-foreground); }
  .author { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .controls { flex: none; display: flex; align-items: center; gap: 6px; --switch-width: 34px; --switch-height: 20px; }
  .gear { color: var(--color-muted-foreground); }
  .gear:hover, .gear:focus-visible { color: var(--color-foreground); }

  /* Two lines, the rest on hover and behind the gear. */
  .description {
    margin: 0; font-size: var(--text-sm); line-height: 1.5; color: var(--color-muted-foreground);
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }

  .track { height: 2px; border-radius: 999px; background: var(--color-surface-3); overflow: hidden; }
  .bar { display: block; height: 100%; background: var(--color-foreground); transition: width var(--dur-2) var(--ease-out-quint); }

  .status { margin: 0; display: flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  .status .ui-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Hue is for status only: green for news, amber while working, red when something failed. */
  .dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--color-subtle); }
  .status.ok .dot { background: var(--color-success); }
  .status.live .dot { background: var(--color-live); }
  .status.bad { color: var(--color-danger); }
  .status.bad .dot { background: var(--color-danger); }
  .alert { margin: 0; font-size: var(--text-sm); color: var(--color-danger); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }

  .chips { margin: auto 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 4px; }
  .chips .ui-chip { height: auto; padding: 1px 6px; font-size: var(--text-xs); max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .chips .ui-chip.accent { border-color: transparent; background: var(--color-accent-soft); color: var(--color-accent); }
  .chips .ui-chip.danger { color: var(--color-danger); border-color: color-mix(in srgb, var(--color-danger) 40%, transparent); }

  .act { display: flex; flex-wrap: wrap; gap: 4px; }
  .act button { gap: 6px; }
  @media (prefers-reduced-motion: reduce) { .plugin-card { animation: none; } }
</style>
