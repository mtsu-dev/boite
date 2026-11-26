import {
  AGENT_TRIGGERS_MAX, AGENT_TRIGGER_PR_EVENTS, AGENT_TRIGGER_WEBHOOK_ROUTE, RpcErrorCode,
  type AgentProfile, type AgentTrigger, type RpcParams, type RpcResult,
} from '@boite/contracts';
import { RpcFailure } from './client';

type TestResult = RpcResult<'agents.trigger.test'>;

interface FakeTriggerHost {
  profile: (agentId: string) => AgentProfile;
  project: (projectId: string) => boolean;
  held: (agent: AgentProfile) => 'queued' | 'skipped' | null;
  wake: (trigger: AgentTrigger) => string | null;
  changed: () => void;
}

function validGlob(pattern: string): boolean {
  let braces = 0;
  let inClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const ch = pattern[index];
    if (ch === '[') {
      if (inClass) return false;
      inClass = true;
    } else if (ch === ']') {
      inClass = false;
    } else if (!inClass && ch === '{') braces++;
    else if (!inClass && ch === '}') {
      if (braces === 0) return false;
      braces--;
    }
  }
  return !inClass && braces === 0;
}

export class FakeAgentTriggers {
  readonly #triggers = new Map<string, AgentTrigger>();
  readonly #tests = new Map<string, { triggerId: string; result: TestResult }>();
  readonly #pendingTests = new Set<string>();

  constructor(private readonly host: FakeTriggerHost) {}

  list(): AgentTrigger[] { return [...this.#triggers.values()]; }

  save(params: RpcParams<'agents.trigger.save'>): RpcResult<'agents.trigger.save'> {
    const value = params.value;
    const agent = this.host.profile(value.agentId);
    const previous = params.id === undefined ? null : this.#get(params.id);
    if (previous && previous.agentId !== agent.id) this.#refuse('agentId: a trigger cannot change owner');
    if (previous) {
      const revision = params.expectedRevision ?? 0;
      if (!Number.isSafeInteger(revision) || revision < (previous.configRevision ?? previous.revision) || revision > previous.revision) {
        throw new RpcFailure({
          code: RpcErrorCode.Refused,
          message: `trigger ${previous.id}: expected revision ${previous.revision}, received ${revision}`,
          data: { kind: 'trigger', id: previous.id, expectedRevision: previous.revision },
        });
      }
    }
    const webhook = value.source.kind === 'webhook';
    const createsSecret = webhook && previous?.source.kind !== 'webhook';
    if (value.source.kind !== 'webhook' && (value.enabled || !previous || previous.source.kind !== value.source.kind || previous.source.projectId !== value.source.projectId)) {
      if (!agent.projectIds?.includes(value.source.projectId) || !this.host.project(value.source.projectId)) this.#refuse('source.projectId: expected a local project granted to this mochi');
    }
    let normalizedSource = structuredClone(value.source);
    if (normalizedSource.kind === 'file') {
      const trimmed = normalizedSource.patterns.map(pattern => pattern.trim());
      if (!Number.isInteger(normalizedSource.debounceMs) || normalizedSource.debounceMs < 50 || normalizedSource.debounceMs > 60_000
        || trimmed.length > 20 || new Set(trimmed).size !== trimmed.length
        || trimmed.some(pattern => !pattern || pattern.length > 160 || /[\\:\x00-\x1f]/.test(pattern) || pattern.split('/').some(part => !part || part === '.' || part === '..') || !validGlob(pattern))) {
        this.#refuse('source: expected relative patterns and a debounce from 50 to 60000 milliseconds');
      }
      normalizedSource = { ...normalizedSource, patterns: trimmed };
    }
    if (normalizedSource.kind === 'pr' && (!normalizedSource.events.length || new Set(normalizedSource.events).size !== normalizedSource.events.length
      || normalizedSource.events.some(event => !AGENT_TRIGGER_PR_EVENTS.includes(event)))) this.#refuse('source.events: expected pull request events');
    const name = value.name.trim();
    const prompt = value.prompt.trim();
    if (!name || name.length > 80 || !prompt || prompt.length > 4000
      || typeof value.enabled !== 'boolean' || !Number.isInteger(value.cooldownSeconds) || value.cooldownSeconds < 1 || value.cooldownSeconds > 86_400) this.#refuse('trigger: check its name, instructions, enabled status and cooldown');
    if (!previous && this.list().filter(trigger => trigger.agentId === agent.id).length >= AGENT_TRIGGERS_MAX) this.#refuse(`trigger: a mochi may have at most ${AGENT_TRIGGERS_MAX} triggers`);
    const now = Date.now();
    const id = previous?.id ?? 'agt_trigger_' + this.#secret().slice(0, 20);
    const revision = (previous?.revision ?? 0) + 1;
    const trigger: AgentTrigger = {
      agentId: agent.id, name, prompt, enabled: value.enabled, cooldownSeconds: value.cooldownSeconds,
      source: normalizedSource, hasSecret: webhook, webhookPath: webhook ? AGENT_TRIGGER_WEBHOOK_ROUTE + id : null,
      id, revision, configRevision: revision, createdAt: previous?.createdAt ?? now, updatedAt: now,
      lastFiredAt: previous?.lastFiredAt ?? null, lastOutcome: previous?.lastOutcome === 'queued' ? 'skipped' : previous?.lastOutcome ?? null,
    };
    this.#pendingTests.delete(id);
    this.#put(trigger);
    return { trigger: structuredClone(trigger), ...(createsSecret ? { secret: this.#secret() } : {}) };
  }

  remove(params: RpcParams<'agents.trigger.remove'>): { removed: true } {
    const trigger = this.#get(params.triggerId);
    this.#triggers.delete(trigger.id);
    this.#pendingTests.delete(trigger.id);
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
    for (const id of this.#pendingTests) {
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
    if (outcome === 'queued') this.#pendingTests.add(trigger.id);
    else this.#pendingTests.delete(trigger.id);
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

  #secret(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), octet => octet.toString(16).padStart(2, '0')).join('');
  }

  #refuse(message: string): never { throw new RpcFailure({ code: RpcErrorCode.Refused, message }); }
}
