/*
 * The words of the rich presence, from the conversations at work on every
 * machine this app follows. Pure, so the Settings preview and the chat app
 * read the same lines.
 */
import { markFeature, PRESENCE_TEXT, type PresenceActivity, type ThreadStatus } from '@boite/contracts';
import { fill, strings } from '../strings';

markFeature('boite-feature:discord-presence');

/** One conversation as the presence counts it. */
export interface PresenceWork {
  status: ThreadStatus;
  /** Its project's name, null outside a project. */
  project: string | null;
  /** Its model as the app names it, null for the agent's default. */
  model: string | null;
  /** When it last changed: the latest names the project first. */
  at: number;
}

/** Models a line names before it stops. */
const MODELS_SHOWN = 2;

function line(text: string): string {
  const chars = [...text.trim()];
  return chars.length > PRESENCE_TEXT.max ? `${chars.slice(0, PRESENCE_TEXT.max - 1).join('')}.` : chars.join('');
}

/**
 * What the chat apps show: the project (when allowed) or the number of
 * agents, then their models and how many wait for an answer, with a timer
 * from the moment the work began. Idle when nothing runs.
 */
export function presenceActivity(work: readonly PresenceWork[], options: { projects: boolean; startedAt: number | null }): PresenceActivity {
  const button = strings.presence.button;
  const active = work.filter(each => each.status === 'running' || each.status === 'queued' || each.status === 'waiting').sort((a, b) => b.at - a.at);
  if (active.length === 0) return { details: strings.presence.idle, button };
  const count = active.length;
  const projects = [...new Set(active.map(each => each.project).filter((name): name is string => !!name))];
  const models = [...new Set(active.map(each => each.model).filter((name): name is string => !!name))];
  const waiting = active.filter(each => each.status === 'waiting').length;
  const named = options.projects && projects.length > 0;
  const details = named
    ? projects.length === 1 ? fill(strings.presence.workingOn, { project: projects[0]! }) : fill(strings.presence.workingOnMore, { project: projects[0]!, more: String(projects.length - 1) })
    : count === 1 ? strings.presence.oneAgent : fill(strings.presence.agents, { count: String(count) });
  const parts: string[] = [];
  if (named) parts.push(count === 1 ? strings.presence.agent : fill(strings.presence.agentCount, { count: String(count) }));
  if (models.length > 0) parts.push(models.slice(0, MODELS_SHOWN).join(', ') + (models.length > MODELS_SHOWN ? ` +${models.length - MODELS_SHOWN}` : ''));
  if (waiting > 0) parts.push(fill(strings.presence.waiting, { count: String(waiting) }));
  const state = line(parts.join(' · '));
  return {
    details: line(details),
    ...([...state].length >= PRESENCE_TEXT.min ? { state } : {}),
    ...(options.startedAt !== null ? { startedAt: options.startedAt } : {}),
    button,
  };
}
