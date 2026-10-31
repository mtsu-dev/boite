import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AGENT_ENV, RpcErrorCode, virtualDesktopCommandError, virtualDesktopSizeError } from '@boite/contracts';
import { runCli } from '../src/cli.ts';
import { desktopCommand, inBoiteWords } from '../src/desktop-cli.ts';
import { AgentDesktopTool, type AgentDesktopRelease } from '../src/desktop/agent-desktop.ts';
import { parse } from '../src/cli-args.ts';
import { DESKTOP_MARK, desktopEnv, withDesktopEnv } from '../src/desktop/env.ts';
import { findDesktopTools, markedProcesses, VirtualDesktops, xauthority, type DesktopTools } from '../src/desktop/service.ts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

test('the Xauthority file holds one cookie for any address and display, as libXau reads it', () => {
  const cookie = Uint8Array.from({ length: 16 }, (_, at) => at);
  const file = xauthority(cookie);
  // family FamilyWild, empty address, empty display number, then the name and the cookie, each with a big-endian length.
  expect([...file.subarray(0, 6)]).toEqual([0xff, 0xff, 0, 0, 0, 0]);
  expect(file.readUInt16BE(6)).toBe(18);
  expect(file.subarray(8, 26).toString()).toBe('MIT-MAGIC-COOKIE-1');
  expect(file.readUInt16BE(26)).toBe(16);
  expect([...file.subarray(28)]).toEqual([...cookie]);
});

test('a desktop program keeps the user\'s Wayland, session bus and sound out', () => {
  const env = withDesktopEnv({ PATH: '/bin', WAYLAND_DISPLAY: 'wayland-0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', NO_AT_BRIDGE: '1', HOME: '/home/u' },
    desktopEnv('/tmp/boite-desktop-x', ':7', 'unix:path=/tmp/boite-desktop-x/bus', 'abc'));
  expect(env).toMatchObject({ PATH: '/bin', DISPLAY: ':7', XAUTHORITY: '/tmp/boite-desktop-x/Xauthority', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/boite-desktop-x/bus',
    QT_ACCESSIBILITY: '1', ACCESSIBILITY_ENABLED: '1', PULSE_SERVER: 'unix:/tmp/boite-desktop-x/no-sound', AGENT_DESKTOP_HOME: '/tmp/boite-desktop-x/agent-desktop', [DESKTOP_MARK]: 'abc' });
  expect(env['WAYLAND_DISPLAY']).toBeUndefined();
  expect(env['NO_AT_BRIDGE']).toBeUndefined();
  // A single-instance app finds its lock in the desktop's own folders, never the one of the user's running copy.
  for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR']) expect(env[key]).toStartWith('/tmp/boite-desktop-x/');
});

test('the tools a desktop needs are named by package, and only Linux has one', () => {
  expect(findDesktopTools('win32')).toMatchObject({ available: false });
  const none = findDesktopTools('linux', () => null, () => false);
  expect(none).toEqual({ available: false, missing: ['xvfb', 'dbus-daemon', 'at-spi2-core', 'openbox'], reason: 'missing xvfb, dbus-daemon, at-spi2-core, openbox: install them with the system\'s package manager (apt install xvfb dbus-daemon at-spi2-core openbox)' });
  const all = findDesktopTools('linux', name => name === 'dbus-send' ? null : `/usr/bin/${name}`, path => path === '/usr/lib/at-spi2-core/at-spi-bus-launcher');
  expect(all).toEqual({ xvfb: '/usr/bin/Xvfb', dbus: '/usr/bin/dbus-daemon', openbox: '/usr/bin/openbox', atspi: '/usr/lib/at-spi2-core/at-spi-bus-launcher', dbusSend: null });
});

test('desktop sizes and commands are checked before anything starts', () => {
  expect(virtualDesktopSizeError(undefined, undefined)).toBeNull();
  expect(virtualDesktopSizeError(1280, 800)).toBeNull();
  expect(virtualDesktopSizeError(100, 800)).toContain('320 to 3840');
  expect(virtualDesktopSizeError(1280.5, 800)).toContain('whole pixels');
  expect(virtualDesktopCommandError(['gedit', 'notes.txt'])).toBeNull();
  expect(virtualDesktopCommandError([])).toContain('1 to 256 words');
  expect(virtualDesktopCommandError([''])).toBe('command must start with a program');
  expect(virtualDesktopCommandError(['a\0b'])).toContain('no NUL');
});

test('every word after a desktop command is its own: agent-desktop flags and the program run takes', () => {
  expect(parse(['desktop', 'snapshot', '--app', 'gedit', '-i', '--json']).positional).toEqual(['desktop', 'snapshot', '--app', 'gedit', '-i', '--json']);
  expect(parse(['desktop', 'run', 'google-chrome', '--force-renderer-accessibility', '--', '--thread', 'x']).positional)
    .toEqual(['desktop', 'run', 'google-chrome', '--force-renderer-accessibility', '--', '--thread', 'x']);
  expect(parse(['--json', 'desktop', 'status']).json).toBe(true);
});

test('--help after -- is text to type, so the command still runs on the desktop', async () => {
  const asked: string[] = [];
  const client = { call: async (method: string) => { asked.push(method); return { session: null, support: { available: true } }; } } as unknown as Parameters<typeof desktopCommand>[2];
  expect(await thrown(desktopCommand(['type', '@e1', '--', '--help'], { cwd: '/', env: { PATH: '' }, out: () => {}, err: () => {} }, client, 'thr'))).toThrow('no desktop yet');
  expect(asked).toEqual(['desktop.status']);
});

test('a desktop the policy turned off takes no more commands, and only a failed install falls back to an agent-desktop on PATH', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boite-desktop-path-'));
  try {
    writeFileSync(join(dir, 'agent-desktop'), '#!/bin/sh\necho own "$@"\n');
    chmodSync(join(dir, 'agent-desktop'), 0o755);
    const io = { cwd: dir, env: { PATH: `${dir}:/usr/bin:/bin` }, out: () => {}, err: () => {} };
    const session = { display: ':9', width: 1280, height: 800, apps: [], env: { DISPLAY: ':9' } };
    const fails = (code: number) => Object.assign(new Error(`tool ${code}`), { rpc: { code, message: `tool ${code}` } });
    const client = (status: { available: boolean; reason?: string }, tool: number) => ({
      call: async (method: string) => {
        if (method === 'desktop.status') return { session, support: status };
        throw fails(tool);
      },
    }) as unknown as Parameters<typeof desktopCommand>[2];
    // Still running when the policy file came: the CLI refuses before any agent-desktop runs.
    const off = { available: false, reason: 'the machine policy turns it off (key agentDesktop)' };
    expect(await thrown(desktopCommand(['launch', 'xterm'], io, client(off, RpcErrorCode.Refused), 'thr'))).toThrow('key agentDesktop');
    expect(await thrown(desktopCommand(['skills', 'get', 'desktop'], io, client(off, RpcErrorCode.Refused), 'thr'))).toThrow(`tool ${RpcErrorCode.Refused}`);
    // The download failed, or an older core lacks desktop.tool: the agent's own agent-desktop runs.
    for (const code of [RpcErrorCode.Unavailable, RpcErrorCode.MethodNotFound]) {
      expect((await desktopCommand(['click', '@s1:e1'], io, client({ available: true }, code), 'thr')).output?.stdout).toBe('own click @s1:e1\n');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A desktop whose four programs are fakes the test holds: Xvfb's readiness and openbox's stop wait on gates. */
function fakeStack() {
  const gate = () => { let open!: () => void; const opened = new Promise<void>(resolve => { open = resolve; }); return { opened, open }; };
  const thread = { id: 'thr_fake', archived: false };
  const spawned: { command: string; stopped: boolean; stopAsked: boolean }[] = [];
  const gates: { xvfb?: ReturnType<typeof gate>; openboxStop?: ReturnType<typeof gate> } = {};
  let pid = 4_000_000;
  const core = {
    threads: { require: () => thread },
    logs: { info: () => {} },
    policy: { agentDesktopOff: () => false },
    procs: { protection: { policy: () => null }, spawn: (_scope: string, command: string) => {
      let stdout!: ReadableStreamDefaultController<Uint8Array>, stderr!: ReadableStreamDefaultController<Uint8Array>, exit!: (code: number) => void;
      const exited = new Promise<number>(resolve => { exit = resolve; });
      const entry = { command, stopped: false, stopAsked: false };
      spawned.push(entry);
      const stopGate = command === 'openbox' ? gates.openboxStop : undefined;
      const proc = { stdout: new ReadableStream<Uint8Array>({ start: c => { stdout = c; } }), stderr: new ReadableStream<Uint8Array>({ start: c => { stderr = c; } }) };
      const ready = { Xvfb: '99', 'dbus-daemon': 'unix:path=/nowhere', openbox: 'boite-desktop-ready' }[command];
      const say = () => { if (ready && !entry.stopped) stdout.enqueue(new TextEncoder().encode(`${ready}\n`)); };
      if (command === 'Xvfb' && gates.xvfb) void gates.xvfb.opened.then(say); else say();
      return { proc, exited, record: { pid: (pid += 1) }, stop: async () => {
        entry.stopAsked = true;
        await stopGate?.opened;
        if (entry.stopped) return;
        entry.stopped = true;
        stdout.close(); stderr.close(); exit(0);
      } };
    } },
  };
  const tools: DesktopTools = { xvfb: 'Xvfb', dbus: 'dbus-daemon', atspi: 'at-spi-bus-launcher', openbox: 'openbox', dbusSend: null };
  // The real tool would download agent-desktop on the first start.
  const agentDesktop = { path: async () => '/fake/agent-desktop', version: '0.0.0' } as unknown as AgentDesktopTool;
  const desktops = new VirtualDesktops(core as unknown as ConstructorParameters<typeof VirtualDesktops>[0], { tools: () => tools, agentDesktop });
  const live = () => spawned.filter(entry => !entry.stopped).length;
  const until = async (done: () => boolean) => { for (let at = 0; !done(); at += 1) { if (at > 2_000) throw new Error('timed out'); await Bun.sleep(1); } };
  return { desktops, thread, spawned, live, until, holdXvfb: () => (gates.xvfb = gate()), holdOpenboxStop: () => (gates.openboxStop = gate()) };
}

test('the core stopping while a desktop starts stops it at once, without waiting for it to be ready', async () => {
  const stack = fakeStack();
  // Xvfb never says it is ready: the stop must not wait out the start timeout.
  stack.holdXvfb();
  const start = thrown(stack.desktops.start({ threadId: stack.thread.id }));
  await stack.until(() => stack.spawned.length === 1);
  const began = performance.now();
  await stack.desktops.stopAll();
  expect(performance.now() - began).toBeLessThan(1_000);
  expect(await start).toThrow('archived or Boite is stopping');
  expect(stack.live()).toBe(0);
  expect(stack.desktops.status({ threadId: stack.thread.id }).session).toBeNull();
  expect(await thrown(stack.desktops.start({ threadId: stack.thread.id }))).toThrow('Boite is stopping');
});

test('a second stop waits for the first one to finish', async () => {
  const stack = fakeStack();
  const openbox = stack.holdOpenboxStop();
  await stack.desktops.start({ threadId: stack.thread.id });
  const first = stack.desktops.stop({ threadId: stack.thread.id });
  await stack.until(() => stack.spawned.some(entry => entry.stopAsked));
  let secondDone = false;
  const second = stack.desktops.stop({ threadId: stack.thread.id }).then(result => { secondDone = true; return result; });
  await Bun.sleep(20);
  expect(secondDone).toBe(false);
  openbox.open();
  expect(await second).toEqual({ stopped: true });
  await first;
  expect(stack.live()).toBe(0);
});

test('archiving while the desktop restarts stops the new one too', async () => {
  const stack = fakeStack();
  const openbox = stack.holdOpenboxStop();
  await stack.desktops.start({ threadId: stack.thread.id });
  const stop = stack.desktops.stop({ threadId: stack.thread.id });
  await stack.until(() => stack.spawned.some(entry => entry.stopAsked));
  const xvfb = stack.holdXvfb();
  // Settled at once: the cancel fails it while the test still waits on the first stop.
  const restart = thrown(stack.desktops.start({ threadId: stack.thread.id }));
  await stack.until(() => stack.spawned.length === 5);
  stack.thread.archived = true;
  stack.desktops.release(stack.thread.id);
  openbox.open();
  xvfb.open();
  await stop;
  expect(await restart).toThrow('archived');
  expect(stack.live()).toBe(0);
  expect(stack.desktops.status({ threadId: stack.thread.id }).session).toBeNull();
});

test('a program still starts with a log after something on the desktop removed the logs folder', async () => {
  const stack = fakeStack();
  const { session } = await stack.desktops.start({ threadId: stack.thread.id });
  rmSync(join(dirname(session.env['XAUTHORITY']!), 'logs'), { recursive: true });
  const { app } = await stack.desktops.run({ threadId: stack.thread.id, command: ['app'], cwd: tmpdir() });
  expect(existsSync(app.log)).toBe(true);
  expect(stack.desktops.status({ threadId: stack.thread.id }).session!.apps.map(entry => entry.pid)).toEqual([app.pid]);
  await stack.desktops.stop({ threadId: stack.thread.id });
  expect(stack.live()).toBe(0);
});

test('agent-desktop\'s guide and help speak boite desktop, and its prose and app text stay as written', () => {
  expect(inBoiteWords('1. Run `agent-desktop status`. Then `agent-desktop <command> --help`.')).toBe('1. Run `boite desktop status`. Then `boite desktop <command> --help`.');
  // Code lines inside a JSON envelope, where a newline is the two characters \n.
  expect(inBoiteWords('```\\nagent-desktop snapshot -i\\nagent-desktop click @s1:e2\\n```')).toBe('```\\nboite desktop snapshot -i\\nboite desktop click @s1:e2\\n```');
  expect(inBoiteWords('Usage: agent-desktop snapshot [OPTIONS]')).toBe('Usage: boite desktop snapshot [OPTIONS]');
  expect(inBoiteWords('Use the agent-desktop CLI. requirements:\\n  - agent-desktop\\n')).toBe('Use the agent-desktop CLI. requirements:\\n  - agent-desktop\\n');
  // Lines of the real 1.0.2 `--help` (indented examples) and of its platform guide (a command substitution).
  expect(inBoiteWords('Start here:\n  agent-desktop skills get desktop     Core guide\nExamples:\n  agent-desktop click @s8f3k2p9:e5\n'))
    .toBe('Start here:\n  boite desktop skills get desktop     Core guide\nExamples:\n  boite desktop click @s8f3k2p9:e5\n');
  expect(inBoiteWords('```bash\\nsession_id=$(agent-desktop session start --name doc)\\n  agent-desktop session end "$session_id"\\n```'))
    .toBe('```bash\\nsession_id=$(boite desktop session start --name doc)\\n  boite desktop session end "$session_id"\\n```');
  expect(inBoiteWords('`AGENT_DESKTOP_HOME` or `~/.agent-desktop` stays')).toBe('`AGENT_DESKTOP_HOME` or `~/.agent-desktop` stays');
});

describe('the agent-desktop Boite installs', () => {
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  let dir: string, harness: TestCore;

  /** A release archive laid out like the npm one, with a binary and its clipboard helper for x64. */
  const release = (tamper: { archive?: boolean; entry?: boolean } = {}) => {
    const src = mkdtempSync(join(dir, 'src-'));
    mkdirSync(join(src, 'package', 'bin'), { recursive: true });
    const tool = '#!/bin/sh\necho agent-desktop "$@"\n';
    const helper = '#!/bin/sh\nexit 0\n';
    writeFileSync(join(src, 'package', 'bin', 'agent-desktop-linux-x64'), tamper.entry ? `${tool}# changed\n` : tool);
    writeFileSync(join(src, 'package', 'bin', 'helper-x64'), helper);
    const tgz = join(src, 'r.tgz');
    expect(Bun.spawnSync(['tar', '-czf', tgz, '-C', src, 'package']).exitCode).toBe(0);
    const archive = readFileSync(tgz);
    const pinned: AgentDesktopRelease = {
      version: '9.9.9', url: 'https://registry.example/agent-desktop-9.9.9.tgz',
      sha256: tamper.archive ? sha(new TextEncoder().encode('another')) : sha(archive),
      builds: { x64: [
        { entry: 'package/bin/agent-desktop-linux-x64', name: 'agent-desktop', sha256: sha(new TextEncoder().encode(tool)) },
        { entry: 'package/bin/helper-x64', name: 'agent-desktop-linux-clipboard-owner', sha256: sha(new TextEncoder().encode(helper)) },
      ] },
    };
    const fetched: string[] = [];
    const fetch = async (url: string) => { fetched.push(url); await Bun.sleep(5); return new Response(archive); };
    return { pinned, fetched, fetch };
  };

  beforeEach(async () => {
    harness = await startTestCore();
    dir = mkdtempSync(join(harness.dataDir, 'tool-'));
  });

  afterEach(async () => {
    await harness.stop();
  });

  test('the pinned release is fetched once, checked, kept executable and reused by the next core', async () => {
    const { pinned, fetched, fetch } = release();
    const tools = join(dir, 'tools');
    const tool = new AgentDesktopTool(tools, harness.core.procs, { release: pinned, arch: 'x64', fetch });
    // Two commands at once share one download.
    const [path, again] = await Promise.all([tool.path(), tool.path()]);
    expect(dirname(dirname(path))).toBe(join(tools, 'agent-desktop-9.9.9'));
    expect(again).toBe(path);
    expect(fetched).toEqual([pinned.url]);
    expect(readdirSync(dirname(path)).sort()).toEqual(['agent-desktop', 'agent-desktop-linux-clipboard-owner']);
    expect(statSync(path).mode & 0o777).toBe(0o755);
    expect(Bun.spawnSync([path, 'version']).stdout.toString()).toBe('agent-desktop version\n');
    // Nothing staged is left beside it.
    expect(readdirSync(tools)).toEqual(['agent-desktop-9.9.9']);
    expect(readdirSync(join(tools, 'agent-desktop-9.9.9'))).toHaveLength(1);
    const next = new AgentDesktopTool(tools, harness.core.procs, { release: pinned, arch: 'x64', fetch });
    expect(await next.path()).toBe(path);
    expect(fetched).toHaveLength(1);
  });

  test('an archive or a file that does not match its digest installs nothing, and a damaged install is replaced', async () => {
    const tools = join(dir, 'tools');
    for (const tamper of [{ archive: true }, { entry: true }]) {
      const { pinned, fetch } = release(tamper);
      const tool = new AgentDesktopTool(tools, harness.core.procs, { release: pinned, arch: 'x64', fetch });
      expect(await thrown(tool.path())).toThrow(tamper.archive ? 'does not match its pinned SHA-256; nothing was installed' : 'package/bin/agent-desktop-linux-x64 does not match its pinned SHA-256');
      const folder = join(tools, 'agent-desktop-9.9.9');
      expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
    }
    const { pinned, fetched, fetch } = release();
    const damaged = await new AgentDesktopTool(tools, harness.core.procs, { release: pinned, arch: 'x64', fetch }).path();
    writeFileSync(damaged, 'truncated');
    const path = await new AgentDesktopTool(tools, harness.core.procs, { release: pinned, arch: 'x64', fetch }).path();
    expect(fetched).toHaveLength(2);
    expect(sha(readFileSync(path))).toBe(pinned.builds.x64![0]!.sha256);
    expect(existsSync(dirname(damaged))).toBe(false);
    expect(await thrown(new AgentDesktopTool(tools, harness.core.procs, { release: pinned, arch: 'riscv64', fetch }).path())).toThrow('has no Linux build for riscv64');
  });

  test('cores sharing a data dir never remove an install another returned, even while one repairs a damaged install', async () => {
    const { pinned, fetched, fetch } = release();
    const tools = join(dir, 'tools');
    const tool = () => new AgentDesktopTool(tools, harness.core.procs, { release: pinned, arch: 'x64', fetch });
    const intact = (path: string) => existsSync(path) && sha(readFileSync(path)) === pinned.builds.x64![0]!.sha256;
    // Two at once: each keeps the install it made, both stay.
    const [first, second] = await Promise.all([tool().path(), tool().path()]);
    expect(fetched).toHaveLength(2);
    expect([intact(first), intact(second)]).toEqual([true, true]);
    // Both damaged, then two cores repair at once: each removes only damaged folders, and what each returns stays.
    writeFileSync(first, 'truncated');
    writeFileSync(second, 'truncated');
    const repaired = await Promise.all([tool().path(), tool().path()]);
    expect(repaired.map(intact)).toEqual([true, true]);
    expect(existsSync(first) || existsSync(second)).toBe(false);
    // A later core finds one of them without a download.
    expect(repaired).toContain(await tool().path());
    expect(fetched).toHaveLength(4);
  });
});

describe('boite desktop', () => {
  let harness: TestCore, threadId: string, cwd: string;

  const cli = async (...args: string[]) => cliOf(threadId, ...args);
  const cliOf = async (thread: string, ...args: string[]) => {
    let out = '', error = '';
    const code = await runCli(['desktop', ...args], { cwd,
      env: { PATH: process.env['PATH'], [AGENT_ENV.threadId]: thread, [AGENT_ENV.coreUrl]: harness.url, [AGENT_ENV.token]: harness.core.agents.tokenFor(thread) },
      out: text => { out += text; }, err: text => { error += text; } });
    return { code, out, error };
  };

  const useTools = (tools: () => ReturnType<typeof findDesktopTools>) => {
    const core = harness.core as { desktops: VirtualDesktops };
    // No download in tests: the CLI falls back to an agent-desktop on PATH, as on a machine that refuses it.
    const agentDesktop = new AgentDesktopTool(join(harness.dataDir, 'tools'), harness.core.procs, { fetch: async () => { throw new Error('no network in tests'); } });
    core.desktops = new VirtualDesktops(harness.core, { tools, tempRoot: harness.dataDir, agentDesktop });
  };

  beforeEach(async () => {
    harness = await startTestCore();
    const owner = await harness.connect();
    ({ threadId } = await echoThread(harness, owner));
    owner.close();
    cwd = realpathSync(harness.core.threads.require(threadId).cwd);
  });

  afterEach(async () => {
    await harness.stop();
  });

  test('a machine without the tools says what to install and starts nothing', async () => {
    useTools(() => findDesktopTools('linux', () => null, () => false));
    const status = await cli('status');
    expect(status.code).toBe(0);
    expect(status.out).toContain('no virtual desktop on this machine: missing xvfb, dbus-daemon, at-spi2-core, openbox');
    expect(status.out).toContain('desktop: not started');
    const run = await cli('run', 'gedit');
    expect(run.code).toBe(1);
    expect(run.error).toContain('no virtual desktop on this machine: missing xvfb');
    const snapshot = await cli('snapshot', '-i');
    expect(snapshot.error).toContain('error: no virtual desktop on this machine');
    expect((await cli('stop')).out).toContain('no desktop was running');
  });

  const tools = findDesktopTools();
  const real = 'xvfb' in tools ? tools as DesktopTools : null;

  test.skipIf(!real)('run starts a desktop of its own, its app reaches it, and archiving stops every process of it', async () => {
    useTools(() => real!);
    const run = await cli('run', 'sleep', '300');
    expect(run.error).toBe('');
    const pid = Number(/running as pid (\d+)/.exec(run.out)?.[1]);
    const status = await harness.core.desktops.status({ threadId });
    const session = status.session!;
    expect(session.display).toMatch(/^:\d+$/);
    expect(session.apps).toMatchObject([{ pid, command: 'sleep 300', exitCode: null }]);
    const environ = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    expect(environ).toContain(`DISPLAY=${session.display}`);
    expect(environ).toContain(`XAUTHORITY=${session.env['XAUTHORITY']}`);
    expect(environ.some(entry => entry.startsWith('WAYLAND_DISPLAY='))).toBe(false);
    // Xvfb, dbus-daemon, the accessibility launcher with its own bus, openbox and the app.
    const mark = session.env[DESKTOP_MARK]!;
    expect(markedProcesses(mark).length).toBeGreaterThanOrEqual(5);
    // The display takes only clients holding its cookie: another account on the machine gets nothing.
    const opens = (xauthority: string) => Bun.spawnSync({
      cmd: [process.execPath, '-e', `const x = require('bun:ffi').dlopen('libX11.so.6', { XOpenDisplay: { args: ['ptr'], returns: 'ptr' } }); console.log(x.symbols.XOpenDisplay(null) ? 'open' : 'refused')`],
      env: { ...process.env, DISPLAY: session.display, XAUTHORITY: xauthority },
    }).stdout.toString().trim();
    expect(opens(session.env['XAUTHORITY']!)).toBe('open');
    expect(opens('/dev/null')).toBe('refused');
    // Nothing starts on demand on the desktop's bus: a keyring asking for a new password once covered the agent's app.
    if (real!.dbusSend) {
      const activatable = Bun.spawnSync({ cmd: [real!.dbusSend, '--session', '--print-reply', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.ListActivatableNames'],
        env: withDesktopEnv(process.env, session.env) as Record<string, string> }).stdout.toString();
      expect(activatable).toContain('org.freedesktop.DBus');
      expect(activatable).not.toContain('org.freedesktop.secrets');
      expect(activatable).not.toContain('org.gnome.keyring');
    }
    const env = await cli('env');
    expect(env.out).toContain(`export DISPLAY=${session.display}\n`);
    expect(env.out).toContain('unset WAYLAND_DISPLAY\n');
    // A shell that evals these lines must not carry the mark, or the stop would kill its own `boite desktop stop`.
    expect(env.out).not.toContain(DESKTOP_MARK);
    // A second run joins the same desktop.
    await cli('run', 'sleep', '301');
    expect((await harness.core.desktops.status({ threadId })).session!.display).toBe(session.display);

    const owner = await harness.connect();
    await owner.call('threads.archive', { threadId });
    owner.close();
    const deadline = Date.now() + 10_000;
    // The archive answers first; the desktop stops behind it.
    while (harness.core.desktops.status({ threadId }).session && Date.now() < deadline) await Bun.sleep(100);
    expect(harness.core.desktops.status({ threadId }).session).toBeNull();
    expect(markedProcesses(mark)).toEqual([]);
    expect(existsSync(join(session.env['XAUTHORITY']!, '..'))).toBe(false);
  }, 30_000);

  test.skipIf(!real)('stop ends the desktop, and a program that exits at once reports its code and log', async () => {
    useTools(() => real!);
    const failed = await cli('run', 'sh', '-c', 'echo broken >&2; exit 3');
    expect(failed.out).toContain('exited at once with code 3');
    const log = /its output is in (\S+)/.exec(failed.out)?.[1];
    expect(readFileSync(log!, 'utf8')).toBe('broken\n');
    const mark = (await harness.core.desktops.status({ threadId })).session!.env[DESKTOP_MARK]!;
    expect((await cli('stop')).out).toContain('desktop stopped');
    expect(markedProcesses(mark)).toEqual([]);
    expect((await cli('status')).out).toContain('desktop: not started');
  }, 30_000);

  // Opt-in: agent-desktop and Chrome from PATH, as an agent would use them.
  const live = real && process.env['BOITE_E2E_DESKTOP'] === '1' && Bun.which('agent-desktop') && Bun.which('google-chrome');
  test.skipIf(!live)('agent-desktop reads and clicks a Chrome page on the desktop, and each desktop has its own Chrome', async () => {
    useTools(() => real!);
    // No --user-data-dir: Chrome's profile, lock and socket come from the desktop's own XDG folders.
    const chrome = (title: string, body = '') => ['run', 'google-chrome', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=800,600', `data:text/html,<title>${title}</title>${body}`];
    await cli(...chrome('Proof', `<button onclick="document.title='clicked'">Valider</button>`));
    let ref: string | undefined;
    for (let attempt = 0; attempt < 20 && !ref; attempt += 1) {
      await Bun.sleep(500);
      const snapshot = await cli('snapshot', '--app', 'chrome', '-i', '--compact');
      ref = /"ref_id":"(@[^"]+)"[^{}]*"name":"Valider"|"name":"Valider"[^{}]*"ref_id":"(@[^"]+)"/.exec(snapshot.out)?.slice(1).find(Boolean);
    }
    expect(ref).toBeDefined();
    expect((await cli('click', ref!)).code).toBe(0);
    await Bun.sleep(500);
    expect((await cli('list-windows', '--app', 'chrome')).out).toContain('clicked - Google Chrome');

    // Another conversation's Chrome opens on its own desktop instead of handing its page to the first one.
    const owner = await harness.connect();
    const other = (await echoThread(harness, owner, 'second desktop')).threadId;
    owner.close();
    await cliOf(other, ...chrome('Second'));
    let second = '';
    for (let attempt = 0; attempt < 20 && !second.includes('Second - Google Chrome'); attempt += 1) {
      await Bun.sleep(500);
      second = (await cliOf(other, 'list-windows', '--app', 'chrome')).out;
    }
    expect(second).toContain('Second - Google Chrome');
    expect((await cli('list-windows', '--app', 'chrome')).out).not.toContain('Second');
  }, 90_000);
});
