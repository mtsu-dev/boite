import { AGENT_TRIGGER_PR_EVENTS, type AgentTriggerConfig, type AgentTriggerSource } from '@boite/contracts';
import { invalidParams } from '../errors.ts';
import { boolean, ids, integer, object, oneOf, text } from './validation.ts';

function sourceOf(value: AgentTriggerSource): AgentTriggerSource {
  object(value, 'source');
  if (value.kind === 'webhook') return { kind: 'webhook' };
  const projectId = text(value.projectId, 'source.projectId', 160);
  if (value.kind === 'file') {
    const patterns = ids(value.patterns, 'source.patterns', 20);
    for (const [index, pattern] of patterns.entries()) {
      if (/[\\:\x00-\x1f]/.test(pattern) || pattern.split('/').some(part => !part || part === '.' || part === '..')) {
        throw invalidParams(`source.patterns[${index}]: expected a relative path or glob with forward slashes`);
      }
      try { new Bun.Glob(pattern).match(''); }
      catch { throw invalidParams(`source.patterns[${index}]: expected a valid glob`); }
    }
    return { kind: 'file', projectId, patterns, debounceMs: integer(value.debounceMs, 'source.debounceMs', 50, 60_000) };
  }
  if (value.kind === 'pr') {
    const events = ids(value.events, 'source.events', AGENT_TRIGGER_PR_EVENTS.length)
      .map(event => oneOf(event, 'source.events', AGENT_TRIGGER_PR_EVENTS));
    if (!events.length) throw invalidParams('source.events: expected at least one pull request event');
    return { kind: 'pr', projectId, events };
  }
  throw invalidParams('source.kind: expected webhook, file or pr');
}

export function triggerConfig(value: AgentTriggerConfig): AgentTriggerConfig {
  object(value, 'trigger');
  return {
    agentId: text(value.agentId, 'agentId', 160),
    name: text(value.name, 'name', 80),
    prompt: text(value.prompt, 'prompt', 4000),
    enabled: boolean(value.enabled, 'enabled'),
    cooldownSeconds: integer(value.cooldownSeconds, 'cooldownSeconds', 1, 86_400),
    source: sourceOf(value.source),
  };
}
