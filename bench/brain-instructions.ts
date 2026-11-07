/**
 * What the shared brain adds to the prompts of one native session: `turns`
 * turns of an echo thread on a temporary core, with an AGENTS.md of `kib` KiB
 * in the brain. Prints the bytes of every prompt the driver received and how
 * many of them were the brain's instructions.
 * Run: bun run bench/brain-instructions.ts [turns=10] [kib=16]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setDriver } from '../packages/core/src/drivers/index.ts';
import { echoDriver } from '../packages/core/src/drivers/echo.ts';
import { echoThread, startTestCore, waitFor } from '../packages/core/test/harness.ts';

const arg = (at: number, fallback: number): number => Number(process.argv[2 + at] ?? fallback);
const turns = arg(0, 10), kib = arg(1, 16);
const harness = await startTestCore();
const prompts: string[] = [];
const restore = setDriver('echo', { ...echoDriver, startTurn(ctx) {
  prompts.push(ctx.prompt);
  return echoDriver.startTurn({ ...ctx, prompt: 'ok' });
} });
try {
  const root = join(harness.dataDir, 'brain');
  mkdirSync(root);
  const line = 'Shared convention: keep every change small, tested and described in plain words.\n';
  writeFileSync(join(root, 'AGENTS.md'), line.repeat(Math.ceil(kib * 1024 / line.length)).slice(0, kib * 1024));
  await harness.core.brain.configure({ path: root, enabled: true });
  const client = await harness.connect();
  const { threadId } = await echoThread(harness, client);
  for (let index = 0; index < turns; index++) {
    const turn = await client.call('turns.start', { threadId, prompt: `request ${index}` });
    await waitFor(() => harness.core.journal.listTurns(threadId).find(t => t.id === turn.id)?.status === 'done');
  }
  const brain = harness.core.brain.instructions('echo');
  const promptBytes = prompts.map(p => Buffer.byteLength(p));
  const brainBytes = prompts.map(p => p.includes(brain) ? Buffer.byteLength(brain) : 0);
  const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ turns, kib, brainBlockBytes: Buffer.byteLength(brain), turnsWithBrain: brainBytes.filter(Boolean).length, brainBytes: sum(brainBytes), promptBytes: sum(promptBytes), perTurnPromptBytes: promptBytes }));
} finally {
  restore();
  await harness.stop();
}
