<script lang="ts">
  import { ChevronRight, CircleAlert, RotateCcw } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { FailedCall } from '../lib/one-status';
  import type { Snippet } from 'svelte';

  /**
   * The one notice of a run that stopped: what it means in its title, the
   * cause in one sentence under it, then one action (Retry, or Reconnect) and
   * the technical details folded beside it: the agent's full message, and the
   * exit code and log of the command it stopped on (`call`). Nothing else in
   * the turn says it again. `retry` sends the turn's prompt again.
   */
  let { message, reconnect, retry, call = null, history }: { message: string; reconnect?: () => void; retry?: () => void; call?: FailedCall | null; history?: Snippet } = $props();

  // Prefer the specific refusal over the provider's generic server-error prefix.
  const code = /\b(?:API Error|HTTP(?: status)?|status)[\s:]+([45]\d{2})\b/i;
  const status = $derived(message.match(code)?.[1]);
  const kind = $derived(/\bno available subscription\b/i.test(message) ? 'subscription'
    : status === '429' || /\bToo Many Requests\b|\brate[_ ]limit(?:_exceeded|ed)?\b/i.test(message) ? 'rate'
    : status?.startsWith('5') || /returned a server error|\boverloaded_error\b|\bserverOverloaded\b/i.test(message) ? 'server' : 'other');
  const title = $derived(kind === 'subscription' ? strings.chat.errorSubscriptionTitle : kind === 'rate' ? strings.chat.errorRateTitle : kind === 'server' ? strings.chat.errorServerTitle : strings.chat.errorTitle);
  const description = $derived(kind === 'subscription' ? strings.chat.errorSubscriptionHint : kind === 'rate' ? strings.chat.errorRateHint : kind === 'server' ? strings.chat.errorServerHint : message.trim().split('\n')[0]);
  const detailed = $derived(kind !== 'other' || message.includes('\n') || message.length > 240 || call !== null);
</script>

<div class="error-card" data-testid="error-part">
  <div class="error-icon" aria-hidden="true"><CircleAlert size={18} strokeWidth={1.75} /></div>
  <div class="body">
    <div class="heading">
      <span class="title ui-label" data-testid="error-title">{title}</span>
      {#if status}<span class="code" title={`HTTP ${status}`}>{status}</span>{/if}
    </div>
    <p class="description" class:detailed data-testid="error-description">{description}</p>
    {#if reconnect || retry || history || detailed}
      <!-- The one action, then the fold that keeps the technical part out of the way. -->
      <div class="actions">
        {#if reconnect}
          <button type="button" class="quiet small reconnect" data-testid="error-reconnect" onclick={reconnect}><span class="ui-label">{strings.connect.reconnect}</span></button>
        {:else if retry}
          <button type="button" class="quiet small reconnect" data-testid="error-retry" onclick={retry}><RotateCcw size={13} strokeWidth={1.75} /><span class="ui-label">{strings.chat.retry}</span></button>
        {/if}
        {#if history}
          {@render history()}
        {:else if detailed}
          <details>
            <summary><ChevronRight size={13} strokeWidth={1.75} /><span class="ui-label">{strings.chat.errorDetails}</span></summary>
            <pre data-testid="error-diagnostic">{message}{#if call}{'\n\n'}{call.exitCode !== null ? `${fill(strings.chat.toolExitCode, { code: String(call.exitCode) })}\n` : ''}{call.output ?? ''}{/if}</pre>
          </details>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  /* Red on the status mark alone: the card and its words stay neutral, so a failure reads as a fact to act on, not an alarm. */
  .error-card { display: flex; align-items: flex-start; gap: 10px; padding: 14px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
  .error-icon { display: grid; place-items: center; flex: none; height: 22px; color: var(--color-danger); }
  .body { flex: 1; min-width: 0; }
  .heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 10px; min-height: 22px; }
  .title { color: var(--color-foreground); font-size: var(--text-sm); font-weight: 600; }
  .code { color: var(--color-muted-foreground); font-family: var(--font-mono); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .description { margin: 2px 0 0; color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 1.6; overflow-wrap: anywhere; }
  .description.detailed { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
  /* Retry and the fold's summary share one line; the open fold takes the card's width under them. */
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 8px; }
  .reconnect { gap: 6px; }
  .actions > :global(details) { min-width: 0; }
  .actions > :global(details[open]) { flex-basis: 100%; }
  summary { display: flex; align-items: center; gap: 5px; width: fit-content; min-height: var(--control-sm); color: var(--color-muted-foreground); font-size: var(--text-xs); cursor: pointer; list-style: none; border-radius: var(--radius-sm); }
  summary::-webkit-details-marker { display: none; }
  summary:hover { color: var(--color-foreground); }
  summary :global(svg) { flex: none; transition: transform var(--dur-2) var(--ease-out-quint); }
  details[open] summary :global(svg) { transform: rotate(90deg); }
  pre { margin: 8px 0 0; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-2); color: var(--color-muted-foreground); font-family: var(--font-mono); font-size: var(--text-xs); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  @media (max-width: 720px) {
    .error-card { padding: 12px; gap: 10px; }
    summary { min-height: var(--control-touch); }
  }
</style>
