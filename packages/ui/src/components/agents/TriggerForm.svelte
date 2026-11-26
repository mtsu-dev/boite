<script lang="ts">
  import { AGENT_TRIGGER_PR_EVENTS, type AgentTrigger, type AgentTriggerPrEvent, type AgentTriggerSource } from '@boite/contracts';
  import { Files, GitPullRequest, Webhook } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import { triggerPatterns } from '../../lib/agent-trigger';
  import type { AgentsView } from '../../lib/agents.svelte';
  import { strings } from '../../lib/strings';
  import Menu from '../Menu.svelte';

  let { view, agentId, trigger, ondone, oncancel }: {
    view: AgentsView;
    agentId: string;
    trigger?: AgentTrigger;
    ondone: (trigger: AgentTrigger, secret?: string) => void;
    oncancel: () => void;
  } = $props();
  const kinds = [{ id: 'webhook', icon: Webhook }, { id: 'file', icon: Files }, { id: 'pr', icon: GitPullRequest }] as const;
  const initial = untrack(() => trigger);
  const openedRevision = initial?.revision;
  const source = initial?.source;
  const t = $derived(strings.agents.triggers);
  const granted = $derived(view.snapshot?.profiles.find(agent => agent.id === agentId)?.projectIds ?? []);
  const projects = $derived(view.store.projects.filter(project => granted.includes(project.id) && !project.archived));

  let kind = $state<AgentTriggerSource['kind']>(source?.kind ?? 'webhook');
  let name = $state(initial?.name ?? '');
  let prompt = $state(initial?.prompt ?? '');
  let cooldownSeconds = $state<number | undefined>(initial?.cooldownSeconds ?? 60);
  let projectId = $state(source && source.kind !== 'webhook' ? source.projectId : '');
  let patterns = $state(source?.kind === 'file' ? source.patterns.join(', ') : '');
  let debounceMs = $state<number | undefined>(source?.kind === 'file' ? source.debounceMs : 500);
  let events = $state<AgentTriggerPrEvent[]>(source?.kind === 'pr' ? [...source.events] : [...AGENT_TRIGGER_PR_EVENTS]);
  const project = $derived(projects.find(candidate => candidate.id === projectId) ?? (!projectId ? projects[0] : undefined));
  const keepsRevokedProject = $derived(
    initial !== undefined && !initial.enabled && initial.source.kind !== 'webhook' && initial.source.kind === kind
      && projectId === initial.source.projectId && !project,
  );
  const selectedProjectId = $derived(project?.id ?? (keepsRevokedProject ? projectId : null));

  function toggle(event: AgentTriggerPrEvent) {
    events = events.includes(event) ? events.filter(value => value !== event) : [...events, event];
  }

  async function save() {
    if (cooldownSeconds === undefined || !name.trim() || !prompt.trim()) return;
    let source: AgentTriggerSource = { kind: 'webhook' };
    if (kind === 'file' && selectedProjectId && debounceMs !== undefined) {
      source = { kind, projectId: selectedProjectId, patterns: triggerPatterns(patterns), debounceMs };
    } else if (kind === 'pr' && selectedProjectId && events.length) {
      source = { kind, projectId: selectedProjectId, events };
    } else if (kind !== 'webhook') return;
    const value = { agentId, name, prompt, enabled: initial?.enabled ?? true, cooldownSeconds, source };
    const saved = await view.call('agents.trigger.save', initial ? { id: initial.id, expectedRevision: openedRevision, value } : { value });
    if (saved) ondone(saved.trigger, saved.secret);
  }
</script>

<form class="card agents-form agent-schedule" onsubmit={event => { event.preventDefault(); void save(); }} data-testid="trigger-form">
  <fieldset class="agent-field">
    <legend>{t.source}</legend>
    <div class="segmented" role="group" aria-label={t.source}>
      {#each kinds as { id, icon: Icon } (id)}
        <button type="button" class:on={kind === id} aria-pressed={kind === id} title={t.kinds[id]} onclick={() => { kind = id; }} data-testid="trigger-kind-{id}">
          <Icon size={14} strokeWidth={1.75} /><span class="seg-label">{t.kinds[id]}</span>
        </button>
      {/each}
    </div>
  </fieldset>
  <label class="agent-field">{t.name}
    <input type="text" bind:value={name} required maxlength={80} data-testid="trigger-name" />
  </label>
  {#if kind !== 'webhook'}
    <div class="agent-field"><span>{t.project}</span>
      {#if projects.length}
        <Menu placement="bottom" label={t.project} testid="trigger-project"
          items={projects.map(item => ({ id: item.id, label: item.name, checked: project?.id === item.id, radio: true }))}
          onpick={id => { projectId = id; }}>
          {project?.name ?? t.project}
        </Menu>
      {:else}<p class="hint">{t.noProjects}</p>{/if}
    </div>
  {/if}
  {#if kind === 'file'}
    <label class="agent-field">{t.patterns}
      <input type="text" bind:value={patterns} placeholder={t.patternsHint} data-testid="trigger-patterns" />
    </label>
    <label class="agent-field">{t.debounce}
      <input type="number" bind:value={debounceMs} min={50} max={60000} required />
    </label>
  {:else if kind === 'pr'}
    <div class="event-filters">
      {#each AGENT_TRIGGER_PR_EVENTS as event (event)}
        <label><input type="checkbox" checked={events.includes(event)} onchange={() => toggle(event)} />{t.events[event]}</label>
      {/each}
    </div>
  {/if}
  <label class="agent-field">{t.task}
    <textarea rows="2" bind:value={prompt} required maxlength={4000} data-testid="trigger-prompt"></textarea>
  </label>
  <label class="agent-field">{t.cooldown}
    <input type="number" bind:value={cooldownSeconds} min={1} max={86400} required />
  </label>
  <div class="agent-actions">
    <button type="submit" class="primary small" disabled={view.pending || (kind !== 'webhook' && (!selectedProjectId || kind === 'pr' && !events.length))} data-testid="trigger-save">{strings.common.save}</button>
    <button type="button" class="ghost small" onclick={oncancel}>{strings.common.cancel}</button>
  </div>
</form>

<style>
  .agents-form.card { gap: 12px; }
  fieldset { border: 0; padding: 0; margin: 0; }
  .segmented { width: fit-content; max-width: 100%; flex-wrap: wrap; }
  .segmented button { display: inline-flex; align-items: center; gap: 5px; }
  .segmented button :global(svg) { flex: none; }
  .seg-label { min-width: 0; }
  .agent-field input[type='number'] { width: 8ch; }
  .agent-field textarea { min-height: 64px; }
  .event-filters { display: flex; flex-wrap: wrap; gap: 8px 16px; }
  .event-filters label { display: flex; align-items: center; gap: 6px; font-size: var(--text-sm); }
  @media (max-width: 480px) {
    .agent-schedule .segmented { display: flex; width: 100%; flex-wrap: nowrap; }
    .agent-schedule .segmented button { flex: 1 1 auto; min-width: 0; justify-content: center; padding: 0 6px; gap: 4px; font-size: var(--text-xs); }
    .agent-schedule .segmented button :global(svg) { display: none; }
    .seg-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }
</style>
