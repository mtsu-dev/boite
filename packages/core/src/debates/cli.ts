/**
 * `boite delegate debate`: several AIs argue one question in rounds while the
 * user follows in the salon; a model that did not debate writes the summary,
 * which comes back to this thread as one message (`docs/debates.md`).
 */
import { DEBATE_LIMITS, type Debate, type RpcParams } from '@boite/contracts';
import type { CoreClient } from '../client.ts';
import { Usage } from '../cli-args.ts';

type Print = (lines: string[], value: unknown) => void;

export const DEBATE_USAGE = 'boite delegate debate "<question>" --models <provider/model>,<provider/model>[,...] [--rounds 3] [--angles "a,b,c"] [--summary <provider/model>] [--effort <level>] [--timeout <minutes per round>]';
const VALUE_FLAGS = new Set(['--models', '--rounds', '--summary', '--angles', '--effort', '--timeout', '--request-id']);

const list = (raw: string) => raw.split(',').map(entry => entry.trim()).filter(Boolean);
function whole(flag: string, raw: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Usage(`${flag} needs a whole number from ${min} to ${max}, got ${raw}`);
  return value;
}

/** The command's words after `debate`: the question, then its own flags anywhere. */
export function debateParams(words: string[]): Omit<RpcParams<'debates.start'>, 'threadId'> {
  const topic: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    if (word === '--') { topic.push(...words.slice(index + 1)); break; }
    if (!word.startsWith('--') || word.length < 3) { topic.push(word); continue; }
    const [flag, inline] = word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
    if (!VALUE_FLAGS.has(flag)) throw new Usage(`delegate debate: unknown flag ${flag}; ${DEBATE_USAGE}`);
    const value = inline ?? words[++index];
    if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) throw new Usage(`${flag} needs a value`);
    flags.set(flag, value);
  }
  const question = topic.join(' ').trim();
  if (!question) throw new Usage(`delegate debate needs a question: ${DEBATE_USAGE}`);
  const models = list(flags.get('--models') ?? '');
  if (models.length < DEBATE_LIMITS.participantsMin || models.length > DEBATE_LIMITS.participantsMax) throw new Usage(`--models needs ${DEBATE_LIMITS.participantsMin} to ${DEBATE_LIMITS.participantsMax} routes from boite delegate models, comma-separated`);
  const angles = flags.has('--angles') ? list(flags.get('--angles')!) : undefined;
  if (angles && angles.length !== models.length) throw new Usage(`--angles needs one angle per model: ${models.length}, comma-separated`);
  return {
    topic: question, models,
    ...(flags.has('--rounds') ? { rounds: whole('--rounds', flags.get('--rounds')!, DEBATE_LIMITS.roundsMin, DEBATE_LIMITS.roundsMax) } : {}),
    ...(flags.has('--timeout') ? { timeoutMinutes: whole('--timeout', flags.get('--timeout')!, 1, DEBATE_LIMITS.timeoutMinutesMax) } : {}),
    ...(flags.has('--summary') ? { summary: flags.get('--summary')! } : {}),
    ...(flags.has('--effort') ? { effort: flags.get('--effort')! } : {}),
    ...(flags.has('--request-id') ? { requestId: flags.get('--request-id')! } : {}),
    ...(angles ? { angles } : {}),
  };
}

const minutes = (ms: number) => `${Math.max(0, Math.round(ms / 60_000))}m`;

/** One line for `delegate list`. */
export function debateRow(debate: Debate, now: number): string {
  const state = debate.status === 'running' ? `running round ${debate.round}/${debate.rounds}` : debate.status === 'summarizing' ? 'summarizing' : `${debate.status}${debate.status === 'done' && !debate.delivered ? ' (summary on its way)' : ''}`;
  const who = debate.participants.map(p => `${p.providerId}/${p.model}`).join(',');
  return `${debate.id} debate ${state} ${minutes((debate.finishedAt ?? now) - debate.createdAt)} ${who} ${JSON.stringify(debate.topic.replace(/\s+/g, ' ').slice(0, 120))}`;
}

export async function debateCommand(client: CoreClient, threadId: string, words: string[], print: Print): Promise<void> {
  const params = debateParams(words);
  const debate = await client.call('debates.start', { threadId, requestId: crypto.randomUUID(), ...params });
  print([
    `debate: ${debate.id}`,
    `salon: ${debate.salonThreadId}`,
    `debaters: ${debate.participants.map(p => `${p.name}${p.angle ? ` (${p.angle})` : ''}`).join(', ')}`,
    `rounds: ${debate.rounds}, ${debate.timeoutMinutes} minutes each at most`,
    `summary: ${debate.summarizer.name}, who does not debate`,
    ...debate.warnings.map(warning => `note: ${warning}`),
    'The user follows it in the salon. The summary comes back to you as a message: keep working or end your turn; do not poll. boite delegate stop <debate-id> stops it.',
  ], debate);
}
