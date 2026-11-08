<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { Check, ChevronDown, RotateCcw, SlidersHorizontal } from '@lucide/svelte';
  import { ACCENT_PRESETS, readAccent, setAccent } from '../lib/accent';
  import { accentHex, contrast, editPalette, paletteTokens, improvePaletteContrast, type ColorRole, type Palette } from '../lib/color-math';
  import { setTheme } from '../lib/theme';
  import { colorMode, COLORS_EVENT, hasCustomColors, PALETTES, presetPalette, readPalette, resetColors, setPalette, type ColorMode, type PaletteId } from '../lib/theme-colors';
  import { fill, strings } from '../lib/strings';
  import { tenth } from '../lib/format';
  import ColorPicker from './ColorPicker.svelte';
  import InfoTip from './InfoTip.svelte';

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
  /** A phone shows the palette in use as one row that opens the others: seven rows were a screen of choices. */
  const narrow = new MediaQuery('(max-width: 720px)');
  let listOpen = $state(false);
  let shown = $derived(presets.find((preset) => preset.id === matching));
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
    listOpen = false;
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

<div class="colors" data-testid="theme-colors">
  <div class="heading">
    <h3><span class="ui-label">{strings.settings.colors.title}</span><InfoTip topic={strings.settings.colors.title} text={strings.settings.colors.hint} /></h3>
    <!-- Undo and Reset only once there is something to take back. -->
    <div class="actions">
      {#if canUndo}<button type="button" class="small ghost" onclick={undoEdit} data-testid="colors-undo"><span class="ui-label">{strings.settings.colors.undo}</span></button>{/if}
      {#if custom}<button type="button" class="small ghost" onclick={reset} data-testid="colors-reset"><RotateCcw size={13} /><span class="ui-label">{strings.settings.colors.reset}</span></button>{/if}
      <button type="button" class="ghost small customize" aria-expanded={customizing} aria-controls={editorId} onclick={() => { customizing = !customizing; }} data-testid="colors-customize"><SlidersHorizontal size={14} /><span class="ui-label">{strings.settings.colors.customize}</span></button>
    </div>
  </div>
  <!-- Each palette as a small window drawn in its own colors: the chrome, the
       page with three lines of text, and its accent. One row sized to the
       count, so no row is left with a hole. -->
  {#if narrow.current}
    <button type="button" class="preset current" aria-expanded={listOpen} onclick={() => { listOpen = !listOpen; }} data-testid="palette-current"
      style:--tile-frame={palette.frame} style:--tile-page={palette.background} style:--tile-ink={palette.foreground} style:--tile-accent={palette.accent}>
      <!-- Open, the list below names and checks the palette in use: the head turns into the list's title, so it shows once. -->
      {#if listOpen}<span class="name"><span class="ui-label">{strings.settings.colors.palette}</span><ChevronDown size={18} strokeWidth={1.75} /></span>
      {:else}<span class="preview" aria-hidden="true"><span class="chrome"></span><span class="lines"><i></i><i></i><i></i></span><span class="accent"></span></span>
      <span class="name"><span class="ui-label">{shown ? strings.settings.colors.palettes[shown.id] : strings.settings.colors.custom}</span><ChevronDown size={18} strokeWidth={1.75} /></span>{/if}
    </button>
  {/if}
  {#if !narrow.current || listOpen}
  <div class="presets" role="group" aria-label={strings.settings.colors.palette} style:--count={presets.length}>
    {#each presets as preset (preset.id)}
      <button type="button" class="preset" aria-pressed={matching === preset.id} onclick={() => pick(preset.id)} data-testid="palette-{preset.id}"
        style:--tile-frame={preset.palette.frame} style:--tile-page={preset.palette.background} style:--tile-ink={preset.palette.foreground} style:--tile-accent={preset.palette.accent}>
        <span class="preview" aria-hidden="true"><span class="chrome"></span><span class="lines"><i></i><i></i><i></i></span><span class="accent"></span></span>
        <span class="name"><span class="ui-label">{strings.settings.colors.palettes[preset.id]}</span>{#if matching === preset.id}<Check size={13} strokeWidth={2.25} />{/if}</span>
      </button>
    {/each}
  </div>
  {/if}
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
  .colors { padding: 20px 0; border-bottom: 1px solid var(--color-border); container-type: inline-size; }
  /* Last in its card (a phone has no width row under it): the card's edge closes it. */
  .colors:last-child { padding-bottom: 0; border-bottom: 0; }
  .heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
  h3 { display: flex; align-items: center; gap: 4px; font-size: var(--text-base); }
  .actions { display: flex; gap: 4px; }
  .actions button { display: inline-flex; align-items: center; gap: 6px; }
  .presets { display: grid; grid-template-columns: repeat(var(--count), minmax(0, 1fr)); gap: 12px 10px; }
  .preset { display: flex; flex-direction: column; align-items: stretch; gap: 6px; height: auto; min-height: 0; padding: 0; border: 0; background: none; box-shadow: none; min-width: 0; text-align: left; color: var(--color-muted-foreground); font-size: var(--text-xs); font-weight: 600; }
  .preset:hover:not(:disabled) { background: none; color: var(--color-foreground); }
  .preview { position: relative; display: flex; height: 56px; overflow: hidden; border-radius: var(--radius-md); background: var(--tile-page); box-shadow: inset 0 0 0 1px var(--color-edge); transition: box-shadow var(--dur-2) var(--ease-out-quint); }
  .preset:hover .preview { box-shadow: inset 0 0 0 1px var(--color-muted-foreground); }
  .chrome { width: 26%; background: var(--tile-frame); }
  .lines { flex: 1; display: flex; flex-direction: column; gap: 5px; padding: 9px 8px; }
  .lines i { display: block; height: 5px; border-radius: var(--radius-full); background: color-mix(in oklab, var(--tile-ink) 22%, transparent); }
  .lines i:nth-child(2) { width: 60%; }
  .lines i:nth-child(3) { width: 80%; }
  .preview .accent { position: absolute; right: 7px; bottom: 7px; width: 9px; height: 9px; border-radius: 50%; background: var(--tile-accent); }
  /* The chosen one: the focus ring's 2 px outline round its picture, and a check by its name. */
  .preset[aria-pressed='true'] { color: var(--color-foreground); }
  .preset[aria-pressed='true'] .preview { box-shadow: 0 0 0 2px var(--color-foreground); }
  .name { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .name .ui-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name :global(svg) { flex: none; }
  .customize { display: inline-flex; align-items: center; gap: 7px; flex: none; }
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
  /* Too narrow for one row of readable tiles: one list, a small picture beside each name. */
  @container (max-width: 640px) {
    .presets { grid-template-columns: minmax(0, 1fr); gap: 2px; }
    .preset { flex-direction: row; align-items: center; gap: 12px; min-height: var(--touch-target); padding: 4px 6px; border-radius: var(--radius-md); font-size: var(--text-sm); }
    .preview { flex: none; width: 64px; height: 36px; }
    .lines { gap: 3px; padding: 6px 5px; }
    .lines i { height: 3px; }
    .preview .accent { right: 5px; bottom: 5px; width: 7px; height: 7px; }
    .name { flex: 1; justify-content: space-between; }
  }
  @media (max-width: 720px) {
    .current { flex-direction: row; align-items: center; gap: 12px; width: 100%; min-height: var(--touch-target); padding: 4px 6px; border-radius: var(--radius-md); color: var(--color-foreground); font-size: var(--text-sm); }
    .current + .presets { margin-top: var(--space-1); }
    .current .name :global(svg) { color: var(--color-muted-foreground); transition: transform var(--dur-2) var(--ease-out-quint); }
    .current[aria-expanded='true'] .name :global(svg) { transform: rotate(180deg); }
    .editor, .editor.customizing { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .customize { min-height: var(--touch-target); }
    .role-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .role { gap: 8px; padding: 6px; }
    .swatches { grid-column: 1 / -1; gap: 16px; padding: 12px 8px; }
    .swatch { width: var(--touch-target); height: var(--touch-target); }
    .actions button { min-height: var(--touch-target); }
  }
</style>
