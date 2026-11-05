<script lang="ts">
  import { ArrowUp, GitBranch, LoaderCircle, Mic, MicOff, Paperclip, Plus, Square } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { effectiveCompaction, type PermissionMode, type ProviderSummary } from '@boite/contracts';
  import { formatTokens, providerName } from '../lib/format';
  import { confirm } from '../lib/confirm.svelte';
  import { switchDropsHistory, switchResetsCache, type CacheKey } from '../lib/switch-warning';
  import { modeHint, modeIcon, modeLabel, modesFor, shownMode } from '../lib/permission-modes';
  import { fill, strings } from '../lib/strings';
  import type { Choice, PickPatch, Store } from '../lib/store.svelte';
  import type { MenuItem } from '../lib/menu';
  import EffortSlider from './EffortSlider.svelte';
  import Menu from './Menu.svelte';
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
  import type { ComposerTarget } from '../lib/composer-target';
  import { desktopSettings } from '../lib/settings-tabs';

  /**
   * The row under the composer's box: + (attach, the separate copy, and
   * dictation once the box has text), the model, effort and mode chips (all
   * folded into Options on a phone), then one slot that holds the microphone
   * while the box is empty and Send once it has something to send, with stop
   * right before Send.
   * A pick on a thread is saved at once, after the switch warnings; on a
   * draft the whole choice is remembered. `choice`, `picking` and `dictating`
   * are the composer's, bound here. An agent's box (`target`) keeps stop,
   * attach, dictation and send; its model chips save the agent's own setting,
   * and a group's box shows its recipients in their place.
   */
  let {
    store,
    key,
    target = null,
    bot = null,
    provider,
    canSend,
    empty = false,
    waiting = false,
    answering = false,
    sendLabel,
    choice = $bindable(),
    picking = $bindable(),
    dictating = $bindable(),
    onsubmit,
    onfiles,
    onpreview,
    ontranscript
  }: {
    store: Store;
    /** The open thread's id, or the draft's stash key. */
    key: string;
    target?: ComposerTarget | null;
    /** The persistent agent this box writes to, by name: its model, effort and mode are its settings, so the bar shows no chips. */
    bot?: string | null;
    provider: ProviderSummary | null | undefined;
    canSend: boolean;
    /** Nothing typed, attached or referenced: the send slot holds the microphone. */
    empty?: boolean;
    /** Send was pressed while files were still being read: it goes once they are ready. */
    waiting?: boolean;
    answering?: boolean;
    /** What Send does, when it answers a question rather than sending a message. */
    sendLabel?: string | undefined;
    choice: Choice | null;
    picking: boolean;
    dictating: boolean;
    onsubmit: () => void;
    onfiles: (files: File[]) => void;
    onpreview: (text: string, status: string, error: boolean) => void;
    ontranscript: (transcript: string) => void;
  } = $props();

  let picker = $state<HTMLInputElement | undefined>(undefined);
  // Read here, not as the prop's default, so a language switch reaches it.
  let sendText = $derived(sendLabel ?? strings.composer.send);
  let bar = $state<HTMLDivElement | undefined>(undefined);

  let bound = $derived(!target && store.openThread !== null);
  // Keep the stored visibility preference and reveal a nearly full context.
  let showContext = $derived(work.shows('header.context') || contextLevel(store.openThread?.context ? contextPercent(store.openThread.context, store.settings ? effectiveCompaction(store.settings, store.openThread).autoCompact : null) : null) === 'full');
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
  /** The mode's hint, then the old name it had, so a habit still finds it. */
  function modeTitle(mode: PermissionMode): string {
    const was = strings.permissionModeWas[mode];
    return was && was !== modeLabel(mode, provider) ? `${modeHint(mode, provider)}. ${fill(strings.permissionModeWas.line, { name: was })}` : modeHint(mode, provider);
  }
  let stopShown = $derived(!!(target ? target.busy && target.stop : store.busy));
  let modeItems = $derived(
    modes.map((mode) => ({
      id: mode,
      label: modeLabel(mode, provider),
      // The name, what it lets through on the line under it, and on hover the name it had before.
      hint: modeHint(mode, provider),
      title: modeTitle(mode),
      glyph: modeIcon(mode),
      active: displayedMode === mode
    }))
  );
  // The worktree switch exists where the core can honour it: a draft on a
  // folder the core found a `.git` in. No answer yet, or an older core that
  // never gives one, is no repository: a switch the core would refuse is noise.
  let draftRepository = $derived(
    !target && work.shows('composer.worktree') && store.draft && !store.draftInDrafts ? store.projects.find((project) => project.id === store.draft?.projectId)?.repository === true : false
  );

  let worktreeShown = $derived(!target && !!store.draft && draftRepository);
  /**
   * The user's own box shares one slot between the microphone and Send on a
   * desktop: the microphone while the box is empty and no turn runs, and while
   * it records, since it is then the Finish button; Send once there is text.
   * Stop holds the end alone while a turn runs on an empty box. An agent's box
   * and an answer keep both. The phone's row keeps its own layout.
   */
  let slotted = $derived(!answering && !target);
  let micShown = $derived(voice.current.enabled && (!slotted || dictating || (empty && !stopShown)));
  let moreItems = $derived.by((): MenuItem[] => [
    ...(canAttach ? [{ id: 'attach', label: strings.composer.attach, glyph: Paperclip }] : []),
    // With text in the box the microphone leaves the slot: it is one press away here.
    ...(voice.current.enabled && !micShown ? [{ id: 'dictate', label: strings.speech.start, glyph: Mic }] : []),
    ...(worktreeShown ? [{ id: 'worktree', label: strings.composer.worktree, title: store.draft?.worktree ? strings.composer.worktreeOn : strings.composer.worktreeOff, glyph: GitBranch, checked: !!store.draft?.worktree }] : []),
  ]);
  function pickMore(id: string) {
    if (id === 'attach') picker?.click();
    else if (id === 'dictate') bar?.querySelector<HTMLElement>('[data-testid="dictation-start"]')?.click();
    else if (id === 'worktree') store.setDraftWorktree(!store.draft?.worktree);
  }

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

  function pickEffort(id: string | null) {
    pick({ effort: id });
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

  /** The chip's own trigger opens its menu: one popover, owned by one component. */
  export async function openChip(testid: string) {
    await tick();
    const composer = bar?.closest('[data-testid="composer"]');
    if (window.matchMedia('(max-width: 720px)').matches && testid !== 'composer-picker') testid = 'composer-options';
    composer?.querySelector<HTMLElement>(`[data-testid="${testid}"]`)?.click();
  }
</script>

<svelte:window onstorage={(event) => { if (event.key === VOICE_STORAGE_KEY || event.key === null) voice.load(); }} />

<div class="bar" class:answering class:direct={!!target} bind:this={bar}>
  {#if target && !target.selection}
  <div class="chips">{#if target.chips}{@render target.chips()}{/if}</div>
  {:else if bot !== null || answering}
  <!-- A bot's box, or an answer: + keeps the attachment on the left as in every composer, nothing else to pick here. -->
  {#key `${key}:${store.draft?.projectId ?? ''}`}
  {#if !answering || canAttach}
  <ComposerOptions busy={picking} levels={[]} effort={null} agentDefault={false} speeds={[]} speed={null} modes={[]} modeLabel={(mode) => modeLabel(mode, provider)} modeHint={(mode) => modeHint(mode, provider)} mode={displayedMode} worktree={null} {canAttach} onattach={() => picker?.click()} oneffort={pickEffort} onspeed={(speed) => void pick(speedOptions.pick(speed))} onmode={pickMode} onworktree={() => {}} />
  {/if}
  {/key}
  {#if (slotted || answering) && moreItems.length > 0}
  <div class="more">
    <Menu items={moreItems} onpick={pickMore} label={strings.composer.more} testid="composer-plus" variant="ghost" switches={worktreeShown}>
      <Plus size={16} strokeWidth={1.75} />
    </Menu>
  </div>
  {/if}
  <!-- The chips' room, empty, so the tools keep their place at the end of the row on both widths. -->
  <div class="chips" aria-hidden="true"></div>
  {:else if !answering}
  {#key `${key}:${store.draft?.projectId ?? ''}`}
  <ComposerOptions busy={picking} levels={effortLevels} effort={activeEffort} {agentDefault} {speeds} speed={speedOptions.speed} {modes} modeLabel={(mode) => modeLabel(mode, provider)} modeHint={(mode) => modeHint(mode, provider)} mode={displayedMode} worktree={store.draft && draftRepository ? store.draft.worktree : null} {canAttach} onattach={() => picker?.click()} oneffort={pickEffort} onspeed={(speed) => void pick(speedOptions.pick(speed))} onmode={pickMode} onworktree={() => store.setDraftWorktree(!store.draft?.worktree)} />
  {/key}
  {#if slotted && moreItems.length > 0}
  <div class="more">
    <Menu items={moreItems} onpick={pickMore} label={strings.composer.more} testid="composer-plus" variant="ghost" switches={worktreeShown}>
      <Plus size={16} strokeWidth={1.75} />
    </Menu>
  </div>
  {/if}
  <div class="chips">
    <ModelPicker {store} {choice} disabled={picking} onpick={pick} />
    {#if signedOut && store.owner}
      <button type="button" class="chip signed-out" data-testid="composer-reconnect" title={fill(strings.connect.signedOut, { provider: provider?.name ?? '' })} onclick={() => store.openConnect(signedOut.providerId, signedOut.id)}><span class="ui-label">{strings.connect.reconnect}</span></button>
    {/if}
    {#if providerOff}
      {@const sentence = fill(strings.providerSettings.threadOff, { provider: providerOff.name })}
      {#if providersReachable}
        <button type="button" class="chip signed-out" data-testid="composer-provider-off" title={sentence} aria-label={sentence} onclick={() => store.showSettings('accounts')}><span class="ui-label">{strings.providerSettings.off}</span></button>
      {:else}
        <span class="chip signed-out" data-testid="composer-provider-off" title={sentence} aria-label={sentence}><span class="ui-label">{strings.providerSettings.off}</span></span>
      {/if}
    {/if}
    {#if accountRemoved}
      <button type="button" class="chip signed-out" data-testid="composer-account-removed" title={strings.accounts.removedHint} onclick={() => void openChip('composer-picker')}><span class="ui-label">{strings.accounts.removed}</span></button>
    {/if}

    <div class="desktop-options">
    {#if effortLevels.length > 0 || speeds.length > 0}
      <EffortSlider levels={effortLevels} active={activeEffort} onpick={pickEffort} ondefault={agentDefault ? () => pickEffort(null) : undefined} {speeds} speed={speedOptions.speed} onspeed={(speed) => void pick(speedOptions.pick(speed))} />
    {/if}

    <!-- A thread keeps its directory, so the switch exists on a draft alone. It is
         turned on from +; once on, this chip says so, and a press turns it off. -->
    {#if worktreeShown && store.draft?.worktree}
      <button
        type="button"
        class="chip worktree on"
        data-testid="composer-worktree"
        title={strings.composer.worktreeOn}
        aria-label={strings.composer.worktree}
        aria-pressed="true"
        onclick={() => store.setDraftWorktree(false)}
      >
        <GitBranch size={14} strokeWidth={1.75} />
        <span class="ui-label">{strings.composer.worktree}</span>
      </button>
    {/if}

    {#if modes.length > 0}
      <Menu items={modeItems} onpick={pickMode} label={strings.composer.mode} testid="composer-mode" align="end" variant="ghost">
        {@const ModeIcon = modeIcon(displayedMode)}
        <span class="mode-icon"><ModeIcon size={14} strokeWidth={1.75} /></span>
        <span class="ui-label" title={modeTitle(displayedMode)}>{modeLabel(displayedMode, provider)}</span>
      </Menu>
    {/if}
    </div>
  </div>
  {/if}
  {#if bound && showContext && !answering}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="context-control" oncontextmenu={(event) => controlMenu(event, store, 'header.context')}><ContextControl {store} /></div>
  {/if}
    {#if canAttach}
      {#if !slotted && !answering}
      <button
        type="button"
        class="icon attach"
        data-testid="composer-attach"
        title={strings.composer.attach}
        aria-label={strings.composer.attach}
        onclick={() => picker?.click()}
      >
        <Paperclip size={16} strokeWidth={1.75} />
      </button>
      {/if}
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
  <span class="mic" class:tucked={!micShown}>
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
  </span>
  {/if}
  <!-- Stop sits beside Send, never among the tools: alone at the end while it works, Send joins it once the box has something to send. -->
  {#if stopShown}
    <button type="button" class="icon stop" data-testid="composer-stop" title={strings.composer.stop} aria-label={strings.composer.stop} onmousedown={keepFocus} onclick={() => { if (target) target.stop?.(); else void store.stop(); }}>
      <Square size={12} strokeWidth={2.5} />
    </button>
  {/if}
  {#if !stopShown || canSend || waiting || answering}
  <button
    type="button"
    class="primary icon send"
    class:tucked={slotted && micShown}
    data-testid="composer-send"
    data-waiting={waiting || undefined}
    title={waiting ? strings.composer.sendWhenLoaded : sendText}
    aria-label={waiting ? strings.composer.sendWhenLoaded : sendText}
    disabled={!canSend}
    onmousedown={keepFocus}
    onclick={() => onsubmit()}
  >
    {#if waiting}<LoaderCircle size={16} strokeWidth={2.25} class="spinner" />{:else}<ArrowUp size={16} strokeWidth={2.25} />{/if}
    {#if answering}<span class="ui-label">{sendText}</span>{/if}
  </button>
  {/if}
</div>

<style>
  .dictation-stand-in { display: flex; align-items: center; flex: none; }
  .dictation-stand-in button { flex: none; width: var(--control); height: var(--control); }
  .dictation-stand-in.failed button { color: var(--color-danger); }
  /* The button in the chip bar is what opens it; the field itself never shows. */
  .file {
    display: none;
  }

  .context-control { flex: none; }

  /* The microphone's own box lays out as the bar's child, so a tucked one leaves no gap. */
  .mic { display: contents; }
  .more { display: flex; flex: none; }
  .more :global(.trigger.ghost) { width: 28px; height: 28px; padding: 0; justify-content: center; border-radius: var(--radius-full); color: var(--color-muted-foreground); }
  .more :global(.trigger.ghost:hover), .more :global(.trigger.ghost[aria-expanded='true']) { background: var(--color-hover); color: var(--color-foreground); }
  /* The slot: one of the microphone and Send. A failed dictation keeps its
     microphone, since its panel (retry, settings) hangs from it. */
  @media (min-width: 721px) {
    .send.tucked, .mic.tucked :global(.dictation[data-phase='idle']), .mic.tucked .dictation-stand-in { display: none; }
    .mic :global(.microphone), .mic .dictation-stand-in button { border-radius: var(--radius-full); }
  }

  .mode-icon { display: inline-flex; }
  .chip.signed-out { color: var(--color-live); }

  .worktree.on {
    background: var(--control-glaze) var(--color-active);
    border-color: var(--color-active);
    color: var(--color-foreground);
  }

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
  .desktop-options { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }

  /* 28 px chips: the surface step marks them, no outline on top of it. */
  .chips :global(.trigger), .chips .worktree {
    height: 28px;
    padding: 0 11px;
    gap: 7px;
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .chips :global(.trigger) {
    border-color: transparent;
    background: var(--control-glaze) var(--color-control-surface);
    color: var(--color-foreground);
  }

  .chips :global(.trigger.ghost) {
    width: auto;
    border-color: transparent;
    background: transparent;
    color: var(--color-muted-foreground);
    font-weight: 400;
  }

  .chips :global(.trigger.ghost:hover),
  .chips :global(.trigger.ghost[aria-expanded='true']) {
    background: var(--color-hover);
    color: var(--color-foreground);
  }

  /* Nothing to pick yet: the one chip that gets somewhere wears the accent. */
  .chips :global(.trigger.connect) {
    border-color: transparent;
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }

  .chips :global(.trigger:hover) {
    background: var(--control-glaze) var(--color-control-hover);
  }


  .send,
  .stop {
    margin-left: auto;
    width: var(--control);
    height: var(--control);
    border-radius: var(--radius-full);
    flex: none;
  }

  .send:not(:disabled):active { transform: scale(.92); }
  .send :global(.spinner) { animation: spin var(--dur-spin) linear infinite var(--loops); }
  @media (prefers-reduced-motion: reduce) { .send :global(.spinner) { animation: none; } }
  /* An answer: + on the left, the empty chips' room, then the tools and Send with its words. */
  .answering .stop, .answering .send { margin-left: 0; }
  .answering .send { width: auto; padding-inline: 12px; }
  .direct .attach { display: inline-flex; }

  /* One action set in every composer: the microphone and stop are the same
     ghost circle, 32 px (36 on a phone); Send alone is filled. A recording
     microphone keeps its tint, it is then the Finish button. */
  .bar .stop, .bar .mic :global(.dictation button.microphone), .bar .mic .dictation-stand-in button {
    width: 32px; height: 32px; min-width: 32px; min-height: 32px; padding: 0; border-radius: var(--radius-full);
  }
  /* `:not(.ghost)` outweighs app.css's raised-control shadow on a filled icon button. */
  .bar button.stop:not(.ghost), .bar .mic :global(.dictation button.microphone:not(.listening):not(.ghost)), .bar .mic .dictation-stand-in button:not(.ghost) {
    border-color: transparent; background: transparent; box-shadow: none; color: var(--color-foreground);
  }
  .bar .stop:hover:not(:disabled), .bar .mic :global(.dictation button.microphone:not(.listening):hover:not(:disabled)) {
    background: var(--color-hover);
  }
  .bar .mic .dictation-stand-in.failed button { color: var(--color-danger); }

  /* Each mode's description stays one line under its name: the menu grows to the longest, up to the window. */
  .desktop-options :global([data-testid='composer-mode-menu']) { width: max-content; max-width: min(440px, calc(100vw - 24px)); }
  .desktop-options :global([data-testid='composer-mode-menu'] .hint) { white-space: nowrap; }

  /* A composer the side panel narrowed keeps its tools on one row: the account
     goes first, then the effort, worktree and mode chips keep only their icons and
     tooltips. */
  @container composer (max-width: 600px) {
    /* The model's name gives way first; the effort beside it stays whole. */
    .chips { flex-wrap: nowrap; }
    .desktop-options { flex: none; }
    .chips :global(.picker) { min-width: 0; }
    .chips :global(.picker > .trigger .account-name) { display: none; }
  }
  @container composer (max-width: 480px) {
    .bar { gap: 6px; }
    .desktop-options :global(.trigger > .ui-label), .desktop-options .worktree > .ui-label { display: none; }
    .desktop-options :global(.trigger), .desktop-options .worktree { padding: 0 9px; }
  }

  @media (max-width: 720px) {
    .bar { gap: 2px; padding: var(--composer-bar-padding, 0 8px 6px); }
    .desktop-options, .attach, .more { display: none; }
    .chips { flex: 1; flex-wrap: nowrap; }
    .chips :global(.picker) { min-width: 0; max-width: 100%; }
    /* A capsule of fill, as on the desktop: no outline, no top highlight. */
    .chips :global(.picker > .trigger) { min-width: 0; max-width: 100%; height: var(--touch-target); padding: 0 12px; gap: 5px; border: 1px solid transparent; border-radius: var(--radius-full); box-shadow: none; background: var(--color-control-surface); font-weight: 500; color: var(--color-foreground); }
    /* The model's name alone, and whole words of it: one line high, a name too long for the row
       wraps its last words onto a second line nobody sees, never half of one. */
    .chips :global(.picker > .trigger > .label) { min-width: 0; max-width: none; height: 1lh; padding-block: 0; margin-block: 0; text-box: normal; overflow: hidden; white-space: normal; overflow-wrap: normal; }
    .chips :global(.picker > .trigger > .label > span) { white-space: normal; text-box: normal; }
    .chips :global(.picker > .trigger .account-name) { display: none; }
    .chips :global(.picker > .trigger.connect) { padding: 0 12px; border-radius: var(--radius-full); background: var(--color-accent-soft); color: var(--color-accent); }
    .send, .stop { margin-left: 2px; }
    .bar .stop, .bar .mic :global(.dictation button.microphone), .bar .mic .dictation-stand-in button { width: 36px; height: 36px; min-width: 36px; min-height: 36px; }
  }
  /* The chip has 162 px beside Stop at 390 px and 132 px at 360, where
     ModelPicker drops the chevron so "Sonnet 5.5" reads whole after its logo.
     "Choisir un modèle" is 112 px at 13 px: it fits after the logo at 390 and
     alone, the logo dropped too, at 360. */
  @media (max-width: 380px) {
    .chips :global(.picker > .trigger.asking) { padding: 0 8px; }
  }
</style>
