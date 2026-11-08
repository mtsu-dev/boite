<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { RotateCcw, SlidersHorizontal } from '@lucide/svelte';
  import { ACCENT_PRESETS, readAccent, setAccent } from '../lib/accent';
  import { accentHex, contrast, editPalette, paletteTokens, improvePaletteContrast, type ColorRole, type Palette } from '../lib/color-math';
  import { setTheme } from '../lib/theme';
  import { colorMode, COLORS_EVENT, hasCustomColors, PALETTES, presetPalette, readPalette, resetColors, setPalette, type ColorMode, type PaletteId } from '../lib/theme-colors';
  import { fill, strings } from '../lib/strings';
  import { tenth } from '../lib/format';
  import ChoiceSelect from './ChoiceSelect.svelte';
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
  let choices = $derived(presets.map((preset) => ({ id: preset.id, name: strings.settings.colors.palettes[preset.id] })));
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

<!-- A palette as a small window drawn in its own colours: the chrome, the page with three lines of text, its accent.
     Edited colours draw what is in use. -->
{#snippet tile(id: PaletteId | undefined)}
  {@const colors = (id && presets.find((preset) => preset.id === id)?.palette) || palette}
  <span class="tile" style:--tile-frame={colors.frame} style:--tile-page={colors.background} style:--tile-ink={colors.foreground} style:--tile-accent={colors.accent}>
    <span class="chrome"></span><span class="lines"><i></i><i></i><i></i></span><span class="accent"></span>
  </span>
{/snippet}

<div class="colors" data-testid="theme-colors">
  <div class="heading">
    <span class="text ui-label-box"><span class="ui-label">{strings.settings.colors.title}</span><InfoTip topic={strings.settings.colors.title} text={strings.settings.colors.hint} /></span>
    <!-- Undo and Reset only once there is something to take back. -->
    <div class="actions">
      {#if canUndo}<button type="button" class="small ghost" onclick={undoEdit} data-testid="colors-undo"><span class="ui-label">{strings.settings.colors.undo}</span></button>{/if}
      {#if custom}<button type="button" class="small ghost" onclick={reset} data-testid="colors-reset"><RotateCcw size={13} /><span class="ui-label">{strings.settings.colors.reset}</span></button>{/if}
      <button type="button" class="ghost small customize" aria-expanded={customizing} aria-controls={editorId} onclick={() => { customizing = !customizing; }} data-testid="colors-customize"><SlidersHorizontal size={14} /><span class="ui-label">{strings.settings.colors.customize}</span></button>
      <ChoiceSelect label={strings.settings.colors.palette} options={choices} value={matching} fallback={strings.settings.colors.custom} onpick={pick} preview={tile} testid="palette-current" optionTestid={(id) => `palette-${id}`} />
    </div>
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
  .colors { padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border); }
  /* Last in its card (a phone has no width row under it): the card's edge closes it. */
  .colors:last-child { padding-bottom: 0; border-bottom: 0; }
  /* A settings row: the words on the left; the palette in use and what edits it on the right. */
  .heading { display: flex; justify-content: space-between; align-items: center; gap: var(--space-5); min-height: 44px; }
  .actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-1); min-width: 0; }
  .actions > button { display: inline-flex; align-items: center; gap: 6px; }
  .tile { position: relative; display: flex; width: 52px; height: 30px; overflow: hidden; border-radius: var(--radius-sm); background: var(--tile-page); box-shadow: inset 0 0 0 1px var(--color-edge); }
  .chrome { width: 26%; background: var(--tile-frame); }
  .lines { flex: 1; display: flex; flex-direction: column; gap: 3px; padding: 6px 5px; }
  .lines i { display: block; height: 3px; border-radius: var(--radius-full); background: color-mix(in oklab, var(--tile-ink) 22%, transparent); }
  .lines i:nth-child(2) { width: 60%; }
  .lines i:nth-child(3) { width: 80%; }
  .tile .accent { position: absolute; right: 5px; bottom: 5px; width: 7px; height: 7px; border-radius: 50%; background: var(--tile-accent); }
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
  /* A phone stacks the row as its other choices do: the words, then the palette in use across, then Customize. */
  @media (max-width: 720px) {
    .heading { flex-direction: column; align-items: stretch; gap: var(--space-3); }
    .actions { flex-direction: column-reverse; align-items: stretch; }
    .actions > button { justify-content: center; }
    .editor, .editor.customizing { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .customize { min-height: var(--touch-target); }
    .role-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .role { gap: 8px; padding: 6px; }
    .swatches { grid-column: 1 / -1; gap: 16px; padding: 12px 8px; }
    .swatch { width: var(--touch-target); height: var(--touch-target); }
    .actions button { min-height: var(--touch-target); }
  }
</style>
