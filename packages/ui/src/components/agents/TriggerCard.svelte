<script lang="ts">
  import { Check, Copy, Files, FlaskConical, GitPullRequest, Pencil, RotateCw, Trash2, Webhook, X } from '@lucide/svelte';
  import type { AgentTrigger } from '@boite/contracts';
  import { triggerWebhookUrl } from '../../lib/agent-trigger';
  import type { AgentsView } from '../../lib/agents.svelte';
  import { confirm } from '../../lib/confirm.svelte';
  import { copyText } from '../../lib/contacts.svelte';
  import { dateTime } from '../../lib/schedule';
  import { secureId } from '../../lib/secure-id';
  import { fill, strings } from '../../lib/strings';
  import SettingSwitch from '../SettingSwitch.svelte';

  let { view, trigger, compact, canEdit, secret, onedit, onsecret, ondismiss }: {
    view: AgentsView;
    trigger: AgentTrigger;
    compact: boolean;
    canEdit: boolean;
    secret: string | null;
    onedit: () => void;
    onsecret: (secret: string) => void;
    ondismiss: () => void;
  } = $props();
  const t = $derived(strings.agents.triggers);
  const icons = { webhook: Webhook, file: Files, pr: GitPullRequest };
  const Icon = $derived(icons[trigger.source.kind]);
  const last = $derived(trigger.lastFiredAt !== null && trigger.lastOutcome !== null
    ? fill(t.last, { state: t.outcomes[trigger.lastOutcome], when: dateTime(trigger.lastFiredAt) }) : null);
  const projectId = $derived(trigger.source.kind === 'webhook' ? null : trigger.source.projectId);
  const project = $derived(view.store.projects.find(candidate => candidate.id === projectId));
  const endpoint = $derived(trigger.webhookPath
    ? triggerWebhookUrl(trigger.webhookPath, view.store.endpointUrl, view.store.settings?.publicUrl ?? null, view.store.group, location.origin)
    : null);
  const isLocalEndpoint = $derived(endpoint !== null && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(endpoint));
  const address = $derived(endpoint ?? trigger.webhookPath);
  const addressLabel = $derived(endpoint ? t.endpoint : t.endpointPath);
  let endpointField = $state<HTMLInputElement>();
  let secretField = $state<HTMLInputElement>();
  let copied = $state<'endpoint' | 'secret' | null>(null);

  async function copy(field: 'endpoint' | 'secret', value: string, input?: HTMLInputElement) {
    copied = await copyText(value, input) ? field : null;
  }

  async function toggle() {
    await view.call('agents.trigger.save', { id: trigger.id, expectedRevision: trigger.revision, value: { ...trigger, enabled: !trigger.enabled } });
  }

  async function rotate() {
    const yes = await confirm.ask({ title: t.rotateTitle, body: t.rotateBody, confirmLabel: t.rotate, cancelLabel: strings.common.cancel, danger: true });
    if (!yes) return;
    const result = await view.call('agents.trigger.rotateSecret', { triggerId: trigger.id });
    if (result) { copied = null; onsecret(result.secret); }
  }

  async function remove() {
    const yes = await confirm.ask({ title: fill(t.deleteTitle, { name: trigger.name }), body: t.deleteBody, confirmLabel: strings.agents.remove, cancelLabel: strings.common.cancel, danger: true });
    if (!yes) return;
    if (await view.call('agents.trigger.remove', { triggerId: trigger.id }) && secret) ondismiss();
  }
</script>

<article class="trigger-card" class:compact class:card={!compact} class:routine-card={!compact} data-testid="trigger-{trigger.id}">
  <header>
    <span class="routine-icon" title={t.kinds[trigger.source.kind]}><Icon size={compact ? 14 : 16} strokeWidth={1.75} /></span>
    <div class="routine-text">
      <strong title={trigger.name}>{trigger.name}</strong>
      <span class="routine-when">{t.kinds[trigger.source.kind]}{#if project}{' · '}{project.name}{/if}</span>
      {#if trigger.watchUnavailable}<span class="trigger-last failed">{t.watchUnavailable}</span>{/if}
      {#if last}<span class="trigger-last" class:failed={trigger.lastOutcome === 'error'}>{last}</span>{/if}
    </div>
    {#if canEdit}
      <SettingSwitch checked={trigger.enabled} aria-label={fill(t.toggleLabel, { name: trigger.name })} disabled={view.pending} onchange={() => void toggle()} />
    {:else}<span class="routine-state">{trigger.enabled ? t.active : t.inactive}</span>{/if}
  </header>
  {#if address}
    <div class="webhook-fields">
      {#if !endpoint}<p class="hint">{t.endpointPath}</p>{/if}
      <div class="copy-line">
        <input type="text" readonly value={address} bind:this={endpointField} aria-label={addressLabel} title={addressLabel} />
        <button type="button" class="small ghost icon" title={copied === 'endpoint' ? t.copied : fill(t.copyEndpoint, { name: trigger.name })} aria-label={copied === 'endpoint' ? t.copied : fill(t.copyEndpoint, { name: trigger.name })} onclick={() => void copy('endpoint', address, endpointField)}>
          {#if copied === 'endpoint'}<Check size={14} strokeWidth={1.75} />{:else}<Copy size={14} strokeWidth={1.75} />{/if}
        </button>
      </div>
      {#if !compact && isLocalEndpoint}<p class="hint">{t.localOnly}</p>{/if}
      {#if !compact}<p class="hint">{t.auth}</p>{/if}
      {#if secret && canEdit}
        <div class="secret-display" data-testid="trigger-secret">
          <div class="secret-head"><strong>{t.secret}</strong>
            <button type="button" class="small ghost icon" title={t.dismissSecret} aria-label={t.dismissSecret} onclick={ondismiss}><X size={14} strokeWidth={1.75} /></button>
          </div>
          <div class="copy-line">
            <input type="text" readonly value={secret} bind:this={secretField} aria-label={t.secret} autocomplete="off" spellcheck="false" />
            <button type="button" class="small ghost" aria-label={copied === 'secret' ? t.copied : t.copy} onclick={() => void copy('secret', secret, secretField)}><Copy size={14} strokeWidth={1.75} />{copied === 'secret' ? t.copied : t.copy}</button>
          </div>
          <p class="hint">{t.secretHint}</p>
        </div>
      {/if}
    </div>
  {/if}
  {#if canEdit}
    <div class="agent-actions">
      <button type="button" class="small" disabled={view.pending || !trigger.enabled} title={t.test} aria-label={fill(t.testLabel, { name: trigger.name })}
        onclick={() => void view.call('agents.trigger.test', { triggerId: trigger.id, requestId: secureId() })} data-testid="trigger-test">
        <FlaskConical size={13} strokeWidth={1.75} />{#if !compact}{t.test}{/if}
      </button>
      <button type="button" class="small ghost" disabled={view.pending} title={strings.agents.edit} aria-label={fill(t.editLabel, { name: trigger.name })} onclick={onedit} data-testid="trigger-edit"><Pencil size={13} strokeWidth={1.75} />{#if !compact}{strings.agents.edit}{/if}</button>
      {#if trigger.hasSecret}
        <button type="button" class="small ghost" disabled={view.pending} title={t.rotate} aria-label={fill(t.rotateLabel, { name: trigger.name })} onclick={() => void rotate()}><RotateCw size={13} strokeWidth={1.75} />{#if !compact}{t.rotate}{/if}</button>
      {/if}
      <button type="button" class="small ghost" disabled={view.pending} title={strings.agents.remove} aria-label={fill(t.removeLabel, { name: trigger.name })} onclick={() => void remove()}><Trash2 size={13} strokeWidth={1.75} />{#if !compact}{strings.agents.remove}{/if}</button>
    </div>
  {/if}
</article>

<style>
  .trigger-card { min-width: 0; }
  .trigger-card.card { margin: 0; padding: 16px; }
  .trigger-card.compact { display: grid; gap: 5px; padding: 7px 0; border-bottom: 1px solid var(--color-border); }
  .compact > header { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .compact .routine-icon { width: 24px; height: 24px; }
  .compact .agent-actions { gap: 3px; }
  .compact .agent-actions button { min-width: var(--control-sm); justify-content: center; }
  .trigger-last { font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .trigger-last.failed { color: var(--color-danger); }
  .webhook-fields { display: grid; gap: 5px; margin-left: 44px; }
  .compact .webhook-fields { margin-left: 0; }
  .copy-line { display: flex; gap: 4px; align-items: center; }
  .copy-line input { flex: 1; min-width: 0; text-overflow: ellipsis; }
  .compact .copy-line input { height: var(--control-sm); }
  .hint { margin: 0; }
  .secret-display { display: grid; gap: 4px; padding: 8px; border: 1px solid var(--color-edge); border-radius: var(--radius-md); background: var(--color-surface-2); }
  .secret-head { display: flex; align-items: center; justify-content: space-between; }
  @media (max-width: 720px) {
    .webhook-fields { margin-left: 0; }
    .compact .agent-actions button,
    .copy-line button { min-width: var(--control-touch); min-height: var(--control-touch); }
  }
</style>
