import { RpcErrorCode, TRANSCRIPT_PRESETS } from '../../packages/contracts/src/index.ts';
import type { ContractEnv, Scenario } from './scenarios.ts';

/* Conversation storage, the same on the real core and the in-memory client: a preview that only reads, and the archive an audit queries. */

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function refused(call: Promise<unknown>, field?: string): Promise<void> {
  let error: unknown = null;
  try { await call; } catch (caught) { error = caught; }
  check(error !== null, 'expected a refusal, the call succeeded');
  const raw = error as { code?: number; data?: { field?: unknown }; rpc?: { code?: number; data?: { field?: unknown } } };
  const got = raw.rpc ?? raw;
  check(got.code === RpcErrorCode.Refused, `expected a refusal, got ${String(got.code)} (${error instanceof Error ? error.message : String(error)})`);
  if (field !== undefined) check(got.data?.field === field, `expected field ${field}, got ${String(got.data?.field)}`);
}

export const TRANSCRIPT_SCENARIOS: Record<string, Scenario> = {
  'a storage preview answers for the policy asked and frees no more than there is; the archive reads empty for an unknown conversation': async (env: ContractEnv) => {
    const before = (await env.call('settings.get', {})).transcriptStorage;
    for (const policy of [TRANSCRIPT_PRESETS.classic, TRANSCRIPT_PRESETS.delete]) {
      const preview = await env.call('transcripts.preview', { policy });
      check(JSON.stringify(preview.policy) === JSON.stringify(policy), 'the preview answers for the policy asked');
      check(preview.archiveBytes >= 0 && preview.archiveBytes <= preview.totalBytes, `the archive (${preview.archiveBytes}) is part of the total (${preview.totalBytes})`);
      check(preview.freedBytes >= 0 && preview.freedBytes <= preview.totalBytes, `a mode frees ${preview.freedBytes} of ${preview.totalBytes}`);
      check(preview.keptRatio === null || (preview.keptRatio >= 0 && preview.keptRatio <= 1), 'the share kept is between 0 and 1');
    }
    await refused(env.call('transcripts.preview', { policy: { ...TRANSCRIPT_PRESETS.classic, deletedCompactDays: -1 } }), 'policy');
    // Asking what a mode would do picks none.
    check(JSON.stringify((await env.call('settings.get', {})).transcriptStorage) === JSON.stringify(before), 'a preview leaves the setting as it was');
    check((await env.call('transcripts.progress', {})).running === false, 'no pass runs for a preview');
    await refused(env.call('transcripts.compactUnlinked', { days: -1 }), 'days');

    const unknown = 'thr_no_such_conversation';
    check((await env.call('transcripts.list', { query: unknown })).length === 0, 'no archived conversation matches an unknown name');
    check((await env.call('transcripts.failures', { conversation: unknown })).length === 0, 'an unknown conversation lists no failure');
    const read = await env.call('transcripts.read', { conversation: unknown });
    check(read.sessionId === null && read.records.length === 0 && read.next === null, 'an unknown conversation reads empty');
  },
};
