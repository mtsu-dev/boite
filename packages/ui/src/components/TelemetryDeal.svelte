<script lang="ts">
  import { lockedBy } from '../lib/policy';
  import type { TelemetryState } from '@boite/contracts';
  import type { Snippet } from 'svelte';
  import tradeOffer from '../assets/onboarding/trade-offer.webm';
  import noThanks from '../assets/onboarding/no-thanks.webm';
  import InfoTip from './InfoTip.svelte';
  import PolicyLock from './PolicyLock.svelte';
  import { openExternal } from '../lib/links';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * Boite Legacy's consent screen: the trade offer meme, one row per tier, and
   * picking a row ends the tour. "Enough" keeps the anonymous counters, so the
   * note under both rows carries the full opt-out, one click like the rows.
   */
  let { store, onchosen, heading }: { store: Store; onchosen: () => void; heading?: Snippet } = $props();

  const DOC_URL = 'https://github.com/mtsu-dev/boite/blob/main/docs/privacy.md';
  /** How long the refusal clip plays before the tour closes. */
  const REFUSAL_MS = 2000;
  const reduced = document.documentElement.dataset.motion === 'reduced' || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  let consent = $state<TelemetryState | null>(null);
  /** The admin policy's ceiling: `off` locks both rows, `basic` the deal. */
  const ceiling = $derived(lockedBy(store.policy, 'analytics') ? store.policy?.values.analytics ?? null : null);
  /** The client `consent` came from: a reconnect swaps it without re-running the read. */
  let consentFrom: Store['client'] = null;
  let busy = $state(false);
  let refusing = $state(false);
  let error = $state('');
  let clip = $state<HTMLVideoElement>();
  let clipSize = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(timer));
  // The meme plays like a GIF, reduced motion or not, and only while the window is shown.
  $effect(() => {
    const video = clip;
    if (!video) return;
    const update = () => { if (document.visibilityState === 'visible') void video.play().catch(() => {}); else video.pause(); };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  });

  $effect(() => {
    const client = store.client;
    // Another machine's saved mode says nothing about this one.
    consent = null;
    if (!client || !store.owner) return;
    let active = true;
    void store.telemetryState().then(value => { if (active) { consent = value; consentFrom = client; } })
      .catch(reason => { if (active) error = String(reason); });
    return () => { active = false; };
  });

  async function choose(mode: TelemetryState['mode'], countChoice = true): Promise<boolean> {
    const client = store.client;
    if (!client) return false;
    busy = true; error = '';
    try { consent = await store.configureTelemetry(mode, countChoice); consentFrom = client; return store.client === client; }
    catch (reason) { if (store.client === client) error = String(reason); return false; }
    finally { busy = false; }
  }

  /** The saved mode of the client connected now, read again when it changed since. */
  async function savedMode(): Promise<TelemetryState['mode'] | null> {
    const client = store.client;
    if (!client) return null;
    if (consent && consentFrom === client) return consent.mode;
    busy = true; error = '';
    try {
      const value = await store.telemetryState();
      if (store.client !== client) return null;
      consent = value; consentFrom = client;
      return value.mode;
    } catch (reason) { if (store.client === client) error = String(reason); return null; }
    finally { busy = false; }
  }

  async function enough() {
    // Until the saved mode is known, "enough" could write basic over an opt-out.
    if (busy || refusing || !consent) return;
    const saved = await savedMode();
    if (!saved) return;
    // A replay never turns counters back on after a saved opt-out.
    if (!await choose(saved === 'off' ? 'off' : 'basic', saved !== 'off')) return;
    if (reduced) { onchosen(); return; }
    // The clip swaps at the size the first one had, so the rows do not jump.
    const box = clip?.getBoundingClientRect();
    if (box && box.width > 0) clipSize = `width:${box.width}px;height:${box.height}px`;
    refusing = true;
    timer = setTimeout(onchosen, REFUSAL_MS);
  }

  async function deal() {
    if (busy || refusing) return;
    if (await choose('enhanced')) onchosen();
  }

  async function off() {
    if (busy || refusing) return;
    if (await choose('off')) onchosen();
  }
</script>

<!--
  Wide: the meme and what it means on the left, the offer on the right, title
  first. Narrow: one column, the title still first.
-->
<div class="deal" data-testid="telemetry-deal">
  <div class="layout">
    {#if heading}<div class="heading">{@render heading()}</div>{/if}
    <div class="pitch">
      {#key refusing}
        <video class="clip" bind:this={clip} src={refusing ? noThanks : tradeOffer} aria-label={strings.onboarding.privacy.video}
          autoplay loop muted playsinline disablepictureinpicture preload="auto" style={clipSize || undefined}></video>
      {/key}
      <p class="intro">{strings.onboarding.privacy.intro}</p>
    </div>
    <div class="offer">
      <p class="question">{strings.onboarding.privacy.question}<InfoTip topic={strings.onboarding.privacy.doc} text={strings.onboarding.privacy.details} testid="onboarding-telemetry-details" /></p>
      <div class="rows">
        <button class="row no" class:refused={refusing} disabled={busy || refusing || !consent || ceiling === 'off'} data-testid="onboarding-telemetry-basic" onclick={() => void enough()}>
          <span class="label">{strings.onboarding.privacy.basic}<small>{strings.onboarding.privacy.basicDefault}</small></span>
          <span class="hint">{strings.onboarding.privacy.basicHint}</span>
        </button>
        <button class="row yes" disabled={busy || refusing || ceiling !== null} data-testid="onboarding-telemetry-enhanced" onclick={() => void deal()}>
          <span class="label">{strings.onboarding.privacy.deal}</span>
          <span class="hint">{strings.onboarding.privacy.dealHint}</span>
        </button>
      </div>
      {#if consent?.configured !== false}
        <p class="fine" data-testid="telemetry-choice-notice">{strings.telemetry.choiceNotice}</p>
      {/if}
      {#if ceiling !== null}<p class="note managed" data-testid="onboarding-telemetry-managed">{strings.policy.managed}<PolicyLock {store} keys={['analytics']} /></p>{/if}
      <p class="note">{strings.onboarding.privacy.optOut}
        <button class="link" disabled={busy || refusing} data-testid="onboarding-telemetry-off" onclick={() => void off()}><span class="ui-label">{strings.onboarding.privacy.offLabel}</span></button></p>
      <button class="link doc" disabled={refusing} onclick={() => void openExternal(DOC_URL)}><span class="ui-label">{strings.onboarding.privacy.doc}</span></button>
      {#if error}<p role="alert">{error}</p>{/if}
    </div>
  </div>
</div>

<style>
  .deal { flex: 1; min-height: min-content; display: flex; flex-direction: column; justify-content: center; margin-top: 8px; container-type: inline-size; }
  /* Narrow: one column in reading order, the title first and centred like a meme's caption. */
  .layout { display: flex; flex-direction: column; gap: 12px; }
  .heading { text-align: center; }
  .pitch { display: flex; align-items: center; gap: 14px; }
  .offer { display: flex; flex-direction: column; gap: 10px; }
  p { margin: 0; }
  .clip { display: block; flex: none; max-width: 34%; max-height: min(18vh, 120px); border-radius: var(--radius-lg); animation: swap var(--dur-3) var(--ease-out-quint); }
  .intro { flex: 1; min-width: 0; color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 1.6; }
  .question { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: var(--text-lg); font-weight: 800; }
  .rows { display: grid; gap: 8px; }
  .row { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; height: auto; padding: 10px 14px; white-space: normal; text-align: left; border-radius: var(--radius-lg); background: color-mix(in srgb, var(--color-surface-2) 88%, var(--color-foreground) 12%); color: var(--color-foreground); cursor: pointer; transition: transform var(--dur-1) ease-out, border-color var(--dur-2) ease-out, background var(--dur-2) ease-out, color var(--dur-2) ease-out, box-shadow var(--dur-2) ease-out; }
  .row:hover:not(:disabled) { transform: translateY(-1px); border-color: color-mix(in srgb, var(--color-foreground) 45%, var(--color-border)); }
  .row:disabled { opacity: .5; cursor: not-allowed; }
  .label { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 6px; font-size: var(--text-base); font-weight: 700; }
  .label small { font-size: var(--text-xs); font-weight: 500; color: var(--color-muted-foreground); }
  .hint { font-size: var(--text-sm); line-height: 1.5; text-wrap: pretty; color: var(--color-muted-foreground); }
  .no:hover:not(:disabled), .no:hover:not(:disabled) .hint { color: var(--color-danger); }
  .no:hover:not(:disabled) { background: color-mix(in srgb, var(--color-danger) 14%, var(--color-surface-2)); border-color: color-mix(in srgb, var(--color-danger) 55%, var(--color-border)); }
  .no.refused, .no.refused:disabled { opacity: 1; color: var(--color-on-danger); background: var(--color-danger); border-color: var(--color-danger); box-shadow: 0 10px 28px color-mix(in srgb, var(--color-danger) 35%, transparent); }
  .no.refused .hint, .no.refused small { color: inherit; }
  .yes { border-color: color-mix(in srgb, var(--color-foreground) 65%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-foreground) 18%, transparent), 0 6px 22px color-mix(in srgb, var(--color-foreground) 8%, transparent); }
  .yes .label { letter-spacing: .04em; }
  .yes:hover:not(:disabled) { transform: translateY(-2px); border-color: var(--color-foreground); box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-foreground) 45%, transparent), 0 14px 32px color-mix(in srgb, var(--color-foreground) 16%, transparent); }
  /* What the choice itself sends: shown, never hidden behind the tip, at the size of fine print. */
  .fine { color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 1.5; text-align: center; text-wrap: pretty; }
  .note { color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 1.5; text-align: center; }
  .link { align-self: center; height: auto; padding: 0; border: 0; background: transparent; color: var(--color-muted-foreground); font-size: var(--text-sm); text-decoration: underline; cursor: pointer; }
  .link:hover:not(:disabled) { color: var(--color-foreground); }
  [role=alert] { color: var(--color-danger); overflow-wrap: anywhere; }
  /*
   * Wide: two columns. The meme, at the size it was made, with the sentence
   * that explains it as its caption; beside it the title, the question, the two
   * offers stacked and the way out, all on one left edge.
   */
  @container (min-width: 520px) {
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: auto 1fr; column-gap: 24px; row-gap: 12px; align-items: start; }
    .heading { grid-column: 2; grid-row: 1; text-align: left; }
    .pitch { grid-column: 1; grid-row: 1 / span 2; flex-direction: column; align-items: stretch; gap: 12px; align-self: center; }
    .offer { grid-column: 2; grid-row: 2; }
    .clip { width: 100%; max-width: 100%; height: auto; max-height: none; aspect-ratio: 350 / 373; object-fit: cover; }
    .question { justify-content: flex-start; }
    .fine, .note { text-align: left; }
    .link { align-self: flex-start; }
  }
  @keyframes swap { from { opacity: 0; transform: scale(.96); } }
  /* A short window shrinks the clip, never the line that says what is counted. */
  @media (max-height: 640px) { .clip { max-height: 16vh; } .row { padding: 8px 14px; } }
  @media (max-height: 520px) { .clip { display: none; } }
  /* A finger needs the full touch target, the opt-out included, not the 20 px line of text it sits on. */
  @media (max-width: 720px) { .link { display: inline-flex; align-items: center; justify-content: center; min-height: var(--touch-target); padding: 0 8px; vertical-align: middle; } }
  @media (prefers-reduced-motion: reduce) { .clip { animation: none; } .row:hover:not(:disabled) { transform: none; } }
  :global(html[data-motion="reduced"]) .clip { animation: none; }
</style>
