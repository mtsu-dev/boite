/**
 * `boite transcripts`: the archive of compacted conversations, read by the
 * owner from a terminal or by an agent inside a thread. An agent's sandbox
 * does not hold the data directory, so this is its way to the records.
 */
import type { ArchivedTranscript } from '@boite/contracts';
import type { CoreClient } from './client.ts';
import { Usage } from './cli-args.ts';

type Printer = (lines: string[], data: unknown) => void;

export const TRANSCRIPTS_HELP = `boite transcripts: compacted conversations kept for audits

  transcripts [list] [--query <text>] [--limit <n>]
                                 archived conversations, newest first: id, dates,
                                 sessions, records, size, failures, title
  transcripts failures [<conversation>] [--query <text>] [--limit <n>]
                                 failed tools, API and turn errors the index
                                 lists, newest first, with the line to read from
  transcripts read <conversation> [--session <id>] [--after <line>]
        [--kinds user,assistant,call,result] [--query <text>] [--limit <n>]
                                 records of one session in order, one JSON a
                                 line; the last line says how to read on
  A record has a kind (k) and a time (t): user, assistant, reasoning, call (a
  tool call with its whole input), result (its output, cut past 16 KiB with
  the original size and hash), usage, turn, system, context, item. An image
  is { $blob, bytes, mime }. A conversation erased from disk keeps its turns
  and usage in the index only.`;

function flags(args: string[], allowed: readonly string[]): { positional: string[]; options: Record<string, string> } {
  const positional: string[] = [];
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [name, inline] = arg.slice(2).split(/=(.*)/s) as [string, string | undefined];
    if (!allowed.includes(name)) throw new Usage(`unknown flag --${name}; boite transcripts help lists them`);
    const value = inline ?? args[index += 1];
    if (value === undefined) throw new Usage(`--${name} needs a value`);
    options[name] = value;
  }
  return { positional, options };
}

function whole(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Usage(`--${name} needs a whole number`);
  return number;
}

const day = (at: number | null): string => at === null ? '-' : new Date(at).toISOString().slice(0, 10);
const size = (bytes: number): string => bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;

function listLine(item: ArchivedTranscript): string {
  return `${item.threadId}  ${day(item.updatedAt)}${item.deletedAt === null ? '' : ` deleted ${day(item.deletedAt)}`}  ${item.sessions} sessions, ${item.records} records, ${size(item.bytes)}, ${item.failures} failures  ${item.title.replace(/[\r\n]+/g, ' ').slice(0, 80)}`;
}

export async function transcriptsCommand(args: string[], client: CoreClient, threadId: string, agent: boolean, print: Printer): Promise<void> {
  const action = args[0] === undefined || args[0].startsWith('--') ? 'list' : args[0];
  const rest = args[0] === action ? args.slice(1) : args;
  // An agent's call names its own thread, as every method open to agents does.
  const own = agent ? { threadId } : {};
  if (action === 'help') { print([TRANSCRIPTS_HELP], { help: TRANSCRIPTS_HELP }); return; }
  if (action === 'list') {
    const { positional, options } = flags(rest, ['query', 'limit']);
    if (positional.length > 0) throw new Usage('transcripts list takes flags only');
    const limit = whole('limit', options.limit);
    const items = await client.call('transcripts.list', { ...own, ...(options.query === undefined ? {} : { query: options.query }), ...(limit === undefined ? {} : { limit }) });
    print(items.length === 0 ? ['no archived conversation'] : items.map(listLine), items);
    return;
  }
  if (action === 'failures') {
    const { positional, options } = flags(rest, ['query', 'limit']);
    if (positional.length > 1) throw new Usage('transcripts failures [<conversation>] [--query <text>] [--limit <n>]');
    const limit = whole('limit', options.limit);
    const items = await client.call('transcripts.failures', { ...own, ...(positional[0] === undefined ? {} : { conversation: positional[0] }), ...(options.query === undefined ? {} : { query: options.query }), ...(limit === undefined ? {} : { limit }) });
    print(items.length === 0 ? ['no failure matches'] : items.map(item => `${item.at === null ? '-' : new Date(item.at).toISOString()}  ${item.threadId} ${item.sessionId}:${item.line}  ${item.kind}${item.tool === null ? '' : ` ${item.tool}`}: ${item.text.replace(/[\r\n]+/g, ' ').slice(0, 200)}`), items);
    return;
  }
  if (action === 'read') {
    const { positional, options } = flags(rest, ['session', 'after', 'kinds', 'query', 'limit']);
    const conversation = positional[0];
    if (conversation === undefined || positional.length > 1) throw new Usage('transcripts read <conversation> [--session <id>] [--after <line>] [--kinds a,b] [--query <text>] [--limit <n>]');
    const after = whole('after', options.after);
    const limit = whole('limit', options.limit);
    const page = await client.call('transcripts.read', {
      ...own, conversation, ...(options.session === undefined ? {} : { sessionId: options.session }), ...(after === undefined ? {} : { after }),
      ...(options.kinds === undefined ? {} : { kinds: options.kinds.split(',').filter(Boolean) }), ...(options.query === undefined ? {} : { query: options.query }), ...(limit === undefined ? {} : { limit }),
    });
    if (page.sessionId === null) { print([`no archived session for ${conversation}`], page); return; }
    const lines = page.records.map(item => `${item.line}\t${JSON.stringify(item.record)}`);
    const others = page.sessions.filter(id => id !== page.sessionId);
    lines.push(page.next === null
      ? `end of session ${page.sessionId}${others.length > 0 ? `; other sessions: ${others.map(id => `--session ${id}`).join(', ')}` : ''}`
      : `more: boite transcripts read ${conversation} --session ${page.sessionId} --after ${page.next}`);
    print(lines, page);
    return;
  }
  throw new Usage(`unknown transcripts action ${action}; boite transcripts help lists them`);
}
