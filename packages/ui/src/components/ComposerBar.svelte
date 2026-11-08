<script lang="ts">
  import { ArrowUp, LoaderCircle, Mic, MicOff, Square } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { effectiveCompaction, type PermissionMode, type ProviderSummary } from '@boite/contracts';
  import { formatTokens, providerName } from '../lib/format';
  import { confirm } from '../lib/confirm.svelte';
  import { switchDropsHistory, switchResetsCache, type CacheKey } from '../lib/switch-warning';
  import { modeHint, modeLabel, modesFor, shownMode } from '../lib/permission-modes';
  import { fill, strings } from '../lib/strings';
  import type { Choice, PickPatch, Store } from '../lib/store.svelte';
  import PickerChoices from './PickerChoices.svelte';
  // Its body loads with the picker's menu, which hands it to `rows`.
  import type PickerMore from './PickerMore.svelte';
  import ModelPicker from './ModelPicker.svelte';
  import Deferred, { parts } from './Deferred.svelte';
  import ComposerOptions from './ComposerOptions.svelte';
  import ContextControl from './ContextControl.svelte';
  import { work } from '../lib/work-prefs.svelte';
  import { voice, VOICE_STORAGE_KEY } from '../lib/voice-prefs.svelte';
  import { controlMenu } from '../lib/controls';
  import { keepFocus } from '../lib/focus';
  import { contextLevel, contextPercent } from '../lib/tokens';
  import { speedControl } from '../lib/model-speeds';
  import { levelName, levelTitle } from '../lib/format';
  import type { ComposerTarget } from '../lib/composer-target';
  import { desktopSettings } from '../lib/settings-tabs';
  /** The context's number shows beside the model chip from this percent used. */
  const CONTEXT_SHOWN_FROM = 70;

  /**
   * The row under the composer's box, the same in every state and on every
   * width: one "+" for what adds to the message, one model chip naming the
   * model (its effort, speed, permission and context rows inside; the
   * context's number beside it once it matters), then dictation and one round
   * button that is Send, or Stop while a turn runs and nothing waits to go
   * (not while it stands on a decision of the owner's).
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
    provider,
    canSend,
    waiting = false,
    answering = false,
    composer = null,
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
    provider: ProviderSummary | null | undefined;
    canSend: boolean;
    /** Send was pressed while files were still being read: it goes once they are ready. */
    waiting?: boolean;
    answering?: boolean;
    /** The composer while an ask is docked in it: menus open above it, so the ask stays readable. */
    composer?: HTMLElement | null;
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
  let meter = $state<ContextControl | undefined>(undefined);
  const askAnchor = () => composer;
  let stopping = $derived(!!(target ? target.busy && target.stop : store.busy));
  /** The turn stands still on the owner's answer (a permission, a question it stopped for): Deny or Skip is the way out, Escape still stops. */
  let held = $derived(!target && store.openThread?.status === 'waiting');
  /** One round button at the row's end: Stop while a turn runs and nothing waits to go, Send otherwise. */
  let stopShown = $derived(stopping && !held && !canSend && !waiting);

  let picker = $state<HTMLInputElement | undefined>(undefined);
  let bar = $state<HTMLDivElement | undefined>(undefined);

  let bound = $derived(!target && store.openThread !== null);
  let contextUsed = $derived(store.openThread?.context ? contextPercent(store.openThread.context, store.settings ? effectiveCompaction(store.settings, store.openThread).autoCompact : null) : null);
  /**
   * The number beside the chip only once the context matters (a nearly full
   * one whatever the preference); below that the row shows nothing there and
   * the details stay one row away: the chip's menu, or the "+" on a bot's
   * thread, whose chip opens nothing.
   */
  let showContext = $derived(contextUsed !== null && (contextLevel(contextUsed) === 'full' || work.shows('header.context') && contextUsed >= CONTEXT_SHOWN_FROM));
  /** Where the details open while no number is drawn: over the row, or over the composer while an ask is docked. */
  const meterAnchor = () => composer ?? bar ?? null;
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
  /**
   * The thread names an account that was removed and its agent has no other
   * account to move to on the next send: it sends again once another one is picked.
   */
  let accountRemoved = $derived(!target && store.openThread !== null && store.accounts.length > 0 && store.accountOf(store.openThread.accountId) === null
    && store.usableAccountOf(store.openThread.providerId, store.openThread.accountId) === null);
  // One word per choice: what the mode allows is said on hover, not printed
  // three times over. A legacy mode still live (`plan`) keeps its own choice until another is picked.
  let modeItems = $derived([...modes, ...modes.includes(displayedMode) ? [] : [displayedMode]]
    .map((mode) => ({ id: mode, label: modeLabel(mode, provider), title: modeHint(mode, provider) })));
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
  /** The empty id is the agent's own level, offered first while the model names no default. */
  let effortItems = $derived([...agentDefault ? [{ id: '', label: strings.composer.effortDefault, title: strings.composer.effortDefaultHint }] : [],
    ...effortLevels.map((level) => ({ id: level.id, label: levelName(level), title: levelTitle(level) }))]);
  let speedItems = $derived([{ id: '', label: strings.composer.standardSpeed }, ...speeds.map((entry) => ({ id: entry.id, label: levelName(entry), title: levelTitle(entry) }))]);
  /** What the picker's More row holds, by its current value: a speed other than the standard one. */
  let moreSummary = $derived(speedItems.find((item) => item.id !== '' && item.id === speedOptions.speed)?.label ?? '');

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

  function pickEffort(id: string) {
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

  /** The chip's own trigger opens its menu: one popover, owned by one component. Effort, speed and mode are rows of the model chip's. */
  export async function openChip(testid: string) {
    await tick();
    if (testid === 'composer-picker' || testid === 'composer-effort' || testid === 'composer-mode' || testid === 'effort-speed') {
      await chip?.reveal(testid === 'composer-picker' ? undefined : testid);
      return;
    }
    bar?.closest('[data-testid="composer"]')?.querySelector<HTMLElement>(`[data-testid="${testid}"]`)?.click();
  }
</script>

<svelte:window onstorage={(event) => { if (event.key === VOICE_STORAGE_KEY || event.key === null) voice.load(); }} />

<div class="bar" bind:this={bar}>
  <!-- One "+" at the start: files, a file mention, a command and the draft's worktree. -->
  {#key `${key}:${store.draft?.projectId ?? ''}`}
  <ComposerOptions worktree={!answering && store.draft && draftRepository ? store.draft.worktree : null} {canAttach} anchor={askAnchor} onattach={() => picker?.click()} onworktree={() => store.setDraftWorktree(!store.draft?.worktree)} {onmention} {oncommand}
    context={bound && bot !== null ? (contextUsed === null ? strings.thread.contextDetails : strings.thread.contextPercentUsed(String(Math.round(contextUsed)))) : null} oncontext={() => meter?.open()} />
  {/key}
  {#if target && !target.selection}
  <div class="chips">{#if target.chips}{@render target.chips()}{/if}</div>
  {:else}
  <!-- The model chip stays named while the box answers a question: the next turn runs on it. -->
  <div class="chips">
    {#snippet ring()}
      {#if bound && showContext}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="context-control" oncontextmenu={(event) => controlMenu(event, store, 'header.context')}><ContextControl bind:this={meter} {store} anchor={askAnchor} /></div>
      {/if}
    {/snippet}
    {#snippet rows(More: typeof PickerMore)}
      <!-- Each row names its setting and lays its choices out by name: the same order and words on every width. -->
      {#if effortLevels.length > 0}
        <div class="setting" data-testid="composer-effort" tabindex="-1"><span class="setting-name ui-label">{strings.composer.effortTitle}</span>
          <PickerChoices label={strings.composer.effortTitle} testid="composer-effort-menu" items={effortItems} active={activeEffort ?? (agentDefault ? '' : null)} onpick={pickEffort} /></div>
      {/if}
      {#if modes.length > 0}
        <div class="setting" data-testid="composer-mode" tabindex="-1"><span class="setting-name ui-label">{strings.composer.mode}</span>
          <PickerChoices label={strings.composer.mode} testid="composer-mode-menu" items={modeItems} active={displayedMode} onpick={pickMode} /></div>
      {/if}
      {#if speeds.length > 0 || bound}
        <!-- Speed and context wait behind one quiet row that reads its value: the first level is the model, its effort and its permission. -->
        <More summary={moreSummary}>
          {#if speeds.length > 0}
            <div class="setting" data-testid="effort-speed" tabindex="-1"><span class="setting-name ui-label">{strings.composer.speed}</span>
              <PickerChoices label={strings.composer.speed} testid="effort-speed-menu" items={speedItems} active={speedOptions.speed ?? ''} onpick={(id) => void pick(speedOptions.pick(id || null))} /></div>
          {/if}
          {#if bound}
            <div class="setting context-row"><span class="setting-name ui-label">{strings.thread.contextDetails}</span><ContextControl {store} /></div>
          {/if}
        </More>
      {/if}
    {/snippet}
    <!-- A bot's model is its own setting: its chip names it and changes nothing here. -->
    <ModelPicker bind:this={chip} {store} {choice} disabled={picking} readonly={bot !== null} readonlyHint={bot ? fill(strings.composer.botModel, { name: bot }) : ''} anchor={askAnchor} settings={bot === null ? rows : undefined} trailing={ring} onpick={pick} />
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
    {#if bound && bot !== null && !showContext}
      <!-- No number drawn on a bot's thread: its details open from the "+" over the row; the host takes no room. -->
      <ContextControl bind:this={meter} {store} anchor={meterAnchor} quiet />
    {/if}
    {#if accountRemoved}
      <button type="button" class="ui-chip signed-out" data-testid="composer-account-removed" title={strings.accounts.removedHint} onclick={() => void openChip('composer-picker')}><span class="ui-label">{strings.accounts.removed}</span></button>
    {/if}
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

  {#if voice.current.enabled}
  {#key store}
    {#key `${key}:${store.draft?.projectId ?? ''}`}
      <Deferred part={parts.Dictation}>
        {#snippet children(Dictation)}<Dictation {store} onbusy={(busy) => dictating = busy} {onpreview} ontext={ontranscript} />{/snippet}
        <!-- The microphone's idle face until its chunk lands (App starts it with the app): same box, same glyph, nothing to press yet. -->
        {#snippet pending()}<span class="dictation-stand-in"><button type="button" class="icon" title={strings.speech.start} aria-label={strings.speech.start} disabled><Mic size={16} strokeWidth={1.75} /></button></span>{/snippet}
        <!-- A chunk that failed: the same button says so and asks again. -->
        {#snippet failure(retry)}<span class="dictation-stand-in failed"><button type="button" class="icon" data-testid="dictation-retry" title={strings.parts.dictationFailed} aria-label={strings.parts.dictationFailed} onclick={retry}><MicOff size={16} strokeWidth={1.75} /></button></span>{/snippet}
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
    disabled={!canSend}
    onmousedown={keepFocus}
    onclick={() => onsubmit()}
  >
    {#if waiting}<LoaderCircle size={16} strokeWidth={2.25} class="spinner" />{:else}<ArrowUp size={16} strokeWidth={2.25} />{/if}
  </button>
</div>

<style>
  .dictation-stand-in { display: flex; align-items: center; flex: none; }
  .dictation-stand-in button { flex: none; width: var(--control); height: var(--control); }
  .dictation-stand-in.failed button { color: var(--color-danger); }
  /* The button in the chip bar is what opens it; the field itself never shows. */
  .file {
    display: none;
  }

  .context-control { display: flex; flex: none; }
  .bar .chips .context-control :global(.trigger) { padding: 0 8px 0 4px; gap: 5px; }

  .chips .ui-chip.signed-out { color: var(--color-live); }

  /* The rows under the models: the setting's name, its choices at the end, or
     under it when the picker is too narrow for both on one line. */
  .setting { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; min-height: var(--row); padding: 2px 2px 2px 8px; outline: none; }
  .setting-name { color: var(--color-muted-foreground); font-size: var(--text-sm); }

  /* Every child is one control high, so the end is the centre on one row; on a
     composer too narrow for one, the tools sit on the chips' last row. */
  .bar {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: var(--composer-bar-padding, 4px 8px 8px 10px);
  }

  .chips {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .chips :global(.trigger) {
    height: var(--control);
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
  .send:not(:disabled):active { transform: scale(.92); }
  .send :global(.spinner) { animation: spin 1s linear infinite var(--loops); }
  @media (prefers-reduced-motion: reduce) { .send :global(.spinner) { animation: none; } }

  /* The tools beside send are quiet and round like the chips, so send stays
     the one solid control of the row. */
  /* Stop is send's circle at send's size in a neutral fill: the accent stays send's. */
  .bar .stop { border-color: transparent; background: var(--color-active); box-shadow: none; color: var(--color-foreground); }
  .bar .stop:hover:not(:disabled) { background: color-mix(in oklab, var(--color-foreground) 12%, transparent); }
  .bar :global(.microphone:not(.listening)) { border-radius: var(--radius-full); }
  .bar :global(.microphone:not(.listening)) { border-color: transparent; box-shadow: none; }
  .bar :global(.microphone:not(.listening):not(:hover)) { background: transparent; }

  /* A composer the side panel narrowed keeps its tools on one row. */
  @container composer (max-width: 600px) {
    .chips :global(.picker) { min-width: 0; }
  }
  @container composer (max-width: 480px) {
    .bar { gap: 6px; }
  }

  @media (max-width: 720px) {
    .bar { gap: 2px; padding: var(--composer-bar-padding, 0 8px 6px); }
    .chips { flex: 1; flex-wrap: nowrap; }
    .setting { min-height: var(--touch-target); }
    .chips :global(.picker) { min-width: 0; max-width: 100%; }
    .chips :global(.picker > .trigger) { max-width: 100%; height: var(--touch-target); padding: 0 6px; }
    /* The model's name alone, and whole words of it: one line high, a name too long for the row
       wraps its last words onto a second line nobody sees, never half of one. */
    .chips :global(.picker > .trigger > .label) { min-width: 0; max-width: none; height: 1lh; padding-block: 0; margin-block: 0; text-box: normal; overflow: hidden; white-space: normal; overflow-wrap: normal; }
    .bar .chips :global(.picker > .trigger.connect) { padding: 0 12px; border-radius: var(--radius-md); background: var(--color-active); color: var(--color-foreground); }
  }
  /* A 360 px phone gives the model's whole name the room of the chevron, of the gaps
     and of the context ring's side margin; every control keeps its full height. */
  @media (max-width: 400px) {
    .bar { gap: 0; }
    .chips :global(.picker > .trigger) { padding: 0 2px; }
    .chips :global(.picker > .trigger > .lucide-chevron-down) { display: none; }
    /* At 360 the model's whole name and its effort keep the row: the meter
       is its glyph alone, amber once nearly spent, its number in its label and its details. */
    .context-control :global(.trigger) { min-width: 34px; }
    .context-control :global(.percent) { display: none; }
  }
</style>
