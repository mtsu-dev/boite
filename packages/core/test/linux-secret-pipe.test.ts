import { expect, test } from 'bun:test';
import { linuxSecretPipeRecipient } from '../src/platform/linux-secret-pipe.ts';

test('the BoiteOS host selects the pipe route from the core checkout and environment', () => {
  const before = { path: process.env.PATH, thread: process.env.BOITEOS_THREAD, socket: process.env.BOITEOS_AGENTS_SOCKET };
  try {
    process.env.PATH = '/usr/lib/boiteos/agents/bin:/usr/bin';
    process.env.BOITEOS_AGENTS_SOCKET = '/fixture/agents.sock';
    delete process.env.BOITEOS_THREAD;
    const root = '/fixture/project/.boite/worktrees/thread';
    const env = { PATH: '/usr/bin', BOITEOS_AGENTS_SOCKET: '/caller/socket', BOITEOS_THREAD: undefined };
    const route = linuxSecretPipeRecipient('recipient', ['store'], env, root);
    expect(route).toMatchObject({
      command: '/usr/bin/os',
      env: { BOITEOS_AGENTS_SOCKET: '/fixture/agents.sock' },
    });
    expect(route.args.slice(0, 5)).toEqual(['agent', 'exec', '--secret-pipe-report', root, '--']);
    expect(linuxSecretPipeRecipient('recipient', ['store'], { ...env, BOITEOS_THREAD: 'caller-thread' }, root)).toEqual(route);
  } finally {
    for (const [name, value] of Object.entries({ PATH: before.path, BOITEOS_THREAD: before.thread, BOITEOS_AGENTS_SOCKET: before.socket })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
