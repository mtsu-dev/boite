import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESENCE_LINK, PRESENCE_LOGO_ASSET, RpcErrorCode, type PresenceStatus } from '@boite/contracts';
import { connect } from '../src/client.ts';
import { encodeFrame, FrameReader, Op, socketCandidates, socketLabel } from '../src/presence/ipc.ts';
import { PresenceService, type PresenceOwner } from '../src/presence/service.ts';
import { startTestCore, waitFor, type TestCore } from './harness.ts';

/** A chat app on a socket, as Discord and arRPC answer: READY after the handshake, then every frame recorded. */
class FakeChatApp {
  readonly frames: { op: number; payload: any }[] = [];
  readonly sockets = new Set<Socket>();
  readonly server: Server;
  constructor(readonly path: string, user: { username: string; global_name?: string } | null) {
    this.server = createServer((socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      const reader = new FrameReader();
      socket.on('data', (chunk: Buffer) => {
        for (const frame of reader.push(chunk)) {
          this.frames.push(frame);
          if (frame.op === Op.Handshake) socket.write(encodeFrame(Op.Frame, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1, user } }));
        }
      });
    });
  }
  listen(): Promise<void> { return new Promise(resolve => this.server.listen(this.path, resolve)); }
  activities(): any[] { return this.frames.filter(f => f.op === Op.Frame && f.payload.cmd === 'SET_ACTIVITY').map(f => f.payload.args.activity ?? null); }
  close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    return new Promise(resolve => this.server.close(() => resolve()));
  }
}

let dir = '';
const apps: FakeChatApp[] = [];
const services: PresenceService[] = [];
let harness: TestCore | null = null;
afterEach(async () => {
  for (const service of services.splice(0)) service.close();
  for (const app of apps.splice(0)) await app.close();
  await harness?.stop();
  harness = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

async function chatApp(name: string, user: { username: string; global_name?: string } | null): Promise<FakeChatApp> {
  if (!dir) dir = mkdtempSync(join(tmpdir(), 'boite-presence-'));
  const app = new FakeChatApp(join(dir, name), user);
  await app.listen();
  apps.push(app);
  return app;
}

function owner(): PresenceOwner & { statuses: PresenceStatus[]; closeSocket(): void } {
  const closers: (() => void)[] = [];
  const statuses: PresenceStatus[] = [];
  return {
    id: 'owner-1', statuses,
    sendEvent: (_name, payload) => statuses.push(payload),
    onClose: (callback) => { closers.push(callback); return () => closers.splice(closers.indexOf(callback), 1); },
    closeSocket: () => { for (const close of closers.splice(0)) close(); },
  };
}

function service(paths: () => string[], paceMs = 4_000): PresenceService {
  const made = new PresenceService({ applicationId: '1234', log: () => {}, candidates: paths, paceMs, scanMs: 50 });
  services.push(made);
  return made;
}

test('one activity reaches Discord and a second chat app side by side, paced, then is cleared when the app that set it leaves', async () => {
  const discord = await chatApp('discord-ipc-0', { username: 'ada', global_name: 'Ada' });
  const bridge = await chatApp('discord-ipc-1', null);
  const presence = service(() => [discord.path, bridge.path, join(dir, 'discord-ipc-2')], 300);
  const app = owner();

  const status = await presence.set({ details: 'Working on boite', state: '2 agents · Opus 5.5', startedAt: 1_700_000_000_000, button: 'Get Boite' }, app);
  expect(status.active).toBe(true);
  await waitFor(() => discord.activities().length === 1 && bridge.activities().length === 1);
  expect(discord.frames[0]).toEqual({ op: Op.Handshake, payload: { v: 1, client_id: '1234' } });
  expect(discord.activities()[0]).toEqual({
    type: 0, details: 'Working on boite', state: '2 agents · Opus 5.5', timestamps: { start: 1_700_000_000_000 },
    assets: { large_image: PRESENCE_LOGO_ASSET, large_text: 'Boite' }, buttons: [{ label: 'Get Boite', url: PRESENCE_LINK }],
  });
  expect(presence.status().targets.sort((a, b) => a.socket.localeCompare(b.socket))).toEqual([{ socket: 'discord-ipc-0', user: 'Ada' }, { socket: 'discord-ipc-1', user: null }]);

  // Three changes inside one pace: the chat app gets the last, once, after the pause.
  await presence.set({ details: 'Working on boite', state: '3 agents' }, app);
  await presence.set({ details: 'Working on boite', state: '4 agents' }, app);
  await presence.set({ details: 'Working on boite', state: '5 agents' }, app);
  expect(discord.activities().length).toBe(1);
  await waitFor(() => discord.activities().length === 2);
  await Bun.sleep(400);
  expect(discord.activities().map(each => each?.state)).toEqual(['2 agents · Opus 5.5', '5 agents']);

  app.closeSocket();
  await waitFor(() => discord.sockets.size === 0 && bridge.sockets.size === 0);
  expect(discord.activities().at(-1)).toBeNull();
  expect(presence.status()).toEqual({ active: false, targets: [] });
});

test('a chat app started later gets the activity at the next look, and one that leaves is dropped from the status', async () => {
  if (!dir) dir = mkdtempSync(join(tmpdir(), 'boite-presence-'));
  const path = join(dir, 'discord-ipc-0');
  const presence = service(() => [path]);
  const app = owner();
  expect((await presence.set({ details: 'Idle in Boite' }, app)).targets).toEqual([]);
  const discord = await chatApp('discord-ipc-0', { username: 'ada' });
  await waitFor(() => discord.activities().length === 1);
  expect(app.statuses.at(-1)).toEqual({ active: true, targets: [{ socket: 'discord-ipc-0', user: 'ada' }] });
  await discord.close();
  apps.splice(apps.indexOf(discord), 1);
  await waitFor(() => app.statuses.at(-1)?.targets.length === 0);
});

test('a chat app\'s close frame or a refusal leaves the others showing', async () => {
  const quitting = await chatApp('discord-ipc-0', { username: 'ada' });
  const staying = await chatApp('discord-ipc-1', { username: 'ada' });
  const presence = service(() => [quitting.path, staying.path]);
  await presence.set({ details: 'Working' }, owner());
  await waitFor(() => quitting.activities().length === 1 && staying.activities().length === 1);
  for (const socket of quitting.sockets) socket.write(encodeFrame(Op.Close, { code: 4000, message: 'Invalid Client ID' }));
  await waitFor(() => presence.status().targets.length === 1);
  expect(presence.status().targets[0]!.socket).toBe('discord-ipc-1');
});

test('the sockets looked for: ten pipes on Windows, the runtime, temporary and sandbox folders elsewhere', () => {
  const windows = socketCandidates('win32', {});
  expect(windows).toHaveLength(10);
  expect(windows[0]).toBe('\\\\.\\pipe\\discord-ipc-0');
  expect(socketLabel(windows[3]!)).toBe('discord-ipc-3');
  const linux = socketCandidates('linux', { XDG_RUNTIME_DIR: '/run/user/1000', TMPDIR: '/tmp' });
  expect(linux[0]).toBe('/run/user/1000/discord-ipc-0');
  expect(linux).toContain('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0');
  expect(linux).toContain('/run/user/1000/app/dev.vencord.Vesktop/discord-ipc-9');
  expect(linux).toContain('/tmp/snap.discord/discord-ipc-0');
  expect(new Set(linux).size).toBe(linux.length);
  expect(socketLabel('/run/user/1000/app/dev.vencord.Vesktop/discord-ipc-1')).toBe('app/dev.vencord.Vesktop/discord-ipc-1');
});

test('presence.set checks its activity, is the owner\'s alone, and clears from any build', async () => {
  harness = await startTestCore();
  const client = await harness.connect();
  expect(await client.call('presence.set', { activity: { details: 'x' } } as never).catch(error => error)).toMatchObject({ rpc: { code: RpcErrorCode.InvalidParams, data: { field: 'activity.details' } } });
  expect(await client.call('presence.set', { activity: { details: 'Working', color: 'red' } } as never).catch(error => error)).toMatchObject({ rpc: { code: RpcErrorCode.InvalidParams, data: { field: 'activity.color' } } });
  expect(await client.call('presence.set', { activity: null })).toEqual({ active: false, targets: [] });
  const { grant } = await client.call('pairing.grant', {});
  const session = harness.core.sessions.exchange(grant, { name: 'phone', version: 'test' });
  const device = await connect(harness.url, session.token);
  try {
    expect(await device.call('presence.set', { activity: { details: 'Working' } }).catch(error => error)).toMatchObject({ rpc: { code: RpcErrorCode.Refused } });
  } finally { device.close(); }
});
