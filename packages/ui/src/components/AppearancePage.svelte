<script lang="ts">
  import { errorText } from '../lib/errors';
  import InfoTip from './InfoTip.svelte';
  import { Minus, Plus } from '@lucide/svelte';
  import { onMount, untrack } from 'svelte';
  import { FONT_KEY, FONTS, MONO_KEY, MONOS, readFont, readMono, setFont, setMono, type Font, type Mono } from '../lib/fonts';
  import { percent } from '../lib/format';
  import { currentZoom, inShell, setZoom, stepZoom, subscribeZoom, wantedZoom, ZOOM_DEFAULT, ZOOM_STEPS } from '../lib/zoom';
  import { isExperimentEnabled, subscribeExperiments } from '../lib/experiments';
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

  /**
   * Visual choices only: language, theme, colours, widths, faces, zoom and the
   * buttons shown. What the app does (how a turn's changes show, where a window
   * starts, the terminal's renderer) lives under General, and the terminal's
   * cursor and the edge scrollbars under Advanced. `phone`: what a phone reads
   * and looks like; the column width and the header's buttons are the desktop's.
   * A short choice (language, theme, width) is a segmented control and the
   * palettes are their pictures, every option in sight; only a face, a longer
   * list, is one row in its own face that opens the others (`ChoiceSelect`).
   */
  let { store, phone = false }: { store: Store; phone?: boolean } = $props();
  const uid = $props.id();

  // The owner's buttons (the terminal, Add a project) are not a paired device's to hide.
  let groups = $derived(controlGroups(store.owner));
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

  // Grain rides behind an experiment, so the fourth option comes and goes with
  // the switch on the Experiments page rather than on a reload.
  let grain = $state(untrack(() => isExperimentEnabled('theme-grain')));

  let themes = $derived<{ id: Theme; label: string }[]>([
    { id: 'system', label: strings.settings.themeSystem },
    { id: 'dark', label: strings.settings.themeDark },
    { id: 'light', label: strings.settings.themeLight },
    ...(grain ? [{ id: 'grain' as const, label: strings.settings.themeGrain }] : [])
  ]);

  // `readTheme` answers `system` for a grain that lost its experiment, which is
  // the fallback the segmented control has to show.
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
    const stopExperiments = subscribeExperiments(() => {
      grain = isExperimentEnabled('theme-grain');
      theme = readTheme();
    });
    // A face picked in another window restamps this one (`startFonts`); the buttons follow it.
    const followFaces = (event: StorageEvent) => {
      if (event.key === FONT_KEY) font = readFont();
      if (event.key === MONO_KEY) mono = readMono();
      if (event.key === THEME_STORAGE_KEY || event.key === null) theme = readTheme();
    };
    window.addEventListener('storage', followFaces);
    const followTheme = () => { theme = readTheme(); };
    window.addEventListener(COLORS_EVENT, followTheme);
    return () => { stopZoom(); stopExperiments(); window.removeEventListener('storage', followFaces); window.removeEventListener(COLORS_EVENT, followTheme); };
  });

  function pickMaterial(next: Glass) {
    glass = next;
    setGlass(next);
  }
</script>

<div class="page" data-testid="appearance-page">
  <header>
    <h1>{strings.settings.tabs.appearance}</h1>
  </header>

  <section class="card" id="settings-theme">
    <h2 class="ui-label-box"><span class="ui-label">{strings.settings.display}</span><InfoTip gather topic={strings.settings.display} text="" testid="section-info" /></h2>
    <!-- Two to four options show every one of them, in place, on a phone as on a desktop: the value in use is the one lit. -->
    <div class="switch-row">
      <span class="text ui-label">{strings.settings.language}</span>
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
    </div>
    <div class="switch-row">
      <span class="text ui-label">{strings.settings.theme}</span>
      <div class="segmented" role="group" aria-label={strings.settings.theme} data-testid="theme-current">
        {#each themes as option (option.id)}
          <button
            type="button"
            class:on={theme === option.id}
            aria-pressed={theme === option.id}
            data-testid="theme-{option.id}"
            onclick={() => pickTheme(option.id)}
          >
            <span class="ui-label">{option.label}</span>
          </button>
        {/each}
      </div>
    </div>
    <!-- The palettes as their pictures, on a phone too: each in its own colours, the one in use checked. -->
    <ThemeColors />
    {#if !phone}
    <div class="switch-row">
      <span class="text ui-label">{strings.settings.chatWidth}</span>
      <div class="segmented" role="group" aria-label={strings.settings.chatWidth}>
        {#each widths as option (option.id)}
          <button type="button" class:on={chatWidth === option.id} aria-pressed={chatWidth === option.id} data-testid="chat-width-{option.id}" onclick={() => pickChatWidth(option.id)}><span class="ui-label">{option.label}</span></button>
        {/each}
      </div>
    </div>
    {/if}
    {#if hasMaterial}
      <div class="switch-row">
        <span class="text ui-label">
          {strings.settings.material}
        </span>
        <div class="segmented" role="group" aria-label={strings.settings.material}>
          {#each materials as option (option.id)}
            <button
              type="button"
              class:on={glass === option.id}
              aria-pressed={glass === option.id}
              data-testid="glass-{option.id}"
              onclick={() => pickMaterial(option.id)}
            >
              <span class="ui-label">{option.label}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </section>

  <section class="card" id="settings-reading">
    <h2 class="ui-label-box"><span class="ui-label">{strings.settings.reading}</span><InfoTip gather topic={strings.settings.reading} text="" testid="section-info" /></h2>
    <!-- Each face's name is drawn in that face: the name is the sample. -->
    <div class="switch-row choice-row" class:value={phone}>
      <span class="text ui-label-box"><span class="ui-label">{strings.settings.font}</span><InfoTip topic={strings.settings.font} text={strings.settings.fontHint} /></span>
      <ChoiceSelect label={strings.settings.font} options={faces} value={font} onpick={pickFont} face={(id) => `var(--face-${id})`} testid="font-current" optionTestid={(id) => `font-${id}`} row={phone} />
    </div>
    <div class="switch-row choice-row" class:value={phone}>
      <span class="text ui-label">{strings.settings.monoFont}</span>
      <ChoiceSelect label={strings.settings.monoFont} options={monos} value={mono} onpick={pickMono} face={(id) => `var(--face-mono-${id})`} testid="font-mono-current" optionTestid={(id) => `font-mono-${id}`} row={phone} />
    </div>
    {#if zoomable}
      <div class="switch-row">
        <span class="text ui-label-box"><span class="ui-label">{strings.settings.zoom}</span><InfoTip topic={strings.settings.zoom} text={strings.settings.zoomHint} /></span>
        <div class="segmented zoom" role="group" aria-label={strings.settings.zoom}>
          <button type="button" aria-label={strings.settings.zoomOut} title={strings.settings.zoomOut} disabled={zoom <= smallest} data-testid="zoom-out" onclick={() => zoomTo(stepZoom(wantedZoom(), -1))}><Minus size={14} strokeWidth={2} /></button>
          <button type="button" class="zoom-value" title={strings.settings.zoomReset} aria-label={strings.settings.zoomReset} data-testid="zoom-reset" onclick={() => zoomTo(ZOOM_DEFAULT)}><span class="ui-label">{percent(zoom * 100)}</span></button>
          <button type="button" aria-label={strings.settings.zoomIn} title={strings.settings.zoomIn} disabled={zoom >= largest} data-testid="zoom-in" onclick={() => zoomTo(stepZoom(wantedZoom(), 1))}><Plus size={14} strokeWidth={2} /></button>
        </div>
      </div>
      {#if zoomError}<p class="zoom-error" role="alert" data-testid="zoom-error">{zoomError}</p>{/if}
    {/if}
  </section>

  {#if !phone}
  <!-- Every optional button in one place, grouped by where it sits: the presets,
       then one card a place, titled by it. A button's own right click hides it and
       leads here; this is the only way back. -->
  <div class="settings-stack" id="settings-buttons" data-testid="settings-buttons">
    <section class="card">
      <h2 class="ui-label-box"><span class="ui-label">{strings.controls.heading}</span><InfoTip gather topic={strings.controls.heading} text={strings.controls.headingHint} testid="section-info" /></h2>
      <!-- The two presets as a row like the others, the "i" saying what each keeps. -->
      <div class="switch-row">
        <span class="text ui-label">{strings.controls.preset}</span>
        <div class="segmented" role="group" aria-label={strings.controls.preset}>
          {#each presets as option (option.id)}
            <button type="button" class:on={preset === option.id} aria-pressed={preset === option.id} data-testid="controls-preset-{option.id}" onclick={() => work.showPreset(option.id)}><span class="ui-label">{option.label}</span></button>
          {/each}
        </div>
      </div>
    </section>
    {#each groups as group (group.id)}
      <section class="card control-group" role="group" aria-labelledby="{uid}-{group.id}">
        <h2 id="{uid}-{group.id}"><span class="ui-label">{group.label}</span></h2>
        <!-- One plain row a button, its icon and name as the button wears them, its switch at the row's end. -->
        {#each group.entries as entry (entry.id)}
          <label class="switch-row">
            <span class="text ui-label-box">
              {#if entry.kind}
                <SurfaceIcon kind={entry.kind} size={15} />
              {:else if entry.icon}
                {@const Icon = entry.icon}
                <Icon size={15} strokeWidth={1.75} />
              {/if}
              <span class="ui-label">{entry.label}</span>
            </span>
            <input type="checkbox" role="switch" checked={work.shows(entry.id)} data-testid="control-{entry.id}" onchange={(event) => work.show(entry.id, event.currentTarget.checked)} />
          </label>
        {/each}
      </section>
    {/each}
  </div>
  {/if}
</div>

<style>
  .zoom button { display: inline-flex; align-items: center; justify-content: center; padding: 0 8px; }
  .zoom-error { margin: 0; color: var(--color-danger); font-size: var(--text-xs); overflow-wrap: anywhere; }
  .zoom .zoom-value { min-width: 56px; font-variant-numeric: tabular-nums; color: var(--color-foreground); }
  .control-group .switch-row :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .control-group .switch-row .ui-label-box { gap: var(--space-3); }
  /* Scoped under the page so it outranks the shared row, which centres its children.
     On a phone a label sits above its choices: side by side, a French label was
     squeezed to one word a line and ran under the three-option control. */
  @media (max-width: 720px) {
    :global(.settings .page) .switch-row:has(.segmented) { flex-direction: column; align-items: stretch; }
    :global(.settings .page) .segmented { display: flex; }
    :global(.settings .page) .choice-row:not(.value) { flex-direction: column; align-items: stretch; gap: var(--space-3); }
    /* Each option grows from its own word: equal thirds cut "Soulignement"
       and "Modifications" past their button's edge. */
    .segmented button { flex: 1 1 auto; min-width: 0; padding: 0 6px; }
    .segmented button .ui-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }
</style>
