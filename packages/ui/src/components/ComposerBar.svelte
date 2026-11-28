<script lang="ts">
  import { ArrowUp, LoaderCircle, Mic, MicOff, Square } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { effectiveCompaction, type AgentSelection, type PermissionMode, type PermissionRequest, type ProviderSummary, type QuestionRequest } from '@boite/contracts';
  import { formatTokens, providerName } from '../lib/format';
  import { confirm } from '../lib/confirm.svelte';
  import { errorText } from '../lib/errors';
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
  import { desktopSettings, settingsDestination } from '../lib/settings-tabs';
  import { machineAway } from '../lib/machine-away';
  import { declineHint } from '../lib/composer-placeholder';
  import { repliesOf } from '../lib/question-reply.svelte';
  import { workspace } from '../lib/workspace.svelte';
  import PluginSlotButtons from './PluginSlotButtons.svelte';

  /**
   * The row under the composer's box, the same in every state: one "+" for
   * what adds to the message, then a chip per setting reading its word at
   * rest: the model, the effort (a slider, the bolt while fast is on) and the
   * permission (an icon and a word), the same three on a thread, a bot and a
   * phone, the context's ring and "x% context left" once it matters, then dictation and one round
   * button that is Send, or Stop while a turn runs and nothing typed waits to go
   * (not while it stands on a decision of the owner's); with words typed the
   * turn's Stop waits in the foot's line. While the field
   * answers a question the button is the words "Answer", the one commit of
   * the card's picks with the text and files: the primary once something is
   * picked or typed, disabled before with its reason in the tooltip. The
   * turn's Stop then waits in the foot's line.
   * While a permission waits and the box holds text, Send says what it does:
   * the outline words "Decline and send", the permission named in its tooltip.
   * Nothing comes or goes with a decision docked above: the row keeps its
   * place and its controls. A pick on a thread is saved at once, after the
   * switch warnings; on a draft the whole choice is remembered. `choice`,
   * `picking` and `dictating` are the composer's, bound here.
   */
  let {
    store,
    key,
    bot = null,
    botGone = false,
    botRoute = null,
    provider,
    canSend,
    waiting = false,
    answering = null,
    typed = true,
    declining = null,
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
    /** The persistent agent this box writes to, by name: its model, effort and mode are its settings, which the chips show. */
    bot?: string | null;
    /** The bot's account is gone: the chips name the banner's remedy instead of its settings. */
    botGone?: boolean;
    /**
     * Saves a pick as the bot's own setting, the write of its settings page
     * (`saveDefaultRoute`). Absent where that page cannot change it (a paired
     * device): the chips then say so on a click.
     */
    botRoute?: ((patch: Partial<AgentSelection>) => Promise<unknown>) | null;
    provider: ProviderSummary | null | undefined;
    canSend: boolean;
    /** Send was pressed while files were still being read: it goes once they are ready. */
    waiting?: boolean;
    /** The question the field answers (`lib/question-reply.svelte.ts`): Send reads Answer. */
    answering?: QuestionRequest | null;
    /** Text or files are in the box: with them or a pick, Answer can act. */
    typed?: boolean;
    /** The thread's waiting permission, which a message sent now declines. */
    declining?: Pick<PermissionRequest, 'toolName' | 'input'> | null;
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
  let stopping = $derived(store.busy);
  /** The turn stands still on the owner's answer (a permission, a question it stopped for): Deny or Skip is the way out, Escape still stops. */
  let held = $derived(store.openThread?.status === 'waiting');
  /** One round button at the row's end: Stop while a turn runs and nothing typed waits to go, Send otherwise. */
  /** Nothing reaches a machine out of reach: no Stop, and Send queues what is written for its return. */
  let stopShown = $derived(stopping && !held && !answering && !waiting && !(canSend && typed) && !machineAway(store));
  /** Send declines: a permission waits and the box holds something to send. */
  let declines = $derived(!answering && !waiting && canSend && declining ? declineHint(declining) : null);
  /** Why Answer cannot act yet: nothing picked or typed. */
  let answerWaits = $derived(answering && !typed && !repliesOf(store).picks[answering.id]?.length
    ? (answering.options.length > 0 ? strings.chat.questionPickOrType : strings.chat.questionTypeFirst) : null);

  let picker = $state<HTMLInputElement | undefined>(undefined);
  let bar = $state<HTMLDivElement | undefined>(undefined);

  let bound = $derived(store.openThread !== null);
  let contextUsed = $derived(store.openThread?.context ? contextPercent(store.openThread.context, store.settings ? effectiveCompaction(store.settings, store.openThread).autoCompact : null) : null);
  /**
   * Keep the ring available before a reading arrives. A nearly full context
   * stays visible even when the control is hidden in the user's preferences.
   */
  let showContext = $derived(work.shows('header.context') || contextLevel(contextUsed) === 'full');
  /** Every agent can read uploaded files through its local tools. */
  let canAttach = $derived(provider !== null && provider !== undefined);

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
    const entry = store.openThread ? store.providerOf(store.openThread.providerId) : null;
    return entry && !store.providerOn(entry.id) ? entry : null;
  });
  /**
   * Providers is a desktop settings page and the owner's alone. Anywhere else
   * (a phone-width window, a paired device) the chip is a label: it leads
   * nowhere, and the sentence behind it is the one a send would answer with.
   */
  const phoneWidth = new MediaQuery('(max-width: 720px)');
  let providersReachable = $derived(settingsDestination('accounts', null, { owner: store.owner, phone: !desktopSettings(phoneWidth.current) }));
  // One word per mode, one plain line under it, the long sentence on hover.
  // A legacy mode still live (`plan`) keeps its own choice until another is picked.
  let modeChoices = $derived<ModeChoice[]>([...modes, ...modes.includes(displayedMode) ? [] : [displayedMode]]
    .map((mode) => ({ id: mode, label: modeWord(mode, provider), hint: modeLabel(mode, provider), title: modeHint(mode, provider), icon: modeIcon(mode) })));
  /**
   * A bot keeps its model, effort and mode in its settings: its chips show
   * them and a pick saves there. Where that page is read only, each chip says
   * why on a click.
   */
  let botLocked = $derived(bot !== null && !botRoute);
  let botHint = $derived(!bot ? '' : botLocked ? strings.agentSettingRequest.guestHint
    : fill(botGone ? strings.composer.botAccountGone : strings.composer.botSettings, { name: bot }));
  // The worktree switch exists where the core can honour it: a draft on a
  // folder the core found a `.git` in. No answer yet, or an older core that
  // never gives one, is no repository: a switch the core would refuse is noise.
  let draftRepository = $derived(
    work.shows('composer.worktree') && store.draft && !store.draftInDrafts ? store.projects.find((project) => project.id === store.draft?.projectId)?.repository === true : false
  );

  // The reasoning chip belongs to the model the choice is on, and a model that
  // offers no scale (an agent that keeps its own) gets no chip at all.
  let effortLevels = $derived((store.modelOf(choice)?.effort?.levels ?? []).filter(level => provider?.protocol === 'claude-sdk' || level.id !== 'ultrathink'));
  // An agent keeps no speed of its own: its chips offer none.
  let speedOptions = $derived(speedControl(choice && !bot ? store.modelsOf(choice.providerId, choice.accountId) : [], choice));
  let speeds = $derived(speedOptions.speeds);
  let activeEffort = $derived((choice ? store.resolvedChoice(choice).effort : null) ?? store.modelOf(choice)?.effort?.default ?? null);
  /** The model has a scale but no default: its agent picks the level until the user does. */
  let agentDefault = $derived(effortLevels.length > 0 && store.modelOf(choice)?.effort?.default === undefined);

  /** A null effort runs at the model's own default, not at a preset the client configured. */
  function cacheKey(selection: Choice): CacheKey {
    const resolved = store.resolvedChoice(selection);
    return {
      accountId: selection.accountId,
      protocol: store.providers.find(entry => entry.id === selection.providerId)?.protocol ?? null,
      model: resolved.model ?? null,
      effort: resolved.effort ?? store.modelOf(selection)?.effort?.default ?? null,
      speed: selection.speed ?? null,
    };
  }

  /** On a thread only the model and the effort change and they are saved at once; on a draft the whole choice is remembered. */
  async function pick(patch: PickPatch) {
    if (!choice || picking) return;
    const thread = store.openThread;

    if (thread) {
      const changedModel = patch.model !== undefined || patch.accountId !== undefined;
      const target = { ...choice, ...patch, effort: patch.effort !== undefined ? patch.effort : changedModel ? null : choice.effort, speed: patch.speed !== undefined ? patch.speed : changedModel ? null : choice.speed ?? null };
      const expectedSelectionVersion = thread.selectionVersion ?? 0;
      picking = true;
      try {
        const historyAtRisk = switchDropsHistory(thread, target.accountId);
        const preview = historyAtRisk && !botRoute ? await store.previewAccountSwitch(thread.id, target.accountId) : null;
        const resumes = preview?.session === 'resume';
        if (historyAtRisk && !resumes) {
          chip?.close();
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
        if (botRoute) {
          // The bot's settings take the pick, as its page would: another model starts at its own default level.
          const { speed: _speed, ...route } = patch;
          await saveBot(changedModel ? { effort: null, ...route } : route);
          return;
        }
        const accepted = await store.update(thread.id, {
          accountId: target.accountId, model: target.model, effort: target.effort, speed: target.speed,
          expectedSelectionVersion,
          ...(resumes ? { requireSavedSession: true } : {}),
        });
        if (accepted) store.remember(target);
      } catch (error) { store.error = errorText(error); }
      finally { picking = false; }
      return;
    }

    if (patch.providerId === undefined && patch.accountId === undefined && patch.model === undefined) {
      if (patch.speed === undefined && (patch.effort === undefined || patch.effort === choice.effort)) return;
      choice = { ...choice, ...patch };
      store.remember(choice);
      return;
    }

    const picked = { ...choice, ...patch };
    const changed = picked.providerId !== choice.providerId || picked.accountId !== choice.accountId || picked.model !== choice.model;
    choice = { ...picked, effort: patch.effort ?? store.defaultEffortOf(picked.providerId, picked.accountId, picked.model), speed: changed ? null : picked.speed };
    store.remember(choice);
  }

  /** A refused save leaves the chips on the setting the core kept, and says why. */
  async function saveBot(patch: Partial<AgentSelection>): Promise<void> {
    try { await botRoute?.(patch); }
    catch (error) { store.error = errorText(error); }
  }

  function pickEffort(id: string | null) {
    void pick({ effort: id || null });
  }

  function pickMode(id: string) {
    const mode = id as PermissionMode;
    if (!choice || picking) return;
    if (botRoute) {
      picking = true;
      void saveBot({ permissionMode: mode }).finally(() => { picking = false; });
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
  <!-- The model chip stays named while the box answers a question: the next turn runs on it. -->
  <!-- One row on a phone as on a desktop: what runs the turn (model, effort), then how it runs (permission) with the context at the end. -->
  <div class="chips">
    <div class="line runs">
    <!-- A bot's model is its own setting: a pick saves it there, as its settings page does. -->
    <ModelPicker bind:this={chip} {store} {choice} disabled={picking} readonly={botLocked} hint={botHint} onpick={pick} />
    {#if choice && (effortLevels.length > 0 || speeds.length > 0)}
      <!-- The effort is a slider of its own, read at rest: its level, the bolt while fast is on. -->
      <EffortSlider bind:this={slider} levels={effortLevels} active={activeEffort} onpick={pickEffort} ondefault={agentDefault ? () => pickEffort(null) : undefined} {speeds} speed={speedOptions.speed} onspeed={(id) => void pick(speedOptions.pick(id))} readonly={botLocked} hint={botHint} />
    {/if}
    </div>
    <div class="line how">
    {#if choice && modes.length > 0}
      <PermissionChip items={modeChoices} active={displayedMode} onpick={pickMode} disabled={picking} readonly={botLocked} hint={botHint} />
    {/if}
    {#if signedOut && store.owner}
      <button type="button" class="ui-chip signed-out" data-testid="composer-reconnect" data-preload-view="connect" title={fill(strings.connect.signedOut, { provider: provider?.name ?? '' })} onclick={() => store.openConnect(signedOut.providerId, signedOut.id)}><span class="ui-label">{strings.connect.reconnect}</span></button>
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
    <!-- Outside desktop-options: a phone keeps a plugin's buttons. -->
    {#if store === workspace.primary}<PluginSlotButtons slot="composer" threadId={store.openThread?.id ?? null} compact />{/if}
  </div>
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
  <div class="tools" data-count={voice.current.enabled ? 2 : 1} data-worded={answering ? 'answer' : declines ? 'decline' : undefined}>
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
  <!-- While a turn runs on an empty box, Stop takes Send's place; typing brings Send back, and the turn's Stop moves to the foot's line (Composer's `stopsTurn`). -->
  {#if stopShown}
    <button type="button" class="icon quiet stop" data-testid="composer-stop" title={strings.composer.stop} aria-label={strings.composer.stop} onmousedown={keepFocus} onclick={() => void store.stop()}>
      <Square size={12} strokeWidth={2.5} />
    </button>
  {/if}
  {#if answering}
    <!-- The one commit of the question at the top of the card: its picks with what the box holds. -->
    <button type="button" class={canSend ? 'primary worded' : 'secondary worded'} data-testid="composer-send" data-answers="true" disabled={!canSend}
      title={answerWaits ?? (waiting ? strings.composer.sendWhenLoaded : undefined)} onmousedown={keepFocus} onclick={() => onsubmit()}>
      <span class="ui-label">{strings.chat.questionAnswer}</span>
    </button>
  {:else if declines}
    <!-- The consequence in words, never the accent: the outline secondary, the permission named in its tooltip. -->
    <button type="button" class="secondary worded" data-testid="composer-send" data-declines="true" title={declines} onmousedown={keepFocus} onclick={() => onsubmit()}>
      <span class="ui-label">{strings.composer.declineSend}</span>
    </button>
  {:else}
  <button
    type="button"
    class="primary icon send"
    class:resting={stopShown}
    data-testid="composer-send"
    data-waiting={waiting || undefined}
    title={waiting ? strings.composer.sendWhenLoaded : strings.composer.send}
    aria-label={waiting ? strings.composer.sendWhenLoaded : strings.composer.send}
    disabled={!canSend}
    onmousedown={keepFocus}
    onclick={() => onsubmit()}
  >
    {#if waiting}<LoaderCircle size={16} strokeWidth={2.25} class="spinner" />{:else}<ArrowUp size={16} strokeWidth={2.25} />{/if}
  </button>
  {/if}
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

  .context-control { display: flex; flex: none; margin-inline-start: auto; }

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
  /* The two groups read as one row. */
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
  /* Send in words (Answer, Decline and send): the family's button, send's round ends and height. */
  .worded { flex: none; height: 32px; padding: 0 14px; border-radius: var(--radius-full); font-size: var(--text-sm); font-weight: 500; }
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
  /* A desktop composer under 520 px, too narrow for "Effort High" and the mode's
     words beside the model, keeps the effort and mode chips to their icons and
     tooltips: the words would wrap the row and drop send half a row below the
     chips. A phone's chips keep their words. */
  @media (min-width: 721px) {
    @container composer (max-width: 520px) {
      .chips :global(:is(.effort, .permission) > .trigger > .ui-label) { display: none; }
      .bar .chips :global(:is(.effort, .permission) > .trigger) { padding: 0 9px; }
    }
    /* Under that the row never wraps: a wrapped chip took a row of its own between the field and the buttons,
       starting past the "+". The model is the one value with words left, so it is the one that gives: its name
       ends in an ellipsis (its menu says it whole) and the icon chips keep their size. */
    @container composer (max-width: 520px) {
      .chips { flex-wrap: nowrap; }
      .chips > :global(*) { flex: none; }
      .chips :global(.picker) { flex: 0 1 auto; min-width: 0; }
      .chips :global(.picker > .trigger) { min-width: 0; max-width: 100%; }
      .chips :global(.picker > .trigger > .label) { min-width: 0; }
      .chips :global(.picker > .trigger > svg) { flex: none; }
    }
    /* Narrower still, every chip drops its chevron and the model's name keeps what they gave back. */
    @container composer (max-width: 380px) {
      .chips { gap: 2px; }
      .chips :global(:is(.picker, .effort, .permission) > .trigger > .lucide-chevron-down) { display: none; }
      .chips :global(.picker > .trigger) { padding-right: 10px; }
      .chips :global(.picker > .trigger .account) { display: none; }
    }
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
    .tools { position: absolute; right: 4px; bottom: calc(100% - 2px); gap: 0; }
    /* 40 px drawn inside its 44 px target: reads like a true phone action button
       while keeping the exact 44 px outer footprint at the field's end. */
    .tools :is(.send, .stop) { position: relative; width: 40px; height: 40px; min-width: 0; min-height: 0; margin: 2px; }
    .tools :is(.send, .stop)::after { content: ''; position: absolute; inset: -3px; border-radius: inherit; }
    /* The words at the field's end, 40 px drawn in a 44 px target; the field's text stops short of them. */
    .tools .worded { position: relative; height: 40px; margin: 2px; padding: 0 14px; font-size: var(--text-base); }
    .tools .worded::after { content: ''; position: absolute; inset: -2px 0; }
    :global(.composer-wrap .composer:has(.bar .tools[data-worded][data-count='1'])) { --composer-tools: 10.5rem; }
    :global(.composer-wrap .composer:has(.bar .tools[data-worded][data-count='2'])) { --composer-tools: calc(10.5rem + var(--touch-target)); }
    :global(.composer-wrap .composer:has(.bar .tools[data-worded=answer][data-count='1'])) { --composer-tools: 6.5rem; }
    :global(.composer-wrap .composer:has(.bar .tools[data-worded=answer][data-count='2'])) { --composer-tools: calc(6.5rem + var(--touch-target)); }
    /* One row under the field: the model, the effort and the permission beside
       the "+", the context reading at its end when it shows. The chevrons go,
       a chip's hairline already says it opens, and the model is the one value
       that gives: its name ends in an ellipsis before a chip leaves the row
       (its menu says it whole). Only what still cannot fit, a long effort
       beside a notice, wraps onto a second row of 44 px targets. The row
       starts 8 px down: a chip now sits under the field's microphone and
       send, and their 44 px targets must not meet. */
    .chips { flex: 1; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px 6px; min-width: 0; min-height: var(--touch-target); padding-block: 8px 4px; }
    .bar > :global(.options) { align-self: flex-start; }
    .chips :global(*) { max-width: 100%; }
    .chips > .line > :global(*) { flex: none; }
    /* Counted at its floor when the row is laid out, then grown back to its name's width; a name
       shorter than the floor is counted at its own width, not followed by the floor's empty rest. */
    .chips > .line > :global(.picker) { flex: 1 1 76px; min-width: 0; max-width: max-content; }
    .chips :global(:is(.picker, .effort, .permission) > .trigger > :is(.chevron, .lucide-chevron-down)) { display: none; }
    /* Each setting reads as a finger-friendly pill at rest: 40 px drawn in a 44 px target. */
    .bar .chips :global(:is(.picker, .effort, .permission) > .trigger) {
      position: relative;
      height: 40px;
      padding: 0 8px;
      gap: 4px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-full);
      background: color-mix(in oklab, var(--color-foreground) 4%, transparent);
      font-size: var(--text-sm);
    }
    .bar .chips :global(:is(.picker, .effort, .permission) > .trigger)::after { content: ''; position: absolute; inset: -2px 0; }
    .chips :global(.picker > .trigger) { min-width: var(--touch-target); max-width: 100%; }
    .chips :global(.picker > .trigger > .label) { min-width: 0; max-width: none; }
    .chips :global(.picker > .trigger > svg) { flex: none; }
    .bar .chips :global(.picker > .trigger.connect) { padding: 0 14px; background: var(--color-active); color: var(--color-foreground); }
  }
  /* A 360 px phone: the "+" takes a 32 px column, its 44 px target kept by
     the icon button's hit zone. */
  @media (max-width: 379px) {
    .bar { gap: 0; padding-inline: 4px; }
    .chips { gap: 8px 4px; }
    .bar .chips :global(:is(.picker, .effort, .permission) > .trigger) { padding: 0 7px; gap: 4px; }
    .bar :global(.options .opener) { margin-inline: -2px; }
    /* The bolt says effort: its word goes so the model's name stays whole. */
    .chips :global(.effort > .trigger .name) { display: none; }
  }
</style>
