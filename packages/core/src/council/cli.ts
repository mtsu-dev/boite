/**
 * `boite delegate council`: models of different providers review one request
 * alone and read-only, each with a score out of 10; their answers come back to
 * this thread as one message, and `again` asks the same members for one more
 * round, from zero (`docs/council.md`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COUNCIL_LIMITS, councilRoleBrief, type Council, type RpcParams } from '@boite/contracts';
import type { CoreClient } from '../client.ts';
import { Usage } from '../cli-args.ts';

type Print = (lines: string[], value: unknown) => void;

export const COUNCIL_USAGE = 'boite delegate council "<request>"|--request-file <path> [--models <provider/model>[:<effort>],<provider/model>[:<effort>][,...]] [--effort <level>] [--role <member>=<text>]... [--timeout <minutes per round>]; boite delegate council again <id> ["<what changed>"] [--send-changes] [--request-file <path>]; boite delegate council table <id>';
const AGAIN_FLAGS = new Set(['--request-id', '--request-file', '--send-changes']);
const START_FLAGS = new Set(['--models', '--effort', '--timeout', '--request-id', '--request-file', '--role']);
/** Flags that stand alone, and the one a command may repeat. */
const SWITCHES = new Set(['--send-changes']);
const REPEATED = new Set(['--role']);

/** The words that are not flags, then the flags, anywhere; `--` ends the flags. */
function parsed(words: string[], allowed: Set<string>): { text: string[]; flags: Map<string, string>; repeated: Map<string, string[]> } {
  const text: string[] = [];
  const flags = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    if (word === '--') { text.push(...words.slice(index + 1)); break; }
    if (!word.startsWith('--') || word.length < 3) { text.push(word); continue; }
    const [flag, inline] = word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
    if (!allowed.has(flag)) throw new Usage(`delegate council: unknown flag ${flag}; ${COUNCIL_USAGE}`);
    if (SWITCHES.has(flag)) {
      if (inline !== undefined) throw new Usage(`${flag} takes no value`);
      flags.set(flag, 'true');
      continue;
    }
    const value = inline ?? words[++index];
    if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) throw new Usage(`${flag} needs a value`);
    if (REPEATED.has(flag)) repeated.set(flag, [...(repeated.get(flag) ?? []), value]);
    else flags.set(flag, value);
  }
  return { text, flags, repeated };
}

/** A request kept in a file: UTF-8, within the limit a request typed in the command has. */
export function requestFile(path: string, cwd = process.cwd()): string {
  const file = resolve(cwd, path);
  let bytes: Uint8Array;
  try { bytes = readFileSync(file); } catch (error) { throw new Usage(`--request-file ${file}: ${error instanceof Error ? error.message : String(error)}`); }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Usage(`--request-file ${file}: expected UTF-8 text`); }
  text = text.trim();
  if (!text) throw new Usage(`--request-file ${file}: the file is empty`);
  if (text.length > COUNCIL_LIMITS.requestChars) throw new Usage(`--request-file ${file}: ${text.length} characters; the limit is ${COUNCIL_LIMITS.requestChars}`);
  return text;
}

/** The command's words after `council`: the request or its file, then its own flags anywhere. */
export function councilParams(words: string[], cwd = process.cwd()): Omit<RpcParams<'council.start'>, 'threadId'> {
  const { text, flags, repeated } = parsed(words, START_FLAGS);
  const typed = text.join(' ').trim();
  const file = flags.get('--request-file');
  if (typed && file !== undefined) throw new Usage('delegate council takes the request as text or as --request-file, not both');
  if (!typed && file === undefined) throw new Usage(`delegate council needs a request: ${COUNCIL_USAGE}`);
  if (typed.length > COUNCIL_LIMITS.requestChars) throw new Usage(`the request holds ${typed.length} characters; the limit is ${COUNCIL_LIMITS.requestChars}`);
  const request = file === undefined ? typed : requestFile(file, cwd);
  const models = flags.has('--models') ? flags.get('--models')!.split(',').map(entry => entry.trim()).filter(Boolean) : undefined;
  if (models && (models.length < COUNCIL_LIMITS.membersMin || models.length > COUNCIL_LIMITS.membersMax)) throw new Usage(`--models needs ${COUNCIL_LIMITS.membersMin} to ${COUNCIL_LIMITS.membersMax} routes from boite delegate models, comma-separated`);
  const timeout = flags.get('--timeout');
  const timeoutMinutes = timeout === undefined ? undefined : Number(timeout);
  if (timeoutMinutes !== undefined && (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > COUNCIL_LIMITS.timeoutMinutesMax)) throw new Usage(`--timeout needs a whole number from 1 to ${COUNCIL_LIMITS.timeoutMinutesMax}, got ${timeout}`);
  const roles: Record<string, string> = {};
  for (const entry of repeated.get('--role') ?? []) {
    const at = entry.indexOf('=');
    const member = entry.slice(0, Math.max(0, at)).trim(), role = entry.slice(at + 1).trim();
    if (at < 1 || !member || !role) throw new Usage(`--role needs <member>=<text>, the member as --models writes it; got ${entry}`);
    if (Object.keys(roles).some(key => key.toLowerCase() === member.toLowerCase())) throw new Usage(`--role names ${member} twice`);
    if (role.length > COUNCIL_LIMITS.roleChars) throw new Usage(`--role ${member}: ${role.length} characters; the limit is ${COUNCIL_LIMITS.roleChars}`);
    roles[member] = role;
  }
  return {
    request,
    ...(models ? { models } : {}),
    ...(timeoutMinutes === undefined ? {} : { timeoutMinutes }),
    ...(flags.has('--effort') ? { effort: flags.get('--effort')! } : {}),
    ...(Object.keys(roles).length > 0 ? { roles } : {}),
    ...(flags.has('--request-id') ? { requestId: flags.get('--request-id')! } : {}),
  };
}

/** The words after `council again`: the id, what changed if anything, and the round's flags. */
export function againParams(words: string[], cwd = process.cwd()): Omit<RpcParams<'council.again'>, 'threadId' | 'requestId'> & { requestId?: string } {
  const { text, flags } = parsed(words, AGAIN_FLAGS);
  const [councilId, ...said] = text;
  const changes = said.join(' ').trim();
  if (!councilId) throw new Usage('delegate council again needs a council id: boite delegate council again <id> ["<what changed>"] [--send-changes] [--request-file <path>]');
  if (flags.has('--send-changes') && !changes) throw new Usage('--send-changes sends the members what changed: say it after the council id');
  if (changes.length > COUNCIL_LIMITS.requestChars) throw new Usage(`what changed holds ${changes.length} characters; the limit is ${COUNCIL_LIMITS.requestChars}`);
  const file = flags.get('--request-file');
  return {
    councilId,
    ...(changes ? { changes } : {}),
    ...(flags.has('--send-changes') ? { sendChanges: true } : {}),
    ...(file === undefined ? {} : { request: requestFile(file, cwd) }),
    ...(flags.has('--request-id') ? { requestId: flags.get('--request-id')! } : {}),
  };
}

const minutes = (ms: number) => `${Math.max(0, Math.round(ms / 60_000))}m`;

/** A member's route with its effort, as `--models` writes it. */
const route = (member: Council['members'][number]) => `${member.providerId}/${member.model}${member.effort ? `:${member.effort}` : ''}`;

/** One line for `delegate list`. */
export function councilRow(council: Council, now: number): string {
  const state = council.status === 'running' ? `running round ${council.round}`
    : council.status === 'waiting' ? `waiting after round ${council.round}${council.delivered ? '' : ' (answers on their way)'}`
    : council.status;
  const who = council.members.map(member => `${route(member)}${member.role ? ` (${councilRoleBrief(member.role)})` : ''}`).join(',');
  return `${council.id} council ${state} ${minutes((council.finishedAt ?? now) - council.createdAt)} ${who} ${JSON.stringify(council.request.replace(/\s+/g, ' ').slice(0, 120))}`;
}

const ROUND_NOTE = 'The user follows it in the salon. The answers come back to you as one message: keep working or end your turn; do not poll.';

export async function councilCommand(client: CoreClient, threadId: string, words: string[], print: Print, cwd = process.cwd()): Promise<void> {
  if (words[0] === 'table') {
    const councilId = words[1];
    if (!councilId || words.length > 2) throw new Usage('delegate council table needs a council id: boite delegate council table <id>');
    const result = await client.call('council.table', { councilId, threadId });
    print([result.table], result);
    return;
  }
  if (words[0] === 'again') {
    const params = againParams(words.slice(1), cwd);
    const council = await client.call('council.again', { threadId, ...params, requestId: params.requestId ?? crypto.randomUUID() });
    print([
      `council: ${council.id}`,
      `round: ${council.round}, the same members reviewing from zero${params.request === undefined ? '' : ', on the new request'}${params.sendChanges ? ', told what changed' : ''}`,
      ROUND_NOTE,
    ], council);
    return;
  }
  const params = councilParams(words, cwd);
  const council = await client.call('council.start', { threadId, requestId: crypto.randomUUID(), ...params });
  print([
    `council: ${council.id}`,
    `salon: ${council.salonThreadId}`,
    `members: ${council.members.map(member => `${member.name} (${member.providerId}/${member.model}${member.effort ? `, ${member.effort}` : ''}${member.role ? `, ${JSON.stringify(member.role)}` : ''})`).join(', ')}`,
    `round: ${council.round}, ${council.timeoutMinutes} minutes at most`,
    ...council.warnings.map(warning => `note: ${warning}`),
    `${ROUND_NOTE} boite delegate council again ${council.id} starts one more round; boite delegate stop ${council.id} ends the council.`,
  ], council);
}
