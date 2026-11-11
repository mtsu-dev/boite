<script lang="ts">
  import { ArrowUp, LoaderCircle, Mic, MicOff, Square } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { effectiveCompaction, type PermissionMode, type ProviderSummary } from '@boite/contracts';
  import { formatTokens, providerName } from '../lib/format';
  import { confirm } from '../lib/confirm.svelte';
  import { switchDropsHistory, switchResetsCache, type CacheKey } from '../lib/switch-warning';
  import { modeHint, modeIcon, modeLabel, modesFor, modeWord, shownMode } from '../lib/permission-modes';
  import { fill, strings } from '../lib/strings';
  import type { Choice, PickPatch, Store } from '../lib/store.svelte';
  import ModelPicker from './ModelPicker.svelte';
  import EffortSlider from './EffortSlider.svelte';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/deferred-parts';
  import ComposerOptions from './ComposerOptions.svelte';
  import PermissionChip, { type ModeChoice } from './PermissionChip.svelte';
  import ContextControl from './ContextControl.svelte';
  import { work } from '../lib/work-prefs.svelte';
  import { voice, VOICE_STORAGE_KEY } from '../lib/voice-prefs.svelte';
  import { controlMenu } from '../lib/controls';
  import { keepFocus } from '../lib/focus';
  import { contextLevel, contextPercent } from '../lib/tokens';
  import { speedControl } from '../lib/model-speeds';
  import type { ComposerTarget } from '../lib/composer-target';
  import { desktopSettings } from '../lib/settings-tabs';
  import { machineAway } from '../lib/machine-away';
  /** The context's reading shows in the row from this percent used. */
  const CONTEXT_SHOWN_FROM = 70;

  /**
   * The row under the composer's box, the same in every state: one "+" for
   * what adds to the message, then a chip per setting reading its word at
   * rest: the model, the effort (a slider, the bolt while fast is on) and the
   * permission (an icon and a word), the same three on a thread, a bot and a
   * phone, the context's ring and "x% context left" once it matters, then dictation and one round
   * button that is Send, or Stop while a turn runs and nothing typed waits to go
   * (not while it stands on a decision of the owner's). While the field
   * answers a question the button is Send alone, live once text is typed: the
   * card's Answer sends its picks, and the turn's Stop waits in the foot's line.
   * Nothing comes or goes with a decision docked above: the row keeps its
   * place and its controls. A pick on a thread is saved at once, after the
   * switch warnings; on a draft the whole choice is remembered. `choice`,
   * `picking` and `dictating` are the composer's, bound here. An agent's box
   * (`target`) keeps stop, attach, dictation and send; its model chips save
   * the agent's own setting, and a group's box shows its recipients in their place.
   */
  let {
    store,
    key,
    target = null,
    bot = null,
    botGone = false,
    provider,
    canSend,
    waiting = false,
    answering = false,
    typed = true,
    sendLabel = strings.composer.send,
    choice = $bindable(),
    picking = $bindable(),
    dictating = $bindable(),
    onsubmit,
    onfiles,
    onpreview,
    ontranscript,
    onmention,
    oncommand
  }: {
    store: Store;
    /** The open thread's id, or the draft's stash key. */
    key: string;
    target?: ComposerTarget | null;
    /** The persistent agent this box writes to, by name: its model, effort and mode are its settings, so its chip only names the model. */
    bot?: string | null;
    /** The bot's account is gone: the chips name the banner's remedy instead of its settings. */
    botGone?: boolean;
    provider: ProviderSummary | null | undefined;
    canSend: boolean;
    /** Send was pressed while files were still being read: it goes once they are ready. */
    waiting?: boolean;
    answering?: boolean;
    /** Text or files are in the box. False while only a question's picks make it sendable: Send rests and the card sends them. */
    typed?: boolean;
    /** What Send does, when it answers a question rather than sending a message. */
    sendLabel?: string;
    choice: Choice | null;
    picking: boolean;
    dictating: boolean;
    onsubmit: () => void;
    onfiles: (files: File[]) => void;
    onpreview: (text: string, status: string, error: boolean) => void;
    ontranscript: (transcript: string) => void;
    /** Starts a file mention or a command in the box; absent where the box has neither. */
    onmention?: () => void;
    oncommand?: () => void;
  } = $props();
  let chip = $state<ModelPicker | undefined>(undefined);
  let options = $state<ComposerOptions | undefined>(undefined);
  let slider = $state<EffortSlider | undefined>(undefined);
  let stopping = $derived(!!(target ? target.busy && target.stop : store.busy));
  /** The turn stands still on the owner's answer (a permission, a question it stopped for): Deny or Skip is the way out, Escape still stops. */
  let held = $derived(!target && store.openThread?.status === 'waiting');
  /** One round button at the row's end: Stop while a turn runs and nothing typed waits to go, Send otherwise. */
  /** Nothing reaches a machine out of reach: no Stop, and Send queues what is written for its return. */
  let stopShown = $derived(stopping && !held && !answering && !waiting && !(canSend && typed) && (!!target || !machineAway(store)));

  let picker = $state<HTMLInputElement | undefined>(undefined);
  let bar = $state<HTMLDivElement | undefined>(undefined);

  let bound = $derived(!target && store.openThread !== null);
  let contextUsed = $derived(store.openThread?.context ? contextPercent(store.openThread.context, store.settings ? effectiveCompaction(store.settings, store.openThread).autoCompact : null) : null);
  /**
   * The reading only once the context matters (a nearly full one whatever the
   * preference); below that the row shows nothing there and `/compact` stays.
   */
  let showContext = $derived(contextUsed !== null && (contextLevel(contextUsed) === 'full' || work.shows('header.context') && contextUsed >= CONTEXT_SHOWN_FROM));
  /** Every agent can read uploaded files through its local tools. */
  let canAttach = $derived(!!target || (provider !== null && provider !== undefined));

  // Older modes keep their execution policy until the user makes a choice.
  let displayedMode = $derived<PermissionMode>(shownMode(choice?.permissionMode ?? 'default', provider));
  let modes = $derived(modesFor(provider));
  /**
   * The chosen account answered that it is signed out and no other account of
   * its agent can take the next send: the core moves a thread to one that can,
   * so only the agent's last signed-out login asks to sign in again.
   */
  let signedOut = $derived.by(() => {
    const account = choice ? store.accountOf(choice.accountId) : null;
    return account?.status === 'unauthenticated' && store.usableAccountOf(account.providerId, account.id) === null ? account : null;
  });
  /** The open thread's provider was turned off in Providers: the core refuses its next turn. */
  let providerOff = $derived.by(() => {
    const entry = !target && store.openThread ? store.providerOf(store.openThread.providerId) : null;
    return entry && !store.providerOn(entry.id) ? entry : null;
  });
  /**
   * Providers is a desktop settings page and the owner's alone. Anywhere else
   * (a phone-width window, a paired device) the chip is a label: it leads
   * nowhere, and the sentence behind it is the one a send would answer with.
   */
  const phoneWidth = new MediaQuery('(max-width: 720px)');
  let providersReachable = $derived(store.owner && desktopSettings(phoneWidth.current));
  // One word per mode, one plain line under it, the long sentence on hover.
  // A legacy mode still live (`plan`) keeps its own choice until another is picked.
  let modeChoices = $derived<ModeChoice[]>([...modes, ...modes.includes(displayedMode) ? [] : [displayedMode]]
    .map((mode) => ({ id: mode, label: modeWord(mode, provider), hint: modeLabel(mode, provider), title: modeHint(mode, provider), icon: modeIcon(mode) })));
  /** A bot keeps its model, effort and mode in its settings: its chips read them and open nothing. */
  let botHint = $derived(bot ? fill(botGone ? strings.composer.botAccountGone : strings.composer.botSettings, { name: bot }) : '');
  // The worktree switch exists where the core can honour it: a draft on a
  // folder the core found a `.git` in. No answer yet, or an older core that
  // never gives one, is no repository: a switch the core would refuse is noise.
  let draftRepository = $derived(
    !target && work.shows('composer.worktree') && store.draft && !store.draftInDrafts ? store.projects.find((project) => project.id === store.draft?.projectId)?.repository === true : false
  );

  // The reasoning chip belongs to the model the choice is on, and a model that
  // offers no scale (an agent that keeps its own) gets no chip at all.
  let effortLevels = $derived((store.modelOf(choice)?.effort?.levels ?? []).filter(level => provider?.protocol === 'claude-sdk' || level.id !== 'ultrathink'));
  // An agent keeps no speed of its own: its chips offer none.
  let speedOptions = $derived(speedControl(choice && !target ? store.modelsOf(choice.providerId, choice.accountId) : [], choice));
  let speeds = $derived(speedOptions.speeds);
  let activeEffort = $derived(choice?.effort ?? store.modelOf(choice)?.effort?.default ?? null);
  /** The model has a scale but no default: its agent picks the level until the user does. */
  let agentDefault = $derived(effortLevels.length > 0 && store.modelOf(choice)?.effort?.default === undefined);

  /** A null effort runs at the model's own default, not at a preset the client configured. */
  function cacheKey(selection: Choice): CacheKey {
    return {
      accountId: selection.accountId,
      protocol: store.providers.find(entry => entry.id === selection.providerId)?.protocol ?? null,
      model: selection.model ?? null,
      effort: selection.effort ?? store.modelOf(selection)?.effort?.default ?? null,
      speed: selection.speed ?? null,
    };
  }

  /** On a thread only the model and the effort change and they are saved at once; on a draft the whole choice is remembered. */
  async function pick(patch: PickPatch) {
    if (!choice || picking) return;
    if (target?.selection) {
      // Another model runs on its own scale, at its default level until one is picked.
      const changedModel = patch.model !== undefined || patch.accountId !== undefined;
      const next = { ...choice, ...patch, effort: patch.effort !== undefined ? patch.effort : changedModel ? null : choice.effort };
      picking = true;
      try { await target.selection.save(next); } finally { picking = false; }
      return;
    }
    const thread = store.openThread;

    if (thread) {
      const changedModel = patch.model !== undefined || patch.accountId !== undefined;
      const target = { ...choice, ...patch, effort: patch.effort !== undefined ? patch.effort : changedModel ? null : choice.effort, speed: patch.speed !== undefined ? patch.speed : changedModel ? null : choice.speed ?? null };
      picking = true;
      try {
        if (switchDropsHistory(thread, target.accountId)) {
          slider?.close();
          const from = providerName(store, thread.providerId);
          const to = providerName(store, target.providerId);
          const go = await confirm.ask({
            title: fill(strings.composer.switchTitle, { tokens: formatTokens(thread.context?.tokens ?? 0), provider: to }),
            body: fill(strings.composer.switchBody, { provider: to }),
            confirmLabel: strings.composer.switchConfirm,
            cancelLabel: fill(strings.composer.switchCancel, { provider: from }),
          });
          if (!go) return;
        } else if (switchResetsCache(thread, cacheKey(choice), cacheKey(target))) {
          // A phone draws the slider as a sheet over everything: it leaves before the question.
          slider?.close();
          const go = await confirm.ask({
            title: fill(strings.composer.cacheTitle, { tokens: formatTokens(thread.context?.tokens ?? 0) }),
            body: strings.composer.cacheBody,
            confirmLabel: strings.composer.cacheConfirm,
            cancelLabel: strings.composer.cacheCancel,
          });
          if (!go) return;
        }
        const accepted = await store.update(thread.id, {
          accountId: target.accountId, model: target.model, effort: target.effort, speed: target.speed,
          expectedSelectionVersion: thread.selectionVersion ?? 0,
        });
        if (accepted) store.remember(target);
      } finally { picking = false; }
      return;
    }

    if (patch.speed !== undefined) { choice = { ...choice, ...patch }; store.remember(choice); return; }
    // An effort alone: the model stays, so nothing else moves.
    if (patch.effort !== undefined) {
      if (patch.effort === choice.effort) return;
      choice = { ...choice, effort: patch.effort };
      store.remember(choice);
      return;
    }

    // Another model runs on its own scale, so the effort goes back to that model's default.
    const picked = { ...choice, ...patch };
    choice = { ...picked, effort: store.defaultEffortOf(picked.providerId, picked.accountId, picked.model), speed: null };
    store.remember(choice);
  }

  function pickEffort(id: string | null) {
    void pick({ effort: id || null });
  }

  function pickMode(id: string) {
    const mode = id as PermissionMode;
    if (!choice || picking) return;
    if (target?.selection) {
      picking = true;
      void target.selection.save({ ...choice, permissionMode: mode }).finally(() => { picking = false; });
      return;
    }
    choice = { ...choice, permissionMode: mode };
    if (bound) void store.setPermissionMode(mode);
    else store.remember(choice);
  }

  function onchoose(event: Event) {
    const field = event.currentTarget as HTMLInputElement;
    const files = Array.from(field.files ?? []);
    // The same picture picked twice in a row must fire `change` both times.
    field.value = '';
    onfiles(files);
  }

  /** The chip's own trigger opens its popover: one popover, owned by one component. The speed is the bolt inside the effort's. */
  export async function openChip(testid: string) {
    await tick();
    if (testid === 'composer-picker') { await chip?.reveal(); return; }
    const id = testid === 'effort-speed' ? 'composer-effort' : testid;
    bar?.closest('[data-testid="composer"]')?.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.click();
  }
</script>

<svelte:window onstorage={(event) => { if (event.key === VOICE_STORAGE_KEY || event.key === null) voice.load(); }} />

<div class="bar" bind:this={bar}>
  <!-- One "+" at the start: files, a file mention, a command and the draft's worktree. -->
  {#key `${key}:${store.draft?.projectId ?? ''}`}
  <ComposerOptions bind:this={options} worktree={!answering && store.draft && draftRepository ? store.draft.worktree : null} {canAttach} onattach={() => picker?.click()} onworktree={() => store.setDraftWorktree(!store.draft?.worktree)} {onmention} {oncommand} />
  {/key}
  {#if target && !target.selection}
  <div class="chips">{#if target.chips}{@render target.chips()}{/if}</div>
  {:else}
  <!-- The model chip stays named while the box answers a question: the next turn runs on it. -->
  <!-- Two lines on a phone, each control in its own place: what runs the turn (model, effort), then how it runs (permission) with the context at the end. A desktop reads them as one row. -->
  <div class="chips">
    <div class="line runs">
    <!-- A bot's model is its own setting: its chip names it and changes nothing here. -->
    <ModelPicker bind:this={chip} {store} {choice} disabled={picking} readonly={bot !== null} readonlyHint={botHint} onpick={pick} />
    {#if choice && (effortLevels.length > 0 || speeds.length > 0)}
      <!-- The effort is a slider of its own, read at rest: its level, the bolt while fast is on. -->
      <EffortSlider bind:this={slider} levels={effortLevels} active={activeEffort} onpick={pickEffort} ondefault={agentDefault ? () => pickEffort(null) : undefined} {speeds} speed={speedOptions.speed} onspeed={(id) => void pick(speedOptions.pick(id))} readonly={bot !== null} readonlyHint={botHint} />
    {/if}
    </div>
    <div class="line how">
    {#if choice && modes.length > 0}
      <PermissionChip items={modeChoices} active={displayedMode} onpick={pickMode} readonly={bot !== null} readonlyHint={botHint} />
    {/if}
    {#if signedOut && store.owner}
      <button type="button" class="ui-chip signed-out" data-testid="composer-reconnect" title={fill(strings.connect.signedOut, { provider: provider?.name ?? '' })} onclick={() => store.openConnect(signedOut.providerId, signedOut.id)}><span class="ui-label">{strings.connect.reconnect}</span></button>
    {/if}
    {#if providerOff}
      {@const sentence = fill(strings.providerSettings.threadOff, { provider: providerOff.name })}
      {#if providersReachable}
        <button type="button" class="ui-chip signed-out" data-testid="composer-provider-off" title={sentence} aria-label={sentence} onclick={() => store.showSettings('accounts')}><span class="ui-label">{strings.providerSettings.off}</span></button>
      {:else}
        <span class="ui-chip signed-out" data-testid="composer-provider-off" title={sentence} aria-label={sentence}><span class="ui-label">{strings.providerSettings.off}</span></span>
      {/if}
    {/if}
    {#if bound && showContext}
      <!-- The context is its own quiet item of the row, after the chips that set something. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="context-control" oncontextmenu={(event) => controlMenu(event, store, 'header.context')}><ContextControl {store} /></div>
    {/if}
    </div>
  </div>
  {/if}
  {#if canAttach}
    <input
      bind:this={picker}
      class="file"
      type="file"
      multiple
      tabindex="-1"
      aria-hidden="true"
      data-testid="composer-file"
      onchange={onchoose}
    />
  {/if}

  <!-- Dictation and the round button: at the row's end on a desktop, at the field's end on a phone (where the row gives its width to the chips' words). -->
  <div class="tools" data-count={voice.current.enabled ? 2 : 1}>
  {#if voice.current.enabled}
  {#key store}
    {#key `${key}:${store.draft?.projectId ?? ''}`}
      <Deferred part={parts.Dictation}>
        {#snippet children(Dictation)}<Dictation {store} onbusy={(busy) => dictating = busy} {onpreview} ontext={ontranscript} />{/snippet}
        <!-- The microphone's idle face until its chunk lands (App starts it with the app): same box, same glyph, nothing to press yet. -->
        {#snippet pending()}<span class="dictation-stand-in"><button type="button" class="icon-button" title={strings.speech.start} aria-label={strings.speech.start} disabled><Mic size={16} strokeWidth={1.75} /></button></span>{/snippet}
        <!-- A chunk that failed: the same button says so and asks again. -->
        {#snippet failure(retry)}<span class="dictation-stand-in failed"><button type="button" class="icon-button" data-testid="dictation-retry" title={strings.parts.dictationFailed} aria-label={strings.parts.dictationFailed} onclick={retry}><MicOff size={16} strokeWidth={1.75} /></button></span>{/snippet}
      </Deferred>
    {/key}
  {/key}
  {/if}
  <!-- While a turn runs on an empty box, Stop takes Send's place; typing brings Send back (Escape still stops). -->
  {#if stopShown}
    <button type="button" class="icon quiet stop" data-testid="composer-stop" title={strings.composer.stop} aria-label={strings.composer.stop} onmousedown={keepFocus} onclick={() => { if (target) target.stop?.(); else void store.stop(); }}>
      <Square size={12} strokeWidth={2.5} />
    </button>
  {/if}
  <button
    type="button"
    class="primary icon send"
    class:resting={stopShown}
    data-testid="composer-send"
    data-waiting={waiting || undefined}
    title={waiting ? strings.composer.sendWhenLoaded : sendLabel}
    aria-label={waiting ? strings.composer.sendWhenLoaded : sendLabel}
    disabled={!canSend || (answering && !typed)}
    onmousedown={keepFocus}
    onclick={() => onsubmit()}
  >
    {#if waiting}<LoaderCircle size={16} strokeWidth={2.25} class="spinner" />{:else}<ArrowUp size={16} strokeWidth={2.25} />{/if}
  </button>
  </div>
</div>

<style>
  .dictation-stand-in { display: flex; align-items: center; flex: none; }
  .dictation-stand-in button { flex: none; margin: calc((var(--icon-button-target) - var(--icon-button)) / 2); }
  .dictation-stand-in.failed button { color: var(--color-danger); }
  /* The button in the chip bar is what opens it; the field itself never shows. */
  .file {
    display: none;
  }

  .context-control { display: flex; flex: none; }

  .chips .ui-chip.signed-out { color: var(--color-live); }
  /* Every chip's chevron is the same quiet mark: the value stays what the eye reads. */
  .chips :global(.trigger > .lucide-chevron-down) { flex: none; opacity: .6; }

  /* Every child is one control high, so the end is the centre on one row; on a
     composer too narrow for one, the tools sit on the chips' last row. */
  .bar {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: var(--composer-bar-padding, 4px 8px 8px 10px);
  }

  .tools { display: flex; align-items: center; flex: none; gap: 8px; }

  .chips {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
  }
  /* A desktop row reads the two lines as one. */
  .line { display: contents; }
  /* A desktop chip is a 32 px target, the head's control height. */
  .chips :global(.trigger) {
    height: var(--control-head);
    padding: 0 10px;
    gap: 7px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  /* One quiet chip for the model, the effort and the mode: no frame, muted
     ink, a fill only under the pointer or while its menu is open. */
  .bar .chips :global(.trigger) {
    width: auto;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
    color: var(--color-muted-foreground);
  }

  .bar .chips :global(.trigger[aria-expanded='true']) {
    border-color: transparent;
    background: var(--color-hover);
    color: var(--color-foreground);
  }

  /* Only under a pointer that hovers: a tap left :hover behind and the chip stayed pressed. */
  @media (hover: hover) {
    .bar .chips :global(.trigger:hover) {
      border-color: transparent;
      background: var(--color-hover);
      color: var(--color-foreground);
    }
  }

  /* Nothing to pick yet: the one chip that gets somewhere reads at full ink. */
  .bar .chips :global(.trigger.connect) {
    border-color: transparent;
    background: var(--color-active);
    color: var(--color-foreground);
  }


  .send,
  .stop {
    width: var(--control);
    height: var(--control);
    border-radius: var(--radius-full);
    flex: none;
  }

  .send { box-shadow: var(--shadow-send); }
  .send.resting { display: none; }
  .send :global(.spinner) { animation: spin 1s linear infinite var(--loops); }
  @media (prefers-reduced-motion: reduce) { .send :global(.spinner) { animation: none; } }

  /* The tools beside send are quiet and round like the chips, so send stays
     the one solid control of the row. */
  /* Stop is send's circle at send's size in a neutral fill: the accent stays send's. */
  .bar .stop { border-color: transparent; background: var(--color-active); box-shadow: none; color: var(--color-foreground); }
  .bar .stop:hover:not(:disabled) { background: color-mix(in oklab, var(--color-foreground) 12%, transparent); }

  /* A composer the side panel narrowed keeps its tools on one row. */
  @container composer (max-width: 600px) {
    .chips :global(.picker) { min-width: 0; }
  }
  @container composer (max-width: 480px) {
    .bar, .tools { gap: 6px; }
  }

  /* A desktop's round targets reach 32 px: send and stop ("+" and the microphone are app.css's icon button). */
  @media (min-width: 721px) {
    .send, .stop { width: 32px; height: 32px; }
  }

  /* A short press: a chip or the disc gives under the finger at once and
     settles back in the motion family's time; reduced motion (`--motion` 0)
     keeps it still. */
  .bar :global(:is(.chips .trigger, .opener)), .send, .stop {
    transition: background var(--dur-2) var(--ease-out-quint), border-color var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint), opacity var(--dur-2) var(--ease-out-quint), transform var(--motion-duration) var(--motion-curve);
  }
  .bar :global(:is(button.trigger, .opener):active:not(:disabled)), .send:active:not(:disabled), .stop:active:not(:disabled) {
    transform: scale(calc(1 - .06 * var(--motion)));
    transition-duration: var(--dur-1);
  }

  @media (max-width: 720px) {
    .bar { position: relative; gap: 2px; padding: var(--composer-bar-padding, 0 8px 6px); }
    /* The microphone and send stand at the field's end, on its last line, so
       the row's whole width reads the chips' words: nothing ever slides under
       them. The field keeps its place; Composer pads its text clear of them.
       The disc is drawn 36 px inside its 44 px target, 8 px from the card's
       right edge and, on a one line field, 8 px from its top: an even margin. */
    .tools { position: absolute; right: 4px; bottom: calc(100% - 4px); gap: 0; }
    /* 36 px drawn, not --control-lg or the touch screen's 44 px icon minimum:
       those pushed the disc onto the card's edge on a one line field. The
       ::after below keeps the 44 px target. */
    .tools :is(.send, .stop) { position: relative; width: 36px; height: 36px; min-width: 0; min-height: 0; margin: 4px; }
    .tools :is(.send, .stop)::after { content: ''; position: absolute; inset: -5px; border-radius: inherit; }
    /* Every value whole: a row too short for them wraps onto a second one
       under it, each row a 44 px target (36 px chips, 8 px between rows). The
       "+" stays on the first row, the field above never changes its place in
       the card. */
    .chips { flex: 1; flex-direction: column; align-items: stretch; gap: 8px; min-height: var(--touch-target); padding-block: 4px; }
    .bar > :global(.options) { align-self: flex-start; }
    /* A designed grid, not a wrap: the first line holds the model and the
       effort beside the "+", the second the permission, the context reading
       at its end when it shows. Each control keeps its place whether or not
       the context is there; a line too short for its values wraps itself. */
    .line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 6px; min-width: 0; }
    .line.how:not(:has(*)) { display: none; }
    .line > :global(*) { flex: none; max-width: 100%; }
    .line.how > .context-control { margin-inline-start: auto; }
    /* Each setting reads as a control at rest: a quiet surface and a hairline
       around its icon, its value and its chevron, 36 px drawn in a 44 px target. */
    .bar .chips :global(:is(.picker, .effort, .permission) > .trigger) {
      position: relative;
      height: 36px;
      padding: 0 8px;
      gap: 5px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-full);
      background: color-mix(in oklab, var(--color-foreground) 4%, transparent);
    }
    .bar .chips :global(:is(.picker, .effort, .permission) > .trigger)::after { content: ''; position: absolute; inset: -4px 0; }
    .chips :global(.picker > .trigger) { max-width: none; }
    .chips :global(.picker > .trigger > .label) { max-width: none; overflow: visible; }
    .bar .chips :global(.picker > .trigger.connect) { padding: 0 12px; background: var(--color-active); color: var(--color-foreground); }
  }
  /* A 360 px phone: the "+" takes a 32 px column, its 44 px target kept by
     the icon button's hit zone, and the chips' sides close in. A value never
     shrinks: what does not fit goes to the next row. */
  @media (max-width: 379px) {
    .bar { gap: 0; padding-inline: 4px; }
    .bar :global(.options .opener) { margin-inline: -2px; }
    .bar .chips :global(:is(.picker, .effort, .permission) > .trigger) { padding: 0 7px; gap: 4px; }
    .line { column-gap: 4px; }
  }
</style>
