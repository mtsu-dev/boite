<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Check, LayoutGrid, RotateCcw, SlidersHorizontal } from '@lucide/svelte';
  import { curated } from '../lib/curated';
  import { ACCENT_PRESETS, readAccent, setAccent } from '../lib/accent';
  import { accentHex, contrast, editPalette, paletteTokens, improvePaletteContrast, type ColorRole, type Palette } from '../lib/color-math';
  import { setTheme } from '../lib/theme';
  import { colorMode, COLORS_EVENT, hasCustomColors, PALETTES, presetPalette, readPalette, resetColors, setPalette, type ColorMode, type PaletteId } from '../lib/theme-colors';
  import { fill, strings } from '../lib/strings';
  import { tenth } from '../lib/format';
  import ColorPicker from './ColorPicker.svelte';
  import InfoTip from './InfoTip.svelte';

  /**
   * The palettes as their pictures under the row, on a phone as on a desktop:
   * a short list is picked in sight, not from a sheet. The one in use and the
   * first others stand in front (`FRONT` in all); "All themes" opens the rest.
   */
  const FRONT = 4;
  let everything = $state(false);
  let grid = $state<HTMLElement>();

  /** The rest opens where "All themes" stood, the first of them in focus. */
  async function openAll() {
    const at = front.length;
    everything = true;
    await tick();
    grid?.querySelectorAll<HTMLElement>('.palette')[at]?.focus();
  }
  let mode = $state<ColorMode>(untrack(colorMode));
  let palette = $state<Palette>(untrack(() => readPalette(mode)));
  let custom = $state(untrack(() => hasCustomColors(mode)));
  let accent = $state(untrack(readAccent));
  let role = $state<ColorRole>('accent');
  let undo = $state<Palette>();
  let editingRole: ColorRole | undefined;
  let customizing = $state(false);
  const editorId = $props.id();
  const roles: ColorRole[] = ['background', 'frame', 'surface', 'foreground', 'accent'];
  let presets = $derived.by(() => { accent; return PALETTES.map(id => ({ id, palette: presetPalette(id, mode) })); });
  let tokens = $derived(paletteTokens(palette));
  let grounds = $derived(['--color-background', '--color-frame', '--color-surface', '--color-surface-2', '--color-surface-3'].map(key => tokens[key]!));
  let ratio = $derived(Math.min(...grounds.map(ground => contrast(palette.foreground, ground))));
  let matching = $derived(presets.find(p => roles.every(key => p.palette[key] === palette[key]) && JSON.stringify(p.palette.details ?? {}) === JSON.stringify(palette.details ?? {}))?.id);
  let choices = $derived(presets.map((preset) => ({ id: preset.id, name: strings.settings.colors.palettes[preset.id] })));
  let front = $derived(everything ? choices : curated(choices, matching, FRONT));
  let canUndo = $derived(!!undo && JSON.stringify(undo) !== JSON.stringify(palette));
  function follow() {
    const nextMode = colorMode();
    if (nextMode !== mode) { undo = undefined; editingRole = undefined; }
    mode = nextMode;
    palette = readPalette(mode);
    accent = readAccent();
    custom = hasCustomColors(mode);
  }
  onMount(() => {
    window.addEventListener(COLORS_EVENT, follow);
    return () => window.removeEventListener(COLORS_EVENT, follow);
  });
  function pick(id: PaletteId) {
    if (id === 'oled') { setTheme('dark'); follow(); }
    editingRole = undefined;
    undo = { ...palette };
    if (id === 'default') resetColors(mode);
    else setPalette(mode, presetPalette(id, mode));
  }
  function select(next: ColorRole) { customizing = true; if (role !== next) editingRole = undefined; role = next; }
  function edit(value: string) {
    if (editingRole !== role) { undo = { ...palette }; editingRole = role; }
    setPalette(mode, editPalette(palette, role, value));
  }
  function reset() { editingRole = undefined; undo = { ...palette }; resetColors(mode); }
  function undoEdit() {
    if (!undo) return;
    const previous = undo;
    editingRole = undefined;
    undo = { ...palette };
    setPalette(mode, previous);
  }
  function improveContrast() {
    editingRole = undefined;
    undo = { ...palette };
    setPalette(mode, improvePaletteContrast(palette));
  }
  function pickAccent(hue: number) { editingRole = undefined; undo = { ...palette }; setAccent(hue); follow(); }
</script>

<!-- A palette as a tiny thread in its own five colours: the chrome, your message as a bubble on its
     surface, the agent's answer as lines of its text, and the composer with its accent's send button.
     Edited colours draw what is in use. -->
{#snippet tile(id: PaletteId)}
  {@const colors = presets.find((preset) => preset.id === id)?.palette ?? palette}
  <span class="tile" style:--tile-frame={colors.frame} style:--tile-page={colors.background} style:--tile-surface={colors.surface} style:--tile-ink={colors.foreground} style:--tile-accent={colors.accent}>
    <span class="chrome"></span>
    <span class="body"><span class="bubble"><i></i></span><span class="lines"><i></i><i></i></span><span class="composer"><i></i><span class="accent"></span></span></span>
  </span>
{/snippet}

<!-- Undo and Reset only once there is something to take back. -->
{#snippet edits()}
    <div class="actions">
      {#if canUndo}<button type="button" class="small ghost" onclick={undoEdit} data-testid="colors-undo"><span class="ui-label">{strings.settings.colors.undo}</span></button>{/if}
      {#if custom}<button type="button" class="small ghost" onclick={reset} data-testid="colors-reset"><RotateCcw size={13} /><span class="ui-label">{strings.settings.colors.reset}</span></button>{/if}
      <button type="button" class="ghost small customize" aria-expanded={customizing} aria-controls={editorId} onclick={() => { customizing = !customizing; }} data-testid="colors-customize"><SlidersHorizontal size={14} /><span class="ui-label">{strings.settings.colors.customize}</span></button>
    </div>
{/snippet}

<div class="colors" data-testid="theme-colors">
  <div class="heading">
    <span class="text ui-label-box"><span class="ui-label">{strings.settings.colors.title}</span><InfoTip topic={strings.settings.colors.title} text={strings.settings.colors.hint} /></span>
    {@render edits()}
  </div>
  <!-- Each palette by its picture, its name under it, the one in use checked; edited colours check none. -->
  <div class="palettes" role="group" aria-label={strings.settings.colors.palette} data-testid="palette-current" bind:this={grid}>
    {#each front as choice (choice.id)}
      <button type="button" class="palette" aria-pressed={choice.id === matching} data-testid="palette-{choice.id}" onclick={() => pick(choice.id)}>
        {@render tile(choice.id)}
        {#if choice.id === matching}<span class="picked" aria-hidden="true"><Check size={12} strokeWidth={2.5} /></span>{/if}
        <span class="ui-label">{choice.name}</span>
      </button>
    {/each}
    {#if front.length < choices.length}
      <button type="button" class="palette all" aria-expanded="false" data-testid="palette-all" onclick={() => void openAll()}>
        <span class="tile more" aria-hidden="true"><LayoutGrid size={16} strokeWidth={1.75} /></span><span class="ui-label">{strings.settings.colors.allThemes}</span>
      </button>
    {/if}
  </div>
  <div class="editor" class:customizing id={editorId}>
    {#if customizing}
    <div class="role-list" role="group" aria-label={strings.settings.colors.edit}>
      {#each roles as key (key)}
        <button type="button" class="role" aria-pressed={role === key} onclick={() => select(key)} data-testid="color-{key}">
          <span class="dot" style:background={palette[key]}></span>
          <span class="role-name">{strings.settings.colors.roles[key]}<span class="value">{palette[key].toUpperCase()}</span></span>
          {#if role === key}<span class="selected" aria-hidden="true"></span>{/if}
        </button>
      {/each}
      <div class="swatches" role="group" aria-label={strings.settings.accent}>
        {#each ACCENT_PRESETS as hue, index (hue)}
          <button type="button" class="swatch" data-accent-swatch style:background={`oklch(75.5% 0.141 ${hue})`} aria-label={strings.settings.accentNames[index]} aria-pressed={palette.accent === accentHex(hue)} data-testid="accent-{hue}" onclick={() => pickAccent(hue)}></button>
        {/each}
      </div>
    </div>
    <div class="right">
      {#key role}<ColorPicker value={palette[role]} label={strings.settings.colors.roles[role]} onchange={edit} />{/key}
    </div>
    {/if}
  </div>
  {#if ratio < 4.5}
  <div class="contrast" data-testid="theme-contrast">
    <span class="ui-label-box"><span class="ui-label">{fill(strings.settings.colors.contrastLow, { ratio: tenth(ratio) })}</span><InfoTip topic={strings.settings.colors.contrast} text={strings.settings.colors.contrastHint} /></span>
    <button type="button" class="small" onclick={improveContrast} data-testid="colors-contrast-fix"><span class="ui-label">{strings.settings.colors.improveContrast}</span></button>
  </div>
  {/if}
</div>

<style>
  .colors { padding: var(--space-2) 0 var(--space-3); }
  /* The palettes in one row of pictures, the one in use ringed. */
  /* auto-fit: the pictures share the row's whole width, none of it left as an empty right half. */
  .palettes { display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: var(--space-2); margin-top: var(--space-1); }
  .palette { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 6px; height: auto; min-width: 0; padding: var(--space-1); border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: var(--color-muted-foreground); font-size: var(--text-sm); font-weight: 400; transition: transform var(--motion-duration) var(--motion-curve); }
  /* The picture keeps its proportions as the row widens: 46 px tall at the narrowest. */
  .palette .tile { width: 100%; height: auto; aspect-ratio: 1.8; }
  .palette .ui-label { text-align: center; }
  /* A tile lifts under the pointer: a picture invites the click. */
  @media (hover: hover) { .palette:hover { background: var(--color-hover); color: var(--color-foreground); transform: translateY(-1px); } }
  .palette .tile { transition: box-shadow var(--motion-duration) var(--motion-curve); }
  .palette[aria-pressed='true'] { color: var(--color-foreground); }
  /* "All themes" stands as one more tile, an empty frame round its mark. */
  .tile.more { align-items: center; justify-content: center; background: transparent; color: var(--color-muted-foreground); box-shadow: inset 0 0 0 1px var(--color-border); }
  .palette[aria-pressed='true'] .tile { box-shadow: inset 0 0 0 1px var(--color-edge), 0 0 0 2px var(--color-accent); }
  /* The one in use carries a check on its picture's corner, lit like a chosen segment: neutral, the accent stays its ring. */
  .picked { position: absolute; top: 0; right: 0; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: var(--color-foreground); color: var(--color-on-foreground); box-shadow: 0 0 0 2px var(--color-surface); animation: pop var(--motion-duration) var(--motion-curve); }
  /* A settings row: the words on the left; the palette in use and what edits it on the right. */
  .heading { display: flex; justify-content: space-between; align-items: center; gap: var(--space-5); min-height: 44px; }
  .actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-1); min-width: 0; }
  .actions > button { display: inline-flex; align-items: center; gap: 6px; }
  .tile { position: relative; display: flex; overflow: hidden; border-radius: var(--radius-sm); background: var(--tile-page); box-shadow: inset 0 0 0 1px var(--color-edge); }
  .chrome { width: 22%; background: var(--tile-frame); }
  /* Sized off the tile's width, so the composer still fits a 84 px tile at 360 px. */
  .body { flex: 1; display: flex; flex-direction: column; justify-content: space-between; gap: 3px; min-width: 0; padding: 7% 8% 7%; }
  /* Your message: a bubble on the palette's surface, right-aligned as in a thread, its words in the ink. */
  .bubble { align-self: flex-end; display: flex; align-items: center; width: 48%; height: 9px; padding: 0 3px; border-radius: var(--radius-full); background: var(--tile-surface); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--tile-ink) 18%, transparent); }
  .bubble i { display: block; width: 80%; height: 2px; border-radius: var(--radius-full); background: color-mix(in oklab, var(--tile-ink) 70%, transparent); }
  .lines { display: flex; flex-direction: column; gap: 2px; }
  /* The answer in its own ink, read strong enough to tell a warm palette from a cold one. */
  .lines i { display: block; height: 3px; border-radius: var(--radius-full); background: color-mix(in oklab, var(--tile-ink) 75%, transparent); }
  .lines i:nth-child(2) { width: 64%; background: color-mix(in oklab, var(--tile-ink) 45%, transparent); }
  /* The composer on the palette's surface, its send button in the palette's accent. */
  .composer { display: flex; justify-content: space-between; align-items: center; gap: 3px; height: 10px; padding: 0 2px 0 4px; border-radius: var(--radius-full); background: var(--tile-surface); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--tile-ink) 14%, transparent); }
  .composer i { display: block; width: 40%; height: 2px; border-radius: var(--radius-full); background: color-mix(in oklab, var(--tile-ink) 30%, transparent); }
  .tile .accent { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--tile-accent); }
  .customize { flex: none; }
  .editor { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .editor.customizing { grid-template-columns: minmax(150px, .8fr) minmax(0, 1.6fr); margin-top: 16px; }
  .role-list { display: flex; flex-direction: column; gap: 5px; }
  .role { display: flex; align-items: center; gap: 10px; height: auto; min-height: 50px; padding: 8px 10px; border-radius: var(--radius-md); border: 1px solid transparent; background: transparent; text-align: left; }
  .role:hover { background: var(--color-hover); }
  .role[aria-pressed='true'] { background: var(--color-surface-2); border-color: var(--color-edge); }
  .dot { height: 26px; width: 26px; flex: none; border-radius: var(--radius-sm); border: 1px solid var(--color-edge); }
  .role-name { flex: 1; display: grid; gap: 2px; font-size: var(--text-sm); white-space: normal; }
  .value { color: var(--color-muted-foreground); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .selected { width: 5px; height: 5px; border-radius: 50%; background: var(--color-foreground); }
  .right { display: grid; gap: 12px; min-width: 0; }
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; padding: 14px 10px 0; }
  .swatch { width: 22px; height: 22px; min-height: 0; padding: 0; border-radius: 50%; border: 2px solid var(--color-surface); }
  .swatch[aria-pressed='true'] { outline: 2px solid var(--color-foreground); outline-offset: 2px; }
  .contrast { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 18px; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  .contrast > span:first-child { color: var(--color-danger); }
  .contrast > span:first-child { display: flex; align-items: center; }
  .heading .text { color: var(--color-foreground); font-size: var(--text-base); }
  @media (max-width: 720px) {
    /* The label and its edits on one line while they fit, the edits under it at 360 px in French. */
    .heading { flex-wrap: wrap; gap: 0 var(--space-3); }
    .palettes { grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); }
    .editor, .editor.customizing { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .customize { min-height: var(--touch-target); }
    .role-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .role { gap: 8px; padding: 6px; }
    .swatches { grid-column: 1 / -1; gap: 16px; padding: 12px 8px; }
    .swatch { width: var(--touch-target); height: var(--touch-target); }
    .actions button { min-height: var(--touch-target); }
  }
</style>
