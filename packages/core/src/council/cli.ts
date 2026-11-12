/**
 * `boite delegate council`: models of different providers review one request
 * alone and read-only, each with a score out of 10; their answers come back to
 * this thread as one message, and `again` asks the same members for one more
 * round, from zero (`docs/internals/council.md`).
 */
import { COUNCIL_LIMITS, type Council, type RpcParams } from '@boite/contracts';
import type { CoreClient } from '../client.ts';
import { Usage } from '../cli-args.ts';

type Print = (lines: string[], value: unknown) => void;

export const COUNCIL_USAGE = 'boite delegate council "<request>" [--models <provider/model>,<provider/model>[,...]] [--effort <level>] [--timeout <minutes per round>]; boite delegate council again <id> "<what changed>"; boite delegate council table <id>';
const AGAIN_FLAGS = new Set(['--request-id']);
const START_FLAGS = new Set(['--models', '--effort', '--timeout', '--request-id']);

/** The words that are not flags, then the flags, anywhere; `--` ends the flags. */
function parsed(words: string[], allowed: Set<string>): { text: string[]; flags: Map<string, string> } {
  const text: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    if (word === '--') { text.push(...words.slice(index + 1)); break; }
    if (!word.startsWith('--') || word.length < 3) { text.push(word); continue; }
    const [flag, inline] = word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
    if (!allowed.has(flag)) throw new Usage(`delegate council: unknown flag ${flag}; ${COUNCIL_USAGE}`);
    const value = inline ?? words[++index];
    if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) throw new Usage(`${flag} needs a value`);
    flags.set(flag, value);
  }
  return { text, flags };
}

/** The command's words after `council`: the request, then its own flags anywhere. */
export function councilParams(words: string[]): Omit<RpcParams<'council.start'>, 'threadId'> {
  const { text, flags } = parsed(words, START_FLAGS);
  const request = text.join(' ').trim();
  if (!request) throw new Usage(`delegate council needs a request: ${COUNCIL_USAGE}`);
  const models = flags.has('--models') ? flags.get('--models')!.split(',').map(entry => entry.trim()).filter(Boolean) : undefined;
  if (models && (models.length < COUNCIL_LIMITS.membersMin || models.length > COUNCIL_LIMITS.membersMax)) throw new Usage(`--models needs ${COUNCIL_LIMITS.membersMin} to ${COUNCIL_LIMITS.membersMax} routes from boite delegate models, comma-separated`);
  const timeout = flags.get('--timeout');
  const timeoutMinutes = timeout === undefined ? undefined : Number(timeout);
  if (timeoutMinutes !== undefined && (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > COUNCIL_LIMITS.timeoutMinutesMax)) throw new Usage(`--timeout needs a whole number from 1 to ${COUNCIL_LIMITS.timeoutMinutesMax}, got ${timeout}`);
  return {
    request,
    ...(models ? { models } : {}),
    ...(timeoutMinutes === undefined ? {} : { timeoutMinutes }),
    ...(flags.has('--effort') ? { effort: flags.get('--effort')! } : {}),
    ...(flags.has('--request-id') ? { requestId: flags.get('--request-id')! } : {}),
  };
}

const minutes = (ms: number) => `${Math.max(0, Math.round(ms / 60_000))}m`;

/** One line for `delegate list`. */
export function councilRow(council: Council, now: number): string {
  const state = council.status === 'running' ? `running round ${council.round}`
    : council.status === 'waiting' ? `waiting after round ${council.round}${council.delivered ? '' : ' (answers on their way)'}`
    : council.status;
  const who = council.members.map(member => `${member.providerId}/${member.model}`).join(',');
  return `${council.id} council ${state} ${minutes((council.finishedAt ?? now) - council.createdAt)} ${who} ${JSON.stringify(council.request.replace(/\s+/g, ' ').slice(0, 120))}`;
}

const ROUND_NOTE = 'The user follows it in the salon. The answers come back to you as one message: keep working or end your turn; do not poll.';

export async function councilCommand(client: CoreClient, threadId: string, words: string[], print: Print): Promise<void> {
  if (words[0] === 'table') {
    const councilId = words[1];
    if (!councilId || words.length > 2) throw new Usage('delegate council table needs a council id: boite delegate council table <id>');
    const result = await client.call('council.table', { councilId, threadId });
    print([result.table], result);
    return;
  }
  if (words[0] === 'again') {
    const { text, flags } = parsed(words.slice(1), AGAIN_FLAGS);
    const [councilId, ...said] = text;
    const changes = said.join(' ').trim();
    if (!councilId || !changes) throw new Usage('delegate council again needs a council id and what changed: boite delegate council again <id> "<what changed>"');
    const council = await client.call('council.again', { councilId, threadId, changes, requestId: flags.get('--request-id') ?? crypto.randomUUID() });
    print([`council: ${council.id}`, `round: ${council.round}, the same members reviewing from zero`, ROUND_NOTE], council);
    return;
  }
  const params = councilParams(words);
  const council = await client.call('council.start', { threadId, requestId: crypto.randomUUID(), ...params });
  print([
    `council: ${council.id}`,
    `salon: ${council.salonThreadId}`,
    `members: ${council.members.map(member => `${member.name} (${member.providerId}/${member.model}${member.effort ? `, ${member.effort}` : ''})`).join(', ')}`,
    `round: ${council.round}, ${council.timeoutMinutes} minutes at most`,
    ...council.warnings.map(warning => `note: ${warning}`),
    `${ROUND_NOTE} boite delegate council again ${council.id} "<what changed>" starts one more round; boite delegate stop ${council.id} ends the council.`,
  ], council);
}
