import {
  AGENT_TRIGGERS_MAX, AGENT_TRIGGER_PR_EVENTS, AGENT_TRIGGER_WEBHOOK_ROUTE, RpcErrorCode,
  type AgentProfile, type AgentTrigger, type RpcParams, type RpcResult,
} from '@boite/contracts';
import { RpcFailure } from './client';

type TestResult = RpcResult<'agents.trigger.test'>;

interface FakeTriggerHost {
  profile: (agentId: string) => AgentProfile;
  owner: (threadId: string) => string | null;
  project: (projectId: string) => boolean;
  held: (agent: AgentProfile) => 'queued' | 'skipped' | null;
  wake: (trigger: AgentTrigger) => string | null;
  changed: () => void;
}

export class FakeAgentTriggers {
  readonly #triggers = new Map<string, AgentTrigger>();
  readonly #tests = new Map<string, { triggerId: string; result: TestResult }>();
  readonly #pending = new Set<string>();

  constructor(private readonly host: FakeTriggerHost) {}

  list(): AgentTrigger[] { return [...this.#triggers.values()]; }

  save(params: RpcParams<'agents.trigger.save'>): RpcResult<'agents.trigger.save'> {
    const value = params.value;
    const agent = this.host.profile(value.agentId);
    const previous = params.id === undefined ? null : this.#get(params.id);
    this.#allow(params.threadId, agent.id);
    if (previous && previous.agentId !== agent.id) this.#refuse('agentId: a trigger cannot change owner');
    if (previous) {
      const revision = params.expectedRevision ?? 0;
      if (!Number.isSafeInteger(revision) || revision < (previous.configRevision ?? previous.revision) || revision > previous.revision) {
        this.#refuse('expectedRevision: the trigger changed');
      }
    }
    const webhook = value.source.kind === 'webhook';
    const createsSecret = webhook && previous?.source.kind !== 'webhook';
    if (createsSecret && params.threadId !== undefined) this.#refuse('source.kind: only the owner can create a webhook trigger');
    if (value.source.kind !== 'webhook' && (value.enabled || !previous || previous.source.kind !== value.source.kind || previous.source.projectId !== value.source.projectId)) {
      if (!agent.projectIds?.includes(value.source.projectId) || !this.host.project(value.source.projectId)) this.#refuse('source.projectId: expected a local project granted to this mochi');
    }
    if (value.source.kind === 'file' && (!Number.isInteger(value.source.debounceMs) || value.source.debounceMs < 50 || value.source.debounceMs > 60_000
      || value.source.patterns.length > 20 || new Set(value.source.patterns).size !== value.source.patterns.length
      || value.source.patterns.some(pattern => pattern.length > 160 || /[\\:\x00-\x1f]/.test(pattern) || pattern.split('/').some(part => !part || part === '.' || part === '..')))) this.#refuse('source: expected relative patterns and a debounce from 50 to 60000 milliseconds');
    if (value.source.kind === 'pr' && (!value.source.events.length || new Set(value.source.events).size !== value.source.events.length
      || value.source.events.some(event => !AGENT_TRIGGER_PR_EVENTS.includes(event)))) this.#refuse('source.events: expected pull request events');
    if (!value.name.trim() || value.name.length > 80 || !value.prompt.trim() || value.prompt.length > 4000
      || typeof value.enabled !== 'boolean' || !Number.isInteger(value.cooldownSeconds) || value.cooldownSeconds < 1 || value.cooldownSeconds > 86_400) this.#refuse('trigger: check its name, instructions, enabled status and cooldown');
    if (!previous && this.list().filter(trigger => trigger.agentId === agent.id).length >= AGENT_TRIGGERS_MAX) this.#refuse(`trigger: a mochi may have at most ${AGENT_TRIGGERS_MAX} triggers`);
    const now = Date.now();
    const id = previous?.id ?? 'agt_trigger_' + this.#secret().slice(0, 20);
    const revision = (previous?.revision ?? 0) + 1;
    const trigger: AgentTrigger = {
      agentId: agent.id, name: value.name.trim(), prompt: value.prompt.trim(), enabled: value.enabled, cooldownSeconds: value.cooldownSeconds,
      source: structuredClone(value.source), hasSecret: webhook, webhookPath: webhook ? AGENT_TRIGGER_WEBHOOK_ROUTE + id : null,
      id, revision, configRevision: revision, createdAt: previous?.createdAt ?? now, updatedAt: now,
      lastFiredAt: previous?.lastFiredAt ?? null, lastOutcome: previous?.lastOutcome === 'queued' ? 'skipped' : previous?.lastOutcome ?? null,
    };
    this.#pending.delete(id);
    this.#put(trigger);
    return { trigger: structuredClone(trigger), ...(createsSecret ? { secret: this.#secret() } : {}) };
  }

  remove(params: RpcParams<'agents.trigger.remove'>): { removed: true } {
    const trigger = this.#get(params.triggerId);
    this.#allow(params.threadId, trigger.agentId);
    this.#triggers.delete(trigger.id);
    this.#pending.delete(trigger.id);
    this.host.changed();
    return { removed: true };
  }

  removeForAgent(agentId: string): void {
    for (const trigger of this.list()) if (trigger.agentId === agentId) this.remove({ triggerId: trigger.id });
  }

  rotateSecret(params: RpcParams<'agents.trigger.rotateSecret'>): RpcResult<'agents.trigger.rotateSecret'> {
    const trigger = this.#get(params.triggerId);
    if (trigger.source.kind !== 'webhook') this.#refuse('triggerId: expected a webhook trigger');
    return { trigger: structuredClone(trigger), secret: this.#secret() };
  }

  test(params: RpcParams<'agents.trigger.test'>): TestResult {
    const requestId = params.requestId.trim();
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) this.#refuse('requestId: expected 8 to 100 letters, numbers, underscores or hyphens');
    const prior = this.#tests.get(requestId);
    if (prior) {
      if (prior.triggerId !== params.triggerId) this.#refuse('requestId already used with different input');
      return { ...prior.result };
    }
    const trigger = this.#get(params.triggerId);
    if (!trigger.enabled) this.#refuse('triggerId: enable the trigger before testing it');
    const result = this.#dispatch(trigger, Date.now());
    this.#tests.set(requestId, { triggerId: trigger.id, result });
    return { ...result };
  }

  flush(agentId: string): void {
    for (const id of this.#pending) {
      const trigger = this.#get(id);
      if (trigger.agentId === agentId) this.#dispatch(trigger, trigger.lastFiredAt);
    }
  }

  #dispatch(trigger: AgentTrigger, at: number | null): TestResult {
    const agent = this.host.profile(trigger.agentId);
    const revoked = trigger.source.kind !== 'webhook' && (!agent.projectIds?.includes(trigger.source.projectId) || !this.host.project(trigger.source.projectId));
    const held = revoked ? 'skipped' : this.host.held(agent);
    const turnId = held === null ? this.host.wake(trigger) : null;
    const outcome = held ?? (turnId ? 'fired' : 'error');
    if (outcome === 'queued') this.#pending.add(trigger.id);
    else this.#pending.delete(trigger.id);
    if (trigger.lastOutcome !== outcome || trigger.lastFiredAt !== at) {
      this.#put({ ...trigger, lastFiredAt: at, lastOutcome: outcome, revision: trigger.revision + 1, updatedAt: Date.now() });
    }
    return { outcome, turnId };
  }

  #get(id: string): AgentTrigger {
    const trigger = this.#triggers.get(id);
    if (!trigger) throw new RpcFailure({ code: RpcErrorCode.NotFound, message: `unknown trigger ${id}` });
    return trigger;
  }

  #put(trigger: AgentTrigger): AgentTrigger {
    this.#triggers.set(trigger.id, trigger);
    this.host.changed();
    return structuredClone(trigger);
  }

  #allow(threadId: string | undefined, agentId: string): void {
    if (threadId !== undefined && this.host.owner(threadId) !== agentId) this.#refuse('agentId: a mochi configures only its own triggers from its own thread');
  }

  #secret(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), octet => octet.toString(16).padStart(2, '0')).join('');
  }

  #refuse(message: string): never { throw new RpcFailure({ code: RpcErrorCode.Refused, message }); }
}
