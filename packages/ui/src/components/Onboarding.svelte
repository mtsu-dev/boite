<script lang="ts">
  import { desktopShell } from '../lib/shell-platform';
  import { lockedBy } from '../lib/policy';
  import { onMount, tick, untrack } from 'svelte';
  import { AppWindow, Bell, Check, Languages, MessageCircle, Minimize2, Palette, SquareTerminal, VolumeX, X } from '@lucide/svelte';
  import type { SpeechStatus } from '@boite/contracts';
  import TelemetryDeal from './TelemetryDeal.svelte';
  import OnboardingScene from './OnboardingScene.svelte';
  import BoiteMark from './BoiteMark.svelte';
  import { Closing } from '../lib/closing.svelte';
  import { focusedElement, restoreFocus } from '../lib/focus';
  import { mobileOverlay } from '../lib/mobile-history';
  import { fill, LOCALES, localeSetting, setLocaleSetting, strings, type LocaleSetting } from '../lib/i18n.svelte';
  import { onPhone, steps, type OnboardingStep } from '../lib/onboarding';
  import { closeTour } from '../lib/onboarding.svelte';
  import { readTheme, setTheme, type Theme } from '../lib/theme';
  import { work, type Profile } from '../lib/work-prefs.svelte';
  import type { Store } from '../lib/store.svelte';
  import { toggled } from '../lib/autosave.svelte';

  let { store }: { store: Store } = $props();
  const inShell = desktopShell();
  /** Focus guard and Mute agents act only on a Windows machine: elsewhere they say so and stay put. */
  const offWindows = $derived(!!store.core && store.core.os !== 'windows');
  /** Read once, as the tour opens: a window resized halfway keeps the screens it started with. */
  const phone = onPhone();
  const screens = $derived(steps(store.owner, phone));
  let index = $state(0);
  $effect(() => { if (index >= screens.length) index = screens.length - 1; });
  const step = $derived<OnboardingStep>(screens[index] ?? 'welcome');
  const last = $derived(index === screens.length - 1);
  let panel = $state<HTMLDivElement>();
  let example = $state<'agents' | 'voice' | 'panel'>('agents');
  let locale = $state<LocaleSetting>(localeSetting());
  let theme = $state<Theme>(readTheme());
  const themes = $derived([{ id: 'system', label: strings.settings.themeSystem }, { id: 'dark', label: strings.settings.themeDark }, { id: 'light', label: strings.settings.themeLight }] as const);
  /** One demo in three parts that play in a row: segments under the scene, not answers to pick from. */
  const examples = $derived([{ id: 'agents', label: strings.onboarding.demo.conversation }, { id: 'voice', label: strings.onboarding.demo.voice }, { id: 'panel', label: strings.onboarding.demo.panel }] as const);
  function exampleLead(id: typeof example): string { return id === 'voice' ? strings.onboarding.voice.body : id === 'panel' ? strings.onboarding.panel.body : strings.onboarding.agents.body; }
  /** The next part, the first after the last. A dictation download in progress holds the demo on its part. */
  function nextExample() { const at = examples.findIndex(item => item.id === example); example = examples[(at + 1) % examples.length]!.id; }
  const profiles = $derived([
    { id: 'everyday', label: strings.onboarding.profile.everyday, hint: strings.onboarding.profile.everydayHint },
    { id: 'developer', label: strings.onboarding.profile.developer, hint: strings.onboarding.profile.developerHint }
  ] as const);
  /** Picking writes the preset at once: skipping the rest of the tour keeps the answer. */
  function pickProfile(profile: Profile) { store.applyProfile(profile); }
  const overlay = new Closing();
  overlay.show();
  $effect(() => { if (!overlay.shown) closeTour(); });
  /** What had the keyboard when the tour opened; the composer when that was nothing. */
  const previous = focusedElement();
  onMount(() => panel?.focus({ preventScroll: true }));
  function finish() { overlay.hide(); restoreFocus(previous); }
  $effect(() => { if (overlay.open) return mobileOverlay(finish); });
  function go(next: number) {
    index = Math.min(screens.length - 1, Math.max(0, next));
    void tick().then(() => {
      panel?.querySelector('.screen')?.scrollTo?.(0, 0);
      panel?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    });
  }
  function onkeydown(event: KeyboardEvent) {
    if (!overlay.open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); return; }
    if (event.key !== 'Tab' || !panel) return;
    const stops = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
    const first = stops[0], end = stops.at(-1), active = document.activeElement;
    if (!first || !end) return;
    if (event.shiftKey ? panel.contains(active) && active !== first && active !== panel && active?.tagName !== 'H1' : panel.contains(active) && active !== end) return;
    event.preventDefault(); (event.shiftKey ? end : first).focus({ preventScroll: true });
  }
  let tray = $state(false), trayReady = $state(false), trayBusy = $state(false);
  let error = $state('');
  async function readTray() {
    if (!inShell) return;
    try { const { invoke } = await import('@tauri-apps/api/core'); tray = await invoke<boolean>('close_behavior', {}); trayReady = true; }
    catch (cause) { error = String(cause); }
  }
  async function setTray(enabled: boolean) {
    trayBusy = true; error = '';
    try { const { invoke } = await import('@tauri-apps/api/core'); tray = await invoke<boolean>('close_behavior', { enabled }); }
    catch (cause) { error = String(cause); }
    finally { trayBusy = false; }
  }
  let speech = $state<SpeechStatus | null>(null), speechBusy = $state(false), speechError = $state(''), speechPollError = $state('');
  /** Focus inside the dictation row: moving on would remove the control under the keyboard. */
  let voiceFocus = $state(false);
  const holdExample = $derived(example === 'voice' && (!!speech?.installing || speechBusy || voiceFocus));
  $effect(() => {
    const client = store.client;
    if (step !== 'agents' || example !== 'voice' || !client || !store.owner) return;
    let active = true;
    speech = null;
    speechPollError = '';
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try { const value = await client.call('speech.status', {}); if (active) { speech = value; speechPollError = ''; } }
      catch (cause) { if (active) speechPollError = String(cause); }
      if (active) timer = setTimeout(() => void read(), 1500);
    };
    void read();
    return () => { active = false; clearTimeout(timer); };
  });
  async function setupVoice(cancel = false) {
    const client = store.client;
    if (!client || !store.owner) return;
    speechBusy = true; speechError = '';
    try {
      if (!cancel) {
        const config = await client.call('speech.config', {});
        if (store.client !== client || !store.owner) return;
        await client.call('speech.configure', { ...config, engine: 'local' });
      }
      if (store.client !== client || !store.owner) return;
      const value = await client.call(cancel ? 'speech.installCancel' : 'speech.install', {});
      if (store.client === client) speech = value;
    } catch (cause) { if (store.client === client) speechError = String(cause); }
    finally { speechBusy = false; }
  }
  $effect(() => { if (step === 'quiet') untrack(() => void readTray()); });
</script>

<svelte:window onkeydowncapture={onkeydown} />
{#if overlay.shown}
  <div class="scrim" class:shell={inShell} class:closing={overlay.closing} role="presentation" data-testid="onboarding">
    <div class="panel" class:privacy={step === 'privacy'} class:closing={overlay.closing} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" tabindex="-1" bind:this={panel} use:overlay.attach onanimationend={overlay.end}>
      <header><BoiteMark size={18} /><span class="ui-label">{strings.onboarding.label}</span><button class="ghost icon" data-testid="onboarding-skip" aria-label={strings.onboarding.skip} onclick={finish}><X size={16} /></button></header>
      {#key step}
        <div class="screen" data-testid="onboarding-step" data-step={step}>
          {#snippet title()}<h1 id="onboarding-title" tabindex="-1" class:soul={step === 'privacy'}>{phone && step === 'reach' ? strings.onboarding.reach.onPhoneTitle : strings.onboarding[step].title}</h1>{/snippet}
          <!-- The consent screen sets its title beside the meme, above the offer it names. -->
          {#if step !== 'privacy'}{@render title()}{/if}
          {#if step === 'welcome'}
            <p class="lead">{strings.onboarding.welcome.body}</p>
            <OnboardingScene scene="welcome" />
            <div class="preferences">
              <div class="preference"><Languages size={17} /><span class="ui-label">{strings.settings.language}</span><div class="segmented" role="group" aria-label={strings.settings.language}>
                <button class:on={locale === 'system'} aria-pressed={locale === 'system'} data-testid="onboarding-locale-system" onclick={() => { locale = 'system'; setLocaleSetting(locale); }}><span class="ui-label">{strings.settings.languageSystem}</span></button>
                {#each LOCALES as id (id)}<button class:on={locale === id} aria-pressed={locale === id} data-testid="onboarding-locale-{id}" onclick={() => { locale = id; setLocaleSetting(id); }}><span class="ui-label">{strings.settings.languageNames[id]}</span></button>{/each}
              </div></div>
              <div class="preference"><Palette size={17} /><span class="ui-label">{strings.settings.theme}</span><div class="segmented" role="group" aria-label={strings.settings.theme}>
                {#each themes as option (option.id)}<button class:on={theme === option.id} aria-pressed={theme === option.id} data-testid="onboarding-theme-{option.id}" onclick={() => { theme = option.id; setTheme(theme); }}><span class="ui-label">{option.label}</span></button>{/each}
              </div></div>
            </div>
          {:else if step === 'profile'}
            <div class="profiles" role="group" aria-labelledby="onboarding-title">
              {#each profiles as item (item.id)}
                <button class:on={work.current.profile === item.id} aria-pressed={work.current.profile === item.id} data-testid="onboarding-profile-{item.id}" onclick={() => pickProfile(item.id)}>
                  {#if item.id === 'everyday'}<MessageCircle size={20} />{:else}<SquareTerminal size={20} />{/if}
                  <span class="answer"><strong>{item.label}</strong><span>{item.hint}</span></span>
                  {#if work.current.profile === item.id}<Check size={13} class="selected-mark" />{/if}
                </button>
              {/each}
            </div>
            <p class="detail">{strings.onboarding.profile.later}</p>
          {:else if step === 'agents'}
            <!-- Every part's sentence sits in one cell, the others unseen, so the longest sets the height and the scene under it never moves. -->
            <p class="lead chapter-lead">{#each examples as item (item.id)}<span class:current={item.id === example} aria-hidden={item.id !== example} data-testid={item.id === example ? 'onboarding-example-lead' : undefined}>{exampleLead(item.id)}</span>{/each}</p>
            {#snippet voiceSetup()}
              <div class="voice-setup" onfocusin={() => { voiceFocus = true; }} onfocusout={event => { voiceFocus = event.currentTarget.contains(event.relatedTarget as Node | null); }}>
                {#if speech?.ready}<p data-testid="onboarding-voice-ready">{strings.onboarding.demo.readyVoice}</p>
                {:else if speech?.installing}
                  <label>{strings.onboarding.demo.installingVoice}<progress max={speech.totalBytes || 1} value={speech.downloadedBytes}></progress></label>
                  <button disabled={speechBusy} onclick={() => void setupVoice(true)}><span class="ui-label">{strings.onboarding.demo.cancelVoice}</span></button>
                {:else if speech?.canInstallRuntime}
                  <span class="ui-label">{strings.onboarding.demo.downloadVoice}</span><button data-testid="onboarding-voice-install" disabled={speechBusy || (lockedBy(store.policy, 'dictation') !== null && store.policy?.values.dictation === 'off')} onclick={() => void setupVoice()}><span class="ui-label">{strings.onboarding.demo.installVoice}</span></button>
                {:else}<p>{speech ? strings.onboarding.changeLater : strings.onboarding.voice.reading}</p>{/if}
                {#if speechError || speechPollError || speech?.error}<p role="alert">{speechError || speechPollError || speech?.error}</p>{/if}
              </div>
            {/snippet}
            <OnboardingScene scene={example} chapters={examples} onend={holdExample ? undefined : nextExample} onpick={id => { if (id === 'agents' || id === 'voice' || id === 'panel') { example = id; voiceFocus = false; } }} extra={example === 'voice' && store.owner ? voiceSetup : undefined} />
          {:else if step === 'usage'}
            <p class="lead">{strings.onboarding.usage.body}</p>
            <OnboardingScene scene="usage" />
          {:else if step === 'reach'}
            <p class="lead">{phone ? strings.onboarding.reach.onPhoneBody : strings.onboarding.demo.reachHint}</p>
            <OnboardingScene scene="reach" />
            <p class="detail">{phone ? strings.onboarding.reach.onPhoneSettings : strings.onboarding.reach.machinesBody}</p>
          {:else if step === 'quiet'}
            <p class="lead">{strings.onboarding.demo.quietBody}</p>
            <div class="quiet-scene"><OnboardingScene scene="quiet" /></div>
            <div class="rows">
              <label class="row"><Bell size={18} /><span class="ui-label">{strings.settings.notifications}</span><input type="checkbox" role="switch" data-testid="onboarding-notifications" checked={store.notifications} onchange={event => void store.setNotifications(event.currentTarget.checked)} /></label>
              {#if inShell}<label class="row"><Minimize2 size={18} /><span class="ui-label">{strings.settings.closeToTray}</span><input type="checkbox" role="switch" data-testid="onboarding-tray" checked={tray} disabled={!trayReady || trayBusy} onchange={event => void setTray(event.currentTarget.checked)} /></label>{/if}
              {#if store.owner}
                <label class="row"><AppWindow size={18} /><span><span class="ui-label">{strings.settings.focusGuard}</span>{#if offWindows}<span class="why">{strings.protection.windowsOnly}</span>{/if}</span><input type="checkbox" role="switch" data-testid="onboarding-focus-guard" checked={store.settings?.focusGuard ?? true} disabled={offWindows} onchange={event => void toggled(event.currentTarget, focusGuard => store.saveSettings({ focusGuard }))} /></label>
                <label class="row"><VolumeX size={18} /><span><span class="ui-label">{strings.settings.muteAgents}</span>{#if offWindows}<span class="why">{strings.protection.windowsOnly}</span>{/if}</span><input type="checkbox" role="switch" data-testid="onboarding-mute" checked={store.settings?.muteAgents ?? true} disabled={offWindows} onchange={event => void toggled(event.currentTarget, muteAgents => store.saveSettings({ muteAgents }))} /></label>
              {/if}
            </div>
            {#if error}<p role="alert">{error}</p>{/if}
          {:else if step === 'privacy'}
            <TelemetryDeal {store} onchosen={finish} heading={title} />
          {/if}
        </div>
      {/key}
      <footer>
        <div class="dots" role="group" aria-label={strings.onboarding.label}>
          {#each screens as id, position (id)}<button class="dot" class:on={position === index} aria-current={position === index ? 'step' : undefined} aria-label={fill(strings.onboarding.progress, { index: String(position + 1), title: phone && id === 'reach' ? strings.onboarding.reach.onPhoneTitle : strings.onboarding[id].title })} data-testid="onboarding-dot-{id}" onclick={() => go(position)}></button>{/each}
        </div>
        <button class="ghost" disabled={index === 0} data-testid="onboarding-back" onclick={() => go(index - 1)}><span class="ui-label">{strings.onboarding.back}</span></button>
        <!-- The consent rows are the privacy screen's way out. -->
        {#if step !== 'privacy'}<button class="primary" data-testid="onboarding-next" onclick={() => last ? finish() : go(index + 1)}><span class="ui-label">{last ? strings.onboarding.done : strings.onboarding.next}</span></button>{/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  /*
   * No backdrop blur here: the tour animates for as long as it is open, and a
   * window-wide blur under a moving panel is redrawn on every frame. Measured
   * in software compositing on 2026-09-30: 9 to 13 fps with it, 50 to 60 without.
   */
  .scrim { position: fixed; inset: 0; z-index: 55; display: grid; place-items: center; padding: 16px; background: var(--color-scrim); animation: fade var(--dur-2) var(--ease-out-quint); }
  .scrim.closing { animation-name: fade-out; pointer-events: none; }
  /* The title bar stays above the tour: the window can still be moved, minimized or closed. */
  .scrim.shell { top: var(--titlebar); }
  /* In the shell the scrim starts under the title bar, so the panel's room is that much shorter. */
  .scrim.shell .panel { height: min(600px, calc(100dvh - 32px - var(--titlebar))); }
  /*
   * One height for every step, so Next stays under the pointer from one screen to the next.
   * Every screen fits it in both languages; only a window shorter than the panel scrolls.
   */
  .panel { display: flex; flex-direction: column; width: min(600px, 100%); height: min(600px, calc(100dvh - 32px)); background: var(--overlay-surface); border: 1px solid var(--overlay-edge); border-radius: var(--radius-overlay); box-shadow: var(--shadow-overlay); animation: pop var(--dur-3) var(--ease-out-quint); }
  .panel.privacy { width: min(680px, 100%); }
  .panel:focus, h1:focus { outline: none; }
  .panel.closing { animation: pop-out var(--dur-2) var(--ease-out-quint); }
  header { display: flex; align-items: center; gap: 8px; padding: 8px 16px; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  header button { margin-left: auto; }
  .screen { flex: 1; overflow-y: auto; min-height: 0; padding: 8px 28px 16px; }
  .screen[data-step=privacy] { display: flex; flex-direction: column; }
  h1 { font-size: var(--text-lg); line-height: 1.35; margin: 0 0 6px; }
  h1.soul { margin: 0; font-size: calc(var(--text-lg) * 1.3); font-weight: 900; line-height: 1.15; letter-spacing: .06em; text-wrap: balance; animation: soul 10s linear forwards; }
  @keyframes soul {
    from { color: var(--color-foreground); text-shadow: 0 0 0 transparent; }
    40% { color: color-mix(in srgb, var(--color-danger) 65%, var(--color-foreground)); text-shadow: 0 0 6px color-mix(in srgb, var(--color-danger) 20%, transparent); }
    to { color: var(--color-danger); text-shadow: 0 0 18px color-mix(in srgb, var(--color-danger) 60%, transparent); }
  }
  p { margin: 0; }
  .lead, .detail { color: var(--color-muted-foreground); font-size: var(--text-base); line-height: 1.6; }
  .detail { margin-top: 6px; }
  .preferences { display: grid; gap: 12px; }
  .preference { display: flex; align-items: center; gap: 10px; }
  .preference > span { margin-right: auto; }
  /* The shared track (app.css), as wide as its row. */
  .segmented { display: flex; }
  .chapter-lead { display: grid; }
  .chapter-lead > span { grid-area: 1 / 1; visibility: hidden; }
  .chapter-lead > span.current { visibility: visible; animation: lead var(--dur-3) var(--ease-out-quint); }
  @keyframes lead { from { opacity: 0; transform: translateY(3px); } }
  .profiles { display: grid; gap: 8px; margin: 12px 0; }
  .profiles button { position: relative; display: flex; align-items: flex-start; gap: 14px; height: auto; padding: 16px 36px 16px 16px; white-space: normal; text-align: left; border: 1px solid var(--color-edge); border-radius: var(--radius-lg); background: var(--color-surface-2); color: var(--color-muted-foreground); cursor: pointer; }
  .profiles button :global(svg) { flex: none; margin-top: 2px; }
  .profiles button:hover { color: var(--color-foreground); background: var(--color-hover); border-color: var(--color-muted-foreground); }
  .profiles button.on { border-color: var(--color-muted-foreground); background: var(--color-active); color: var(--color-foreground); }
  .profiles :global(.selected-mark) { position: absolute; top: 10px; right: 10px; color: var(--color-foreground); }
  .answer { display: grid; gap: 4px; }
  .answer strong { font-size: var(--text-base); font-weight: 600; line-height: 1.4; color: var(--color-foreground); }
  .answer span { font-size: var(--text-sm); line-height: 1.5; }
  .voice-setup { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  .voice-setup progress { display: block; width: 100%; margin-top: 6px; accent-color: var(--color-accent); }
  .quiet-scene { margin: auto; }
  .rows { display: grid; }
  .row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--color-border); }
  .row > span { flex: 1; font-size: var(--text-base); }
  .row :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .why { display: block; font-size: var(--text-sm); color: var(--color-muted-foreground); }
  input[type=checkbox] { appearance: none; position: relative; flex: 0 0 36px; width: 36px; height: 22px; margin: 0; border: 1px solid var(--color-edge); border-radius: 999px; background: var(--color-surface-3); cursor: pointer; }
  input::after { content: ''; position: absolute; width: 14px; height: 14px; top: 3px; left: 3px; border-radius: 50%; background: var(--color-muted-foreground); transition: transform var(--dur-2) var(--ease-out-quint); }
  input:checked { background: var(--color-foreground); } input:checked::after { background: var(--color-background); transform: translateX(14px); }
  [role=alert] { color: var(--color-danger); overflow-wrap: anywhere; }
  footer { display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-top: 1px solid var(--color-border); }
  .dots { display: flex; margin-right: auto; }
  .dot { position: relative; width: 26px; height: 32px; padding: 0; border: 0; background: transparent; }
  .dot::after { content: ''; position: absolute; width: 6px; height: 6px; left: 10px; top: 13px; border-radius: 999px; background: var(--color-edge); }
  .dot.on::after { background: var(--color-foreground); width: 14px; left: 6px; }
  @media (max-width: 480px) {
    .panel { height: min(640px, calc(100dvh - 32px)); border: 1px solid var(--overlay-edge); background: var(--overlay-surface); box-shadow: var(--shadow-overlay); border-radius: var(--radius-overlay); }
    .scrim.shell .panel { height: min(640px, calc(100dvh - 32px - var(--titlebar))); }
    /* The last step has three consent choices, so use the phone's available height. */
    .panel.privacy { height: calc(100dvh - 32px); }
    .scrim.shell .panel.privacy { height: calc(100dvh - 32px - var(--titlebar)); }
    .screen { padding: 8px 18px 18px; } .preference { flex-wrap: wrap; } .segmented { flex-basis: 100%; } .segmented button { flex: 1; }
    footer { padding: 12px; gap: 4px; } .dot { width: 20px; } .dot::after { left: 7px; } .dot.on::after { left: 3px; } .dot { height: var(--touch-target); } .dot::after { top: 19px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .scrim, .panel { animation: none; }
    h1.soul { animation: none; color: var(--color-danger); }
    /* Keep animationend so closing also persists the completed tour. */
    .scrim.closing, .panel.closing { animation-duration: 1ms; }
  }
</style>
