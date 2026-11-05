import { describe, expect, test } from 'bun:test';
import { dispatch, type CommandContext } from '../src/index.ts';

function run(argv: string[], handlers: Parameters<typeof dispatch>[0], env: Record<string, string> = {}) {
  const lines: string[] = [];
  return dispatch(handlers, { argv, env, cwd: '/work', stderr: line => lines.push(line) }).then(code => ({ code, lines }));
}

describe('dispatch', () => {
  test('runs the handler argv[0] names with the rest and its context', async () => {
    let seen: { args: string[]; ctx: Omit<CommandContext, 'connect'> } | null = null;
    const { code } = await run(['hello-threads', '--json', 'x'], {
      'hello-threads': (args, { connect: _connect, ...ctx }) => { seen = { args, ctx }; },
    }, { BOITE_CALLER_THREAD_ID: 'thr_1', BOITE_PLUGIN_ID: 'hello', BOITE_PLUGIN_DATA: '/data/hello' });
    expect(code).toBe(0);
    expect(seen!).toEqual({
      args: ['--json', 'x'],
      ctx: { name: 'hello-threads', cwd: '/work', callerThreadId: 'thr_1', pluginId: 'hello', dataDir: '/data/hello' },
    });
  });

  test('answers the exit code the handler returns, and 1 with its message when it throws', async () => {
    expect((await run(['a'], { a: async () => 3 })).code).toBe(3);
    const thrown = await run(['a'], { a: () => { throw new Error('no project here'); } });
    expect(thrown).toEqual({ code: 1, lines: ['no project here'] });
  });

  test('an unknown or missing name prints the usage and answers 2', async () => {
    const handlers = { b: () => 0, a: () => 0 };
    expect(await run(['nope'], handlers)).toEqual({
      code: 2,
      lines: ['unknown command: nope', 'usage: boite <command> [args...], where <command> is a, b'],
    });
    expect((await run([], handlers)).code).toBe(2);
    // An inherited property is no command.
    expect((await run(['toString'], handlers)).code).toBe(2);
  });

  test('an empty argv runs the service when there is one', async () => {
    let ran = '';
    const code = await dispatch({ a: () => 0 }, { argv: [], env: { BOITE_PLUGIN_ID: 'hello' }, service: ctx => { ran = ctx.pluginId; return 4; } });
    expect({ code, ran }).toEqual({ code: 4, ran: 'hello' });
  });

  test('no caller thread is null; connect without the core variables names the missing one', async () => {
    const { code, lines } = await run(['a'], {
      a: async (_args, ctx) => {
        expect(ctx.callerThreadId).toBeNull();
        await ctx.connect();
      },
    });
    expect(code).toBe(1);
    expect(lines[0]).toStartWith('BOITE_CORE_URL is not set');
  });
});
