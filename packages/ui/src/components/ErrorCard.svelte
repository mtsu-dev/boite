<script lang="ts">
  import { ChevronRight, CircleAlert, RotateCcw } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { FailedCall } from '../lib/one-status';
  import type { Snippet } from 'svelte';
  import Notice from './Notice.svelte';

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
  /** The failed call's exit code and log, when it has either. */
  const callText = $derived(call ? [call.exitCode !== null ? fill(strings.chat.toolExitCode, { code: String(call.exitCode) }) : '', call.output ?? ''].filter(Boolean).join('\n') : '');
  const detailed = $derived(kind !== 'other' || message.includes('\n') || message.length > 240 || callText !== '');
</script>

{#snippet act()}
  {#if reconnect}
    <button type="button" class="small" data-testid="error-reconnect" onclick={reconnect}><span class="ui-label">{strings.connect.reconnect}</span></button>
  {:else if retry}
    <button type="button" class="small" data-testid="error-retry" onclick={retry}><RotateCcw /><span class="ui-label">{strings.chat.retry}</span></button>
  {/if}
{/snippet}

<!-- The one notice form (Notice.svelte): the danger mark, what it means, the cause, one action; the technical part folded under them. -->
<Notice icon={CircleAlert} tone="danger" testid="error-part" {title} meta={status} detail={description} ids={{ title: 'error-title', meta: 'error-code', detail: 'error-description' }} actions={reconnect || retry ? act : undefined}>
  {#if history}
    <span class="fold">{@render history()}</span>
  {:else if detailed}
    <details class="fold">
      <summary><ChevronRight size={13} strokeWidth={1.75} /><span class="ui-label">{strings.chat.errorDetails}</span></summary>
      <pre data-testid="error-diagnostic">{message}{#if callText}{'\n\n'}{callText}{/if}</pre>
    </details>
  {/if}
</Notice>

<style>
  .fold { display: block; min-width: 0; margin-top: 2px; }
  summary { display: flex; align-items: center; gap: 5px; width: fit-content; min-height: var(--control-sm); color: var(--color-muted-foreground); font-size: var(--text-xs); cursor: pointer; list-style: none; border-radius: var(--radius-sm); }
  summary::-webkit-details-marker { display: none; }
  summary:hover { color: var(--color-foreground); }
  summary :global(svg) { flex: none; transition: transform var(--dur-2) var(--ease-out-quint); }
  details[open] summary :global(svg) { transform: rotate(90deg); }
  /* The log on the page's own ground, no second frame inside the notice. */
  pre { margin: 6px 0 0; padding: 10px 12px; border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-muted-foreground); font-family: var(--font-mono); font-size: var(--text-xs); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  @media (max-width: 720px) {
    summary { min-height: var(--control-touch); }
  }
</style>
