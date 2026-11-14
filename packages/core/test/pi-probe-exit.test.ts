import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { readModels } from '../src/drivers/pi/models.ts';

async function probe(exitCode: number | null): Promise<string[]> {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  child['stdout'] = Object.assign(new EventEmitter(), { setEncoding() {} });
  child['stderr'] = Object.assign(new EventEmitter(), { setEncoding() {} });
  child['stdin'] = Object.assign(new EventEmitter(), {
    end() {},
    write(raw: string, done?: () => void) {
      const request = JSON.parse(raw) as { id: string; type: string };
      queueMicrotask(() => {
        const data =
          request.type === 'get_state' ? { model: { provider: 'test', id: 'model' }, thinkingLevel: 'low' }
          : request.type === 'get_available_models' ? { models: [{ provider: 'test', id: 'model', reasoning: true }] }
          : { levels: ['off'] };
        (child['stdout'] as EventEmitter).emit('data', `${JSON.stringify({ type: 'response', id: request.id, success: true, data })}\n`);
        // The last answer and the exit land together: the exit wins the probe.
        if (request.type === 'get_available_thinking_levels' && exitCode !== null) child.emit('exit', exitCode);
        done?.();
      });
      return true;
    },
  });
  const seen: string[] = [];
  const ctx = {
    cwd: process.cwd(),
    provider: { id: 'pi', models: [], profiles: { linux: { executable: [{ kind: 'path', value: 'bun' }], launch: { args: [] } }, windows: { executable: [{ kind: 'path', value: 'bun' }], launch: { args: [] } }, macos: { executable: [{ kind: 'path', value: 'bun' }], launch: { args: [] } } } },
    accountId: 'fake',
    accountEnv: {},
    spawnChild: () => child,
    killTree: () => { seen.push('kill'); },
    log: (_level: string, message: string) => { seen.push(message); },
  };
  await readModels(ctx as never).catch((error: Error) => seen.push(error.message));
  return seen;
}

const MISMATCH = 'pi probe: the levels of test/model read as off,minimal,low,medium,high but the agent answered off';

test('a pi probe whose agent exits as it answers reports the exit alone, with no warning about a listing it drops', async () => {
  expect(await probe(3)).toEqual(['kill', 'the pi agent exited with code 3']);
});

test('a pi probe that keeps its listing warns about its levels before the agent is released', async () => {
  expect(await probe(null)).toEqual([MISMATCH, 'kill']);
});
