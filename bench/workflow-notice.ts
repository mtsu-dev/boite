/**
 * Size of the notice a conversation reads when its workflow run ends.
 *
 *   bun bench/workflow-notice.ts [--root <checkout>] [--runs 50]
 *
 * `--root` loads `runSummary` from another checkout, so the same script
 * measures the base branch too. Each case is a finished run built in memory:
 *
 * - `small`: three steps with short answers, which must read the same before
 *   and after a change to the notice's budget.
 * - `64 fr`, `64 ja`: 64 executions, a scan, a fan-out of 62 reviews (three of
 *   them failed with a 2,000-character error) and a final report, every answer
 *   4,000 characters (a step's bounded result) of French or Japanese prose.
 *
 * Bytes are the UTF-8 size of the whole notice, chars its UTF-16 length, and
 * ms the median time of one `runSummary` call over the runs.
 */
import { resolve } from 'node:path';
import { emptyUsage } from '../packages/core/src/usage.ts';
import type { WorkflowInstance, WorkflowNode, WorkflowRun } from '../packages/contracts/src/index.ts';

const arg = (name: string) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const root = resolve(arg('--root') ?? resolve(import.meta.dir, '..'));
const runs = Number(arg('--runs') ?? 50);
const { runSummary } = await import(resolve(root, 'packages/core/src/workflows/notices.ts')) as { runSummary: (run: WorkflowRun) => string };

const PROSE = {
  fr: 'Le fichier vérifié contient une fonction qui libère la mémoire deux fois lorsque la requête échoue ; la correction proposée déplace la libération après le contrôle de l’état. ',
  ja: '確認したファイルでは、要求が失敗したときにメモリを二回解放する関数があります。修正案では状態の確認の後に解放を移します。',
};
const repeat = (text: string, chars: number) => text.repeat(Math.ceil(chars / text.length)).slice(0, chars);

function inst(key: string, index: number | null, label: string, status: WorkflowInstance['status'], result: string | null, error: string | null = null): WorkflowInstance {
  return { key, index, label, threadId: `t-${key}`, providerId: 'claude', model: null, status, attempts: 1, task: 'task', result, output: null, error, startedAt: 1, finishedAt: 2 };
}

function node(id: string, after: string[], forEach: string | null, instances: WorkflowInstance[]): WorkflowNode {
  const status = instances.some(i => i.status === 'failed') ? 'failed' : 'done';
  return { id, title: id, profileId: null, after, forEach, status, instances, error: null, startedAt: 1, finishedAt: 2 };
}

function run(nodes: WorkflowNode[]): WorkflowRun {
  const failed = nodes.some(n => n.status === 'failed');
  return {
    id: 'wf-bench', rootThreadId: 'root', name: 'bench', status: failed ? 'failed' : 'done', plan: { name: 'bench', steps: [] }, nodes,
    limits: { maxConcurrent: 8, maxSteps: 64 }, error: failed ? 'review failed' : null, launchedBy: 'agent', templateId: null, delivered: false, usage: emptyUsage(), createdAt: 1, updatedAt: 2, finishedAt: 2,
  };
}

function large(text: string): WorkflowRun {
  const answer = repeat(text, 4000);
  const reviews = Array.from({ length: 62 }, (_, i) => i % 20 === 7
    ? inst(`review#${i}`, i, `src/module-${i}.ts`, 'failed', null, repeat(`Erreur ${i} : ${text}`, 2000))
    : inst(`review#${i}`, i, `src/module-${i}.ts`, 'done', answer));
  return run([
    node('scan', [], null, [inst('scan', null, '', 'done', answer)]),
    node('review', ['scan'], 'scan', reviews),
    node('report', ['review'], null, [inst('report', null, '', 'done', answer)]),
  ]);
}

const small = run([
  node('scan', [], null, [inst('scan', null, '', 'done', 'Trois fichiers à relire : a.ts, b.ts, c.ts.')]),
  node('review', ['scan'], 'scan', [inst('review#0', 0, 'a.ts', 'done', 'Aucun défaut.'), inst('review#1', 1, 'b.ts', 'done', 'Une fuite mémoire ligne 12.')]),
  node('report', ['review'], null, [inst('report', null, '', 'done', 'Un défaut trouvé, dans b.ts.')]),
]);

const cases: [string, WorkflowRun][] = [['small', small], ['64 fr', large(PROSE.fr)], ['64 ja', large(PROSE.ja)]];
console.log(`root ${root}`);
for (const [name, value] of cases) {
  const times: number[] = [];
  let text = '';
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    text = runSummary(value);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(`${name.padEnd(6)} bytes=${Buffer.byteLength(text, 'utf8')} chars=${text.length} ms=${times[times.length >> 1]!.toFixed(3)}`);
}
