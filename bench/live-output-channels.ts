/**
 * What a phone pays for a running command it does not look at: bytes the core
 * sends it, after deflate, while one turn runs a 20 s command whose card is
 * redrawn with its last 4,000 characters every second (the echo driver's
 * `[command]`, the shape a driver streaming a command's output has), then
 * writes a short answer. The phone opens the thread the way the app does, as a
 * remote client through the counting relay of `lib/wire.ts`, once with every
 * stream channel (what each client received before channels existed, and what
 * a phone with the card open still asks) and once without `liveOutput` (a
 * phone whose tool cards are folded).
 *
 *   bun run bench/live-output-channels.ts [--seconds 20] [--json out.json]
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamChannel } from '../packages/contracts/src/index.ts';
import { connect } from '../packages/core/src/client.ts';
import { removeDirectory, startCore } from '../tests/e2e/lib/core.ts';
import { startWire } from './lib/wire.ts';

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

const SECONDS = Number(flag('seconds', '20'));
const JSON_OUT = flag('json', '');
/** The core deflates and paces for a client that dialled anything but loopback; the relay is on loopback, so the name is said here. */
const REMOTE = { client: { name: 'bench', version: '2.0.0-beta.1' }, timeoutMs: 20_000, headers: { host: 'phone.bench.test' } };
const ANSWER = 'The build finished and every target linked. '.repeat(20);

/** `bytes` is what crossed the link, deflated; `partBytes` the JSON of the `message.part` frames before deflate. */
interface Row { name: string; bytes: number; partBytes: number; frames: number; runningWithOutput: number }

async function main(): Promise<void> {
  const core = await startCore();
  const direct = await connect(core.url, core.token, { client: { name: 'bench', version: '2.0.0-beta.1' } });
  const directory = mkdtempSync(join(tmpdir(), 'boite-bench-project-'));
  const relay = startWire(core.port);
  const rows: Row[] = [];
  try {
    const project = await direct.call('projects.add', { path: directory, name: 'bench' });
    const account = (await direct.call('accounts.list', {})).find((entry) => entry.providerId === 'echo');
    if (account === undefined) throw new Error('the core has no echo account');

    const run = async (name: string, channels: StreamChannel[] | undefined): Promise<void> => {
      const thread = await direct.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: name });
      const phone = await connect(relay.url, core.token, REMOTE);
      try {
        await phone.call('threads.get', { threadId: thread.id, compactTools: true, compactFiles: true, compactImages: true, compactToolParts: true, open: { markRead: true }, ...(channels ? { channels } : {}) });
        let frames = 0;
        let runningWithOutput = 0;
        let partBytes = 0;
        const offs = [
          phone.on('message.part', (event) => {
            frames += 1;
            partBytes += Buffer.byteLength(JSON.stringify(event));
            if (event.part.type === 'tool' && event.part.status === 'running' && (event.part.output ?? '') !== '') runningWithOutput += 1;
          }),
          phone.on('message.delta', () => { frames += 1; }),
        ];
        const finished = phone.next('turn.finished', (event) => event.threadId === thread.id, (SECONDS + 30) * 1000);
        relay.reset();
        await direct.call('turns.start', { threadId: thread.id, prompt: `[command:${SECONDS * 1000}]${ANSWER}` });
        await finished;
        // The last paced frames and the turn's closing events.
        await Bun.sleep(300);
        for (const off of offs) off();
        rows.push({ name, bytes: relay.read().down, partBytes, frames, runningWithOutput });
      } finally {
        phone.close();
      }
    };

    await run('every channel (before; a phone with the card open)', undefined);
    await run('text and tools, no liveOutput (folded cards)', ['text', 'tools']);
  } finally {
    relay.stop();
    direct.close();
    await core.stop();
    await removeDirectory(directory);
  }

  const lines = [
    `| ${SECONDS} s command, phone over deflate | bytes down | message.part JSON bytes | part and delta frames | running cards with output |`,
    '|---|---:|---:|---:|---:|',
    ...rows.map((row) => `| ${row.name} | ${row.bytes.toLocaleString('en-US')} | ${row.partBytes.toLocaleString('en-US')} | ${row.frames} | ${row.runningWithOutput} |`),
  ];
  console.log(lines.join('\n'));
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
}

await main();
