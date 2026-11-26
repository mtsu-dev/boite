<script lang="ts">
  import { Plus, Zap } from '@lucide/svelte';
  import type { AgentTrigger } from '@boite/contracts';
  import type { AgentsView } from '../../lib/agents.svelte';
  import { strings } from '../../lib/strings';
  import TriggerCard from './TriggerCard.svelte';
  import TriggerForm from './TriggerForm.svelte';

  let { view, agentId, compact = false }: { view: AgentsView; agentId: string; compact?: boolean } = $props();
  const t = $derived(strings.agents.triggers);
  const triggers = $derived(view.snapshot?.triggers?.filter(trigger => trigger.agentId === agentId) ?? []);
  const canEdit = $derived(view.store.owner && view.snapshot?.profiles.find(agent => agent.id === agentId)?.status !== 'archived');
  let editing = $state<string | 'new' | null>(null);
  let secret = $state<{ id: string; value: string } | null>(null);
  let activeAgentId = '';
  $effect(() => {
    const id = agentId;
    if (activeAgentId && activeAgentId !== id) { editing = null; secret = null; }
    activeAgentId = id;
  });

  function reveal(trigger: AgentTrigger, value: string) { secret = { id: trigger.id, value }; }
  function done(trigger: AgentTrigger, value?: string) {
    editing = null;
    if (value) reveal(trigger, value);
    else if (secret?.id === trigger.id && trigger.source.kind !== 'webhook') secret = null;
  }
</script>

{#if view.snapshot?.triggers !== undefined}
  <section class="agent-routines agent-triggers" class:compact data-testid="agent-triggers">
    {#if compact}
      <div class="desk-label">
        <Zap size={13} strokeWidth={1.75} /><span>{t.title}</span><span class="desk-label-value"></span>
        {#if canEdit && editing === null}<button type="button" class="ghost small icon" aria-label={t.add} title={t.add} onclick={() => { editing = 'new'; }} data-testid="trigger-add"><Plus size={14} strokeWidth={1.75} /></button>{/if}
      </div>
    {:else}
      <div class="agent-card-head agent-pane-head">
        <h2>{t.title}</h2>
        {#if canEdit && editing === null}<button type="button" class="small" onclick={() => { editing = 'new'; }} data-testid="trigger-add"><Plus size={14} strokeWidth={1.75} />{t.add}</button>{/if}
      </div>
    {/if}
    {#each triggers as trigger (trigger.id)}
      {#if editing === trigger.id && canEdit}
        <TriggerForm {view} {agentId} {trigger} ondone={done} oncancel={() => { editing = null; }} />
      {:else}
        <TriggerCard {view} {trigger} {compact} {canEdit} secret={secret?.id === trigger.id ? secret.value : null}
          onedit={() => { editing = trigger.id; }} onsecret={value => reveal(trigger, value)} ondismiss={() => { secret = null; }} />
      {/if}
    {:else}
      {#if editing !== 'new'}<p class="hint empty">{t.empty}</p>{/if}
    {/each}
    {#if editing === 'new' && canEdit}
      <TriggerForm {view} {agentId} ondone={done} oncancel={() => { editing = null; }} />
    {/if}
  </section>
{/if}

<style>
  .agent-triggers { gap: 8px; }
  .agent-triggers .agent-pane-head { margin-bottom: 0; align-items: center; }
  .agent-triggers h2, .empty { margin: 0; }
  @media (max-width: 720px) {
    .desk-label button { min-width: var(--control-touch); min-height: var(--control-touch); }
  }
</style>
