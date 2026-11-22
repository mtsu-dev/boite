<script lang="ts">
  import SettingSwitch from './SettingSwitch.svelte';
  import SettingField from './SettingField.svelte';
  import SettingsSection from './SettingsSection.svelte';
  import { errorText } from '../lib/errors';
  import { Minus, Plus } from '@lucide/svelte';
  import { onMount, untrack } from 'svelte';
  import { FONT_KEY, FONTS, MONO_KEY, MONOS, readFont, readMono, setFont, setMono, type Font, type Mono } from '../lib/fonts';
  import { percent } from '../lib/format';
  import { currentZoom, inShell, setZoom, stepZoom, subscribeZoom, wantedZoom, ZOOM_DEFAULT, ZOOM_STEPS } from '../lib/zoom';
  import { effectiveGlass, hasMaterialChoice, readGlass, setGlass, supportedGlass, type Glass } from '../lib/glass';
  import { fill, LOCALES, localeSetting, setLocaleSetting, strings, type LocaleSetting } from '../lib/i18n.svelte';
  import { readTheme, setTheme, THEME_STORAGE_KEY, type Theme } from '../lib/theme';
  import { COLORS_EVENT } from '../lib/theme-colors';
  import { readChatWidth, setChatWidth, type ChatWidth } from '../lib/chat-width';
  import { matchingPreset, work, type Profile } from '../lib/work-prefs.svelte';
  import ThemeColors from './ThemeColors.svelte';
  import ChoiceSelect from './ChoiceSelect.svelte';
  import { controlGroups } from '../lib/control-groups';
  import type { Store } from '../lib/store.svelte';
  import SurfaceIcon from './SurfaceIcon.svelte';
  import { featureOn } from '../lib/features.svelte';
  import { setFeature } from '../lib/features';
  import { experimentOn } from '../lib/experiments.svelte';
  import { backdropEntry } from '../lib/backdrop-entry.svelte';

  /**
   * Visual choices only: language, theme, colours, widths, the Whip, faces,
   * zoom and the buttons shown. What the app does (how a turn's changes show, where a window
   * starts, the terminal's renderer) lives under General, and the terminal's
   * cursor and the edge scrollbars under Advanced. `phone`: what a phone reads
   * and looks like; the column width and the header's buttons are the desktop's.
   * A short choice (language, theme, width) is a segmented control and the
   * palettes are their pictures, every option in sight; only a face, a longer
   * list, is one row in its own face that opens the others (`ChoiceSelect`).
   */
  let { store, phone = false }: { store: Store; phone?: boolean } = $props();
  $effect(() => backdropEntry.need());

  // The terminal is the owner's to hide; Add a project is too, unless the device's core lets it add.
  let groups = $derived(controlGroups(store.owner, store.addsProjects));
  let presets = $derived<{ id: Profile; label: string }[]>([
    { id: 'everyday', label: strings.controls.everyday },
    { id: 'developer', label: strings.controls.developer }
  ]);
  /** Lit while the buttons are exactly one preset's; a device that picked its own lights neither. */
  let preset = $derived(matchingPreset(work.current.hidden));

  /*
   * A face's own name, the same in every language; `system` is the one the
   * catalogue words. Here rather than in lib/fonts.ts, which the entry chunk
   * carries: nothing but this picker reads them.
   */
  const FONT_NAMES: Record<Exclude<Font, 'system'>, string> = {
    inter: 'Inter',
    atkinson: 'Atkinson Hyperlegible',
    source: 'Source Sans 3',
    plex: 'IBM Plex Sans'
  };
  const MONO_NAMES: Record<Exclude<Mono, 'system'>, string> = { geist: 'Geist Mono', jetbrains: 'JetBrains Mono' };

  let font = $state<Font>(untrack(() => readFont()));
  let mono = $state<Mono>(untrack(() => readMono()));
  let faces = $derived(FONTS.map((id) => ({ id, name: id === 'system' ? strings.settings.fontSystem : FONT_NAMES[id] })));
  let monos = $derived(MONOS.map((id) => ({ id, name: id === 'system' ? strings.settings.monoSystem : MONO_NAMES[id] })));
  function pickFont(next: Font) { font = next; setFont(next); }
  function pickMono(next: Mono) { mono = next; setMono(next); }

  // The zoom is the shell webview's own; a browser tab has its own Ctrl+= already.
  const zoomable = inShell();
  let zoom = $state(currentZoom());
  let zoomError = $state('');
  function zoomTo(factor: number) {
    zoomError = '';
    setZoom(factor).catch((error: unknown) => {
      zoomError = fill(strings.settings.zoomFailed, { error: errorText(error) });
    });
  }
  const smallest = ZOOM_STEPS[0] ?? ZOOM_DEFAULT;
  const largest = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? ZOOM_DEFAULT;

  let themes = $derived<{ id: Theme; label: string }[]>([
    { id: 'system', label: strings.settings.themeSystem },
    { id: 'dark', label: strings.settings.themeDark },
    { id: 'light', label: strings.settings.themeLight },
    { id: 'grain', label: strings.settings.themeGrain }
  ]);

  let theme = $state<Theme>(untrack(() => readTheme()));

  let chatWidth = $state<ChatWidth>(untrack(() => readChatWidth()));
  let widths = $derived<{ id: ChatWidth; label: string }[]>([
    { id: 'comfortable', label: strings.settings.chatWidthComfortable },
    { id: 'wide', label: strings.settings.chatWidthWide },
    { id: 'full', label: strings.settings.chatWidthFull }
  ]);
  function pickChatWidth(next: ChatWidth) {
    chatWidth = next;
    setChatWidth(next);
  }
  // A width pointed at or focused shows in the sample before it is picked; leaving it shows the one in use.
  let pointedWidth = $state<ChatWidth | null>(null);
  let sampleWidth = $derived(pointedWidth ?? chatWidth);

  function pickTheme(next: Theme) {
    theme = next;
    setTheme(next);
  }

  // The labels follow the language, so the list is derived rather than built
  // once when the page mounts.
  // Only the kinds this Windows draws without lag: the shell answers from its build.
  let offered = $state<Glass[]>([]);
  let materials = $derived(
    ([
      { id: 'acrylic', label: strings.settings.materialAcrylic },
      { id: 'mica', label: strings.settings.materialMica },
      { id: 'solid', label: strings.settings.materialSolid }
    ] satisfies { id: Glass; label: string }[]).filter((option) => offered.includes(option.id))
  );

  // Follows the language set anywhere (another window, a script); a pick lights at once, before its catalogue loads.
  let locale = $derived<LocaleSetting>(localeSetting());
  function pickLocale(next: LocaleSetting) {
    locale = next;
    setLocaleSetting(next);
  }

  let glass = $state<Glass>(untrack(() => readGlass()));
  // The shell answers on Windows alone, and Windows 10 offers solid alone, so
  // the row stays away wherever there is nothing to pick.
  let hasMaterial = $derived(hasMaterialChoice(offered));

  onMount(() => {
    void supportedGlass().then((supported) => {
      offered = supported;
      glass = effectiveGlass(glass, supported);
    });
    // Ctrl+= moves the zoom from anywhere, this page included.
    const stopZoom = subscribeZoom((factor) => { zoom = factor; });
    // A face picked in another window restamps this one (`startFonts`); the buttons follow it.
    const followFaces = (event: StorageEvent) => {
      if (event.key === FONT_KEY) font = readFont();
      if (event.key === MONO_KEY) mono = readMono();
      if (event.key === THEME_STORAGE_KEY || event.key === null) theme = readTheme();
    };
    window.addEventListener('storage', followFaces);
    const followTheme = () => { theme = readTheme(); };
    window.addEventListener(COLORS_EVENT, followTheme);
    return () => { stopZoom(); window.removeEventListener('storage', followFaces); window.removeEventListener(COLORS_EVENT, followTheme); };
  });

  function pickMaterial(next: Glass) {
    glass = next;
    setGlass(next);
  }
</script>

<div class="page" data-testid="appearance-page">

  <SettingsSection id="settings-theme" title={strings.settings.display} info="" infoTestid="section-info">
    <!-- Two to four options show every one of them, in place, on a phone as on a desktop: the value in use is the one lit. -->
    <SettingField title={strings.settings.language} field={false}>
      {#snippet control()}
        <div class="segmented" role="group" aria-label={strings.settings.language} data-testid="locale-current">
          <button type="button" class:on={locale === 'system'} aria-pressed={locale === 'system'} data-testid="locale-system" onclick={() => pickLocale('system')}>
            <span class="ui-label">{strings.settings.languageSystem}</span>
          </button>
          {#each LOCALES as id (id)}
            <button type="button" class:on={locale === id} aria-pressed={locale === id} data-testid="locale-{id}" onclick={() => pickLocale(id)}>
              <span class="ui-label">{strings.settings.languageNames[id]}</span>
            </button>
          {/each}
        </div>
      {/snippet}
    </SettingField>
    <!-- Each theme carries a swatch of its own ground, and the row says what the chosen one does. -->
    <SettingField title={strings.settings.theme} hint={strings.settings.themeResult[theme]} field={false}>
      {#snippet control()}
        <div class="segmented" role="group" aria-label={strings.settings.theme} data-testid="theme-current">
          {#each themes as option (option.id)}
            <button
              type="button"
              class:on={theme === option.id}
              aria-pressed={theme === option.id}
              data-testid="theme-{option.id}"
              onclick={() => pickTheme(option.id)}
            >
              <span class="swatch {option.id}" aria-hidden="true"></span><span class="ui-label">{option.label}</span>
            </button>
          {/each}
        </div>
      {/snippet}
    </SettingField>
    <!-- The palettes as their pictures, on a phone too: each in its own colours, the one in use checked. -->
    <ThemeColors />
    {#if !phone}
    <SettingField title={strings.settings.chatWidth} hint={strings.settings.chatWidthResult[chatWidth]} field={false}>
      {#snippet control()}
        <div class="segmented" role="group" aria-label={strings.settings.chatWidth}>
          {#each widths as option (option.id)}
            <button type="button" class:on={chatWidth === option.id} aria-pressed={chatWidth === option.id} data-testid="chat-width-{option.id}" onclick={() => pickChatWidth(option.id)} onpointerenter={() => { pointedWidth = option.id; }} onpointerleave={() => { pointedWidth = null; }} onfocus={() => { pointedWidth = option.id; }} onblur={() => { pointedWidth = null; }}><span class="glyph width {option.id}" aria-hidden="true"><i></i></span><span class="ui-label">{option.label}</span></button>
          {/each}
        </div>
      {/snippet}
    </SettingField>
    <!-- A small window under the row: a question and its reply set at the width in use, or at the one pointed at. -->
    <div class="width-sample" data-testid="chat-width-sample" data-width={sampleWidth} aria-hidden="true">
      <div class="sample-chat"><p class="sample-ask">{strings.settings.chatWidthAsk}</p><p class="sample-reply">{strings.settings.chatWidthSample}</p></div>
    </div>
    {/if}
    {#if hasMaterial}
      <SettingField title={strings.settings.material} hint={strings.settings.materialResult[glass]} field={false}>
        {#snippet control()}
          <div class="segmented" role="group" aria-label={strings.settings.material}>
            {#each materials as option (option.id)}
              <button
                type="button"
                class:on={glass === option.id}
                aria-pressed={glass === option.id}
                data-testid="glass-{option.id}"
                onclick={() => pickMaterial(option.id)}
              >
                <span class="glyph material {option.id}" aria-hidden="true"><i></i></span><span class="ui-label">{option.label}</span>
              </button>
            {/each}
          </div>
        {/snippet}
      </SettingField>
    {/if}
    <!-- The scene behind the empty new thread screen, offered while its experiment is on (lib/backdrop-entry.svelte.ts). -->
    {#if experimentOn('draft-backdrop') && backdropEntry.feature}{@const BackdropPicker = backdropEntry.feature.BackdropPicker}<BackdropPicker />{/if}
    <SettingField id="settings-whip" title={strings.features.whip.title} hint={strings.features.whip.hint}>
      {#snippet control(attributes)}
        <SettingSwitch {...attributes} data-testid="setting-whip" checked={featureOn('whip')}
          onchange={(event) => setFeature('whip', event.currentTarget.checked)} />
      {/snippet}
    </SettingField>
  </SettingsSection>

  <SettingsSection id="settings-reading" title={strings.settings.reading} info="" infoTestid="section-info">
    <!-- Each face's name is drawn in that face in its list, and a line under the row shows the one in use
         at the size it is read at: a reply's for the text, a code block's for the code. -->
    <SettingField title={strings.settings.font} help={strings.settings.fontHint} field={false} class={phone ? 'choice-row sampled value' : 'choice-row sampled'}>
      {#snippet control()}
        <ChoiceSelect label={strings.settings.font} options={faces} value={font} onpick={pickFont} face={(id) => `var(--face-${id})`} testid="font-current" optionTestid={(id) => `font-${id}`} row={phone} />
      {/snippet}
      <span class="sample prose" style:font-family="var(--face-{font})" data-testid="font-sample" aria-hidden="true">{strings.settings.fontSample}</span>
    </SettingField>
    <SettingField title={strings.settings.monoFont} field={false} class={phone ? 'choice-row sampled value' : 'choice-row sampled'}>
      {#snippet control()}
        <ChoiceSelect label={strings.settings.monoFont} options={monos} value={mono} onpick={pickMono} face={(id) => `var(--face-mono-${id})`} testid="font-mono-current" optionTestid={(id) => `font-mono-${id}`} row={phone} />
      {/snippet}
      <span class="sample code" style:font-family="var(--face-mono-{mono})" data-testid="font-mono-sample" aria-hidden="true">{strings.settings.monoSample}</span>
    </SettingField>
    {#if zoomable}
      <SettingField title={strings.settings.zoom} help={strings.settings.zoomHint} error={zoomError || undefined} errorTestid="zoom-error" field={false}>
        {#snippet control({ id, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy })}
          <div {id} class="segmented zoom" role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>
            <button type="button" aria-label={strings.settings.zoomOut} title={strings.settings.zoomOut} disabled={zoom <= smallest} data-testid="zoom-out" onclick={() => zoomTo(stepZoom(wantedZoom(), -1))}><Minus size={14} strokeWidth={2} /></button>
            <button type="button" class="zoom-value" title={strings.settings.zoomReset} aria-label={strings.settings.zoomReset} data-testid="zoom-reset" onclick={() => zoomTo(ZOOM_DEFAULT)}><span class="ui-label">{percent(zoom * 100)}</span></button>
            <button type="button" aria-label={strings.settings.zoomIn} title={strings.settings.zoomIn} disabled={zoom >= largest} data-testid="zoom-in" onclick={() => zoomTo(stepZoom(wantedZoom(), 1))}><Plus size={14} strokeWidth={2} /></button>
          </div>
        {/snippet}
      </SettingField>
    {/if}
  </SettingsSection>

  {#if !phone}
  <!-- Every optional button in one place, grouped by where it sits: the presets,
       then one card a place, titled by it. A button's own right click hides it and
       leads here; this is the only way back. -->
  <div class="settings-stack" id="settings-buttons" data-testid="settings-buttons">
    <SettingsSection title={strings.controls.heading} info={strings.controls.headingHint} infoTestid="section-info">
      <!-- The two presets as a row like the others, the "i" saying what each keeps. -->
      <SettingField title={strings.controls.preset} hint={preset ? strings.controls.presetResult[preset] : undefined} field={false}>
        {#snippet control()}
          <div class="segmented" role="group" aria-label={strings.controls.preset}>
            {#each presets as option (option.id)}
              <button type="button" class:on={preset === option.id} aria-pressed={preset === option.id} data-testid="controls-preset-{option.id}" onclick={() => work.showPreset(option.id)}><span class="glyph buttons" aria-hidden="true">{#each { length: option.id === 'developer' ? 5 : 2 } as _, index (index)}<i></i>{/each}</span><span class="ui-label">{option.label}</span></button>
            {/each}
          </div>
        {/snippet}
      </SettingField>
    </SettingsSection>
    {#each groups as group (group.id)}
      <SettingsSection class="control-group" title={group.label}>
        <!-- One plain row a button, its icon and name as the button wears them, its switch at the row's end. -->
        {#each group.entries as entry (entry.id)}
          <SettingField title={entry.label}>
            {#snippet lead()}
              {#if entry.kind}
                <SurfaceIcon kind={entry.kind} size={15} />
              {:else if entry.icon}
                {@const Icon = entry.icon}
                <Icon size={15} strokeWidth={1.75} />
              {/if}
            {/snippet}
            {#snippet control(attributes)}
              <SettingSwitch {...attributes} checked={work.shows(entry.id)} data-testid="control-{entry.id}" onchange={(event) => work.show(entry.id, event.currentTarget.checked)} />
            {/snippet}
          </SettingField>
        {/each}
      </SettingsSection>
    {/each}
  </div>
  {/if}
</div>

<style>
  /* A theme's own ground in its button, the way the palettes show theirs: dark, light, and both for System. */
  .segmented .swatch { flex: none; width: 12px; height: 12px; border-radius: calc(var(--radius-sm) / 2); box-shadow: inset 0 0 0 1px var(--color-edge); }
  .swatch.dark { background: var(--palette-dark-default-background); }
  .swatch.light { background: var(--palette-light-default-background); }
  .swatch.system { background: linear-gradient(135deg, var(--palette-light-default-background) 50%, var(--palette-dark-default-background) 50%); }
  .swatch.grain { background: linear-gradient(135deg, var(--palette-light-default-frame), var(--palette-dark-default-frame)); }
  .segmented button:has(.swatch, .glyph) { gap: 6px; }
  /* A choice's picture beside its word: the column inside the window for a width,
     the bar's buttons for a preset, drawn in the button's own ink so the lit one reads as lit. */
  .glyph { flex: none; display: inline-flex; align-items: center; width: 20px; height: 13px; padding: 2px; border-radius: calc(var(--radius-sm) / 2); box-shadow: inset 0 0 0 1px currentColor; opacity: 0.85; }
  .glyph.width { justify-content: center; }
  .glyph.width i { height: 100%; border-radius: 1px; background: currentColor; opacity: 0.55; }
  .glyph.width.comfortable i { width: 45%; }
  .glyph.width.wide i { width: 70%; }
  .glyph.width.full i { width: 100%; }
  .glyph.buttons { gap: 1.5px; justify-content: flex-end; }
  /* A material by its look: the desktop blurred through, a wallpaper's tint, one flat fill. */
  .glyph.material i { width: 100%; height: 100%; border-radius: 1px; background: currentColor; }
  .glyph.material.acrylic i { opacity: 0.35; background: radial-gradient(circle at 30% 40%, currentColor 0 22%, transparent 60%), radial-gradient(circle at 75% 65%, currentColor 0 18%, transparent 55%); filter: blur(0.6px); }
  .glyph.material.mica i { opacity: 0.5; background: linear-gradient(135deg, currentColor, transparent); }
  .glyph.material.solid i { opacity: 0.55; }
  /* A face's sample: the whole row's width under its label and choice, at the size it is read at. */
  .page :global(.switch-row.sampled) { flex-wrap: wrap; row-gap: var(--space-1); }
  .sample { flex: 1 0 100%; min-width: 0; color: var(--color-muted-foreground); overflow-wrap: anywhere; }
  .sample.prose { font-size: var(--text-reading); line-height: var(--leading-reading); }
  .sample.code { font-size: var(--text-body); line-height: 1.5; }
  /* The chat width's sample: the window as a well, the paragraph at the column's share of a 1440 px window. */
  /* The conversation in small: the card stands for the window, so each width keeps its proportion to it. */
  .width-sample { margin: 0 0 var(--space-2); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-background); }
  .sample-chat { display: flex; flex-direction: column; gap: var(--space-2); margin: 0 auto; max-width: 50%; transition: max-width var(--dur-3) var(--ease-out-quint); }
  .width-sample[data-width='wide'] .sample-chat { max-width: 72%; }
  .width-sample[data-width='full'] .sample-chat { max-width: 100%; }
  .sample-chat p { margin: 0; font-size: var(--text-meta); line-height: 1.5; }
  .sample-ask { align-self: flex-end; max-width: 85%; padding: 3px 10px; border-radius: var(--radius-md); background: var(--color-surface-3); color: var(--color-foreground); }
  .sample-reply { color: var(--color-muted-foreground); }
  .glyph.buttons i { width: 2.5px; height: 2.5px; border-radius: 50%; background: currentColor; }
  .zoom button { display: inline-flex; align-items: center; justify-content: center; padding: 0 8px; }
  .zoom .zoom-value { min-width: 56px; font-variant-numeric: tabular-nums; color: var(--color-foreground); }
  .page :global(.control-group .switch-row) :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .page :global(.control-group .switch-row .ui-label-box) { gap: var(--space-3); }
  /* Where the column is wide, the button groups pair up: a few short switch rows each, one under the other
     they left the column's right half empty. The presets keep the whole width above them. */
  @media (min-width: 1100px) {
    .page .settings-stack { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: var(--space-4); align-items: start; max-width: var(--settings-width); }
    .page .settings-stack > :global(.card) { margin-bottom: 0; }
    .page .settings-stack > :global(.card):first-child { grid-column: 1 / -1; }
  }
  /* Scoped under the page so it outranks the shared row, which centres its children.
     On a phone a label sits above its choices: side by side, a French label was
     squeezed to one word a line and ran under the three-option control. */
  @media (max-width: 720px) {
    .page :global(.switch-row:has(.segmented)) { flex-direction: column; align-items: stretch; }
    :global(.settings .page) .segmented { display: flex; }
    .page :global(.choice-row:not(.value)) { flex-direction: column; align-items: stretch; gap: var(--space-3); }
    /* Each option grows from its own word: equal thirds cut "Soulignement"
       and "Modifications" past their button's edge. */
    .segmented button { flex: 1 1 auto; min-width: 0; padding: 0 6px; }
    .segmented button .ui-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }
</style>
