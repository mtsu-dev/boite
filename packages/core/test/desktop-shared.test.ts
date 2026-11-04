/*
 * `boite desktop` on Windows and macOS (docs/desktop.md#windows-and-macos):
 * the desktop shares the user's session, so only semantic input passes and, on
 * macOS, only toward the apps the conversation started.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AGENT_ENV } from '@boite/contracts';
import { runCli } from '../src/cli.ts';
import { AgentDesktopTool } from '../src/desktop/agent-desktop.ts';
import { DESKTOP_EXEC, desktopExecCommand } from '../src/desktop/launcher.ts';
import { descendants, macosTargetProblem, ownedListing, sharedSessionRefusal, type ListedWindow } from '../src/desktop/scope.ts';
import { macosProgram, VirtualDesktops, type VirtualDesktopsOptions } from '../src/desktop/service.ts';
import { hiddenDesktops, quoteWindowsArg, windowsCommandLine } from '../src/platform/windows/hidden-desktop.ts';
import type { HiddenDesktop, HiddenDesktops } from '../src/platform/types.ts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

test('where the session is shared, only semantic input reaches the apps', () => {
  expect(sharedSessionRefusal('x11', ['press', 'ctrl+c'])).toBeNull();
  for (const args of [['snapshot', '--window-id', 'w-1', '-i'], ['click', '@s1:e1'], ['set-value', '@s1:e1', '--', '--headed'], ['snapshot', '--surface=menu', '--app', 'x'], ['wait', '500']]) {
    expect(sharedSessionRefusal('windows', args)).toBeNull();
  }
  expect(sharedSessionRefusal('windows', ['click', '--headed', '@s1:e1'])).toContain('--headed is refused on a hidden Windows desktop');
  expect(sharedSessionRefusal('windows', ['press', 'ctrl+c'])).toContain('press is refused on a hidden Windows desktop');
  expect(sharedSessionRefusal('windows', ['clipboard-get'])).toContain('the user\'s clipboard');
  expect(sharedSessionRefusal('windows', ['launch', 'notepad'])).toContain('boite desktop run');
  expect(sharedSessionRefusal('windows', ['frobnicate'])).toContain('is not one boite desktop runs');
  expect(sharedSessionRefusal('windows', ['snapshot', '--surface', 'dock'])).toContain('the user\'s, not an app\'s');
  expect(sharedSessionRefusal('windows', ['wait', '--notification'])).toContain('notifications');
  expect(sharedSessionRefusal('macos', ['type', '@s1:e1', 'hello'])).toContain('type is refused on macOS, among the user\'s own apps');
});

test('on macOS a command reaches only the apps the conversation started', () => {
  const windows: ListedWindow[] = [
    { id: 'w-1', pid: 10, app_name: 'TextEdit', title: 'Notes' },
    { id: 'w-2', pid: 20, app_name: 'TextEdit', title: 'The user\'s letter' },
    { id: 'w-3', pid: 11, app_name: 'Preview' },
  ];
  const owned = new Set([10, 11]);
  expect(macosTargetProblem(['snapshot', '--window-id', 'w-1'], windows, owned)).toBeNull();
  expect(macosTargetProblem(['snapshot', '--window-id', 'w-2'], windows, owned)).toBe('window w-2 is not one of this conversation\'s apps; its windows: w-1 (TextEdit: Notes), w-3 (Preview)');
  // The user runs TextEdit too: the app name alone could reach their window.
  expect(macosTargetProblem(['snapshot', '--app', 'textedit.app'], windows, owned)).toBe('the user runs textedit.app too: name the window with --window-id w-1');
  expect(macosTargetProblem(['snapshot', '--app', 'Preview'], windows, owned)).toBeNull();
  expect(macosTargetProblem(['snapshot', '--app', 'Safari'], windows, owned)).toContain('start it with boite desktop run');
  // Words after -- are text, never a target.
  expect(macosTargetProblem(['set-value', '--app', 'Preview', '--', '--window-id', 'w-2'], windows, owned)).toBeNull();
  // A snapshot's refs only reach the apps it was aimed at.
  expect(macosTargetProblem(['click', '@s8f3k2p9:e1'], windows, owned)).toBeNull();
  expect(macosTargetProblem(['wait', '500'], windows, owned)).toBeNull();
  expect(macosTargetProblem(['list-windows'], windows, owned)).toBeNull();
  expect(macosTargetProblem(['snapshot', '-i'], windows, owned)).toContain('needs --app or --window-id');
});

test('app and window lists keep only the conversation\'s apps', () => {
  const owned = new Set([10, 11]);
  expect(JSON.parse(ownedListing(JSON.stringify({ ok: true, data: [{ pid: 10, id: 'w-1' }, { pid: 20, id: 'w-2' }] }), owned))).toEqual({ ok: true, data: [{ pid: 10, id: 'w-1' }] });
  expect(JSON.parse(ownedListing(JSON.stringify({ ok: true, data: { apps: [{ pid: 20 }, { pid: 11 }] } }), owned))).toEqual({ ok: true, data: { apps: [{ pid: 11 }] } });
  expect(ownedListing('not json\n', owned)).toBe('not json\n');
  expect([...descendants([1], '  1     0\n  2     1\n  3     2\n  4     9\n')].sort()).toEqual([1, 2, 3]);
});

test('a macOS app name runs the executable inside its bundle, so the app stays the core\'s child', () => {
  const plist = (name: string) => () => `<plist><dict><key>CFBundleExecutable</key>\n\t<string>${name}</string></dict></plist>`;
  expect(macosProgram('TextEdit', () => null, path => path === '/System/Applications/TextEdit.app', plist('TextEdit'))).toBe('/System/Applications/TextEdit.app/Contents/MacOS/TextEdit');
  expect(macosProgram('/Applications/Visual Studio Code.app/', () => null, () => true, plist('Electron'))).toBe('/Applications/Visual Studio Code.app/Contents/MacOS/Electron');
  expect(macosProgram('Tool.app', () => null, () => true, () => { throw new Error('no plist'); })).toBe('Tool.app/Contents/MacOS/Tool');
  expect(macosProgram('open', () => '/usr/bin/open', () => true, plist('x'))).toBe('open');
  expect(macosProgram('Nothing', () => null, () => false, plist('x'))).toBe('Nothing');
});

test('a Windows command line reads back as the words it was made of', () => {
  expect(quoteWindowsArg('plain')).toBe('plain');
  expect(quoteWindowsArg('')).toBe('""');
  expect(quoteWindowsArg('two words')).toBe('"two words"');
  expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
  // Backslashes double only before a quote, the closing one included.
  expect(quoteWindowsArg('C:\\with space\\')).toBe('"C:\\with space\\\\"');
  expect(quoteWindowsArg('a\\"b')).toBe('"a\\\\\\"b"');
  expect(windowsCommandLine(['charmap'], () => 'C:\\Windows\\System32\\charmap.exe')).toEqual({ application: 'C:\\Windows\\System32\\charmap.exe', commandLine: 'C:\\Windows\\System32\\charmap.exe' });
  const batch = windowsCommandLine(['tool', 'x y'], () => 'C:\\t\\tool.cmd');
  expect(batch.application).toEndWith('\\System32\\cmd.exe');
  expect(batch.commandLine).toEndWith(' /d /s /c "C:\\t\\tool.cmd "x y""');
  expect(() => windowsCommandLine([])).toThrow('a program to run is needed');
});

test('the launcher onto a hidden desktop is the core itself, from its bundle or its sources', () => {
  expect(desktopExecCommand('WinSta0\\boite-1', ['charmap'], 'C:\\Boite\\boite-core.exe', true)).toEqual(['C:\\Boite\\boite-core.exe', DESKTOP_EXEC, 'WinSta0\\boite-1', 'charmap']);
  const [runtime, entry, ...rest] = desktopExecCommand('WinSta0\\boite-1', ['charmap', 'x'], 'bun', false);
  expect(runtime).toBe('bun');
  expect(entry).toEndWith('main.ts');
  expect(statSync(entry!).isFile()).toBe(true);
  expect(rest).toEqual([DESKTOP_EXEC, 'WinSta0\\boite-1', 'charmap', 'x']);
});

describe('boite desktop on a shared session', () => {
  let harness: TestCore, threadId: string, cwd: string;

  const cli = async (...args: string[]) => {
    let out = '', error = '';
    const code = await runCli(['desktop', ...args], { cwd,
      env: { PATH: process.env['PATH'], [AGENT_ENV.threadId]: threadId, [AGENT_ENV.coreUrl]: harness.url, [AGENT_ENV.token]: harness.core.agents.tokenFor(threadId) },
      out: text => { out += text; }, err: text => { error += text; } });
    return { code, out, error };
  };

  const useDesktops = (options: Pick<VirtualDesktopsOptions, 'platform' | 'hiddenDesktops'>, agentDesktop?: AgentDesktopTool) => {
    const core = harness.core as { desktops: VirtualDesktops };
    // No download unless the test brings its own: the CLI then falls back to an agent-desktop on PATH.
    const tool = agentDesktop ?? new AgentDesktopTool(join(harness.dataDir, 'tools'), harness.core.procs, { fetch: async () => { throw new Error('no network in tests'); } });
    core.desktops = new VirtualDesktops(harness.core, { ...options, tempRoot: harness.dataDir, agentDesktop: tool });
  };

  /** Hidden desktops that only record what the service asks of them. */
  const fakeDesktops = (unsupported: string | null = null) => {
    const made: { name: string; closed: boolean }[] = [];
    const folders: string[] = [];
    const desktops: HiddenDesktops = {
      unsupported: () => unsupported,
      privateFolder: path => { folders.push(path); },
      run: () => { throw new Error('fake desktops run nothing'); },
      create: (name: string): HiddenDesktop => {
        const record = { name, closed: false };
        made.push(record);
        return { name, path: `WinSta0\\${name}`, width: 1920, height: 1080, windowPids: () => [], close: () => { record.closed = true; } };
      },
    };
    return { made, folders, desktops };
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

  test('Windows: start makes a hidden desktop of the screen\'s size, and stop closes it', async () => {
    const { made, folders, desktops } = fakeDesktops();
    useDesktops({ platform: 'win32', hiddenDesktops: async () => desktops });
    const start = await cli('start');
    expect(start.error).toBe('');
    expect(start.out).toMatch(/^desktop: hidden boite-[0-9a-f]{16} 1920x1080\napps: none\n/);
    const session = (await harness.core.desktops.status({ threadId })).session!;
    expect(session).toMatchObject({ kind: 'windows', display: made[0]!.name, width: 1920, height: 1080 });
    const home = session.env['AGENT_DESKTOP_HOME']!;
    expect(existsSync(home)).toBe(true);
    expect(folders).toEqual([dirname(home)]);
    // A size is for a Linux display; this desktop has the size of the screen.
    expect(await thrown(harness.core.desktops.start({ threadId, width: 800, height: 600 }))).toThrow('a size is for a Linux desktop');
    expect((await cli('env')).error).toContain('env is for a Linux desktop');
    // Refused before any agent-desktop runs: the keyboard is the user's.
    expect((await cli('press', 'ctrl+c')).error).toContain('press is refused on a hidden Windows desktop');
    expect((await cli('stop')).out).toContain('desktop stopped');
    expect(made).toEqual([{ name: session.display, closed: true }]);
    expect(existsSync(dirname(home))).toBe(false);
  });

  test('Windows: a session that cannot hold a hidden desktop says why and starts nothing', async () => {
    const { made, desktops } = fakeDesktops('Boite runs in session 0, as a service: a hidden desktop needs the signed-in user\'s session');
    useDesktops({ platform: 'win32', hiddenDesktops: async () => desktops });
    expect((await cli('status')).out).toContain('session 0');
    const run = await cli('run', 'charmap');
    expect(run.code).toBe(1);
    expect(run.error).toContain('no virtual desktop on this machine: Boite runs in session 0');
    useDesktops({ platform: 'win32', hiddenDesktops: async () => { throw new Error('user32 is missing'); } });
    expect((await cli('status')).out).toContain('hidden desktops did not load: user32 is missing');
    expect(made).toEqual([]);
  });

  test('macOS: the desktop is the background of the user\'s session, with no size of its own', async () => {
    useDesktops({ platform: 'darwin' });
    expect((await cli('start')).out).toContain('desktop: background of the user\'s session (macOS)');
    expect((await harness.core.desktops.status({ threadId })).session).toMatchObject({ kind: 'macos', display: 'background' });
    expect(await thrown(harness.core.desktops.start({ threadId, width: 800, height: 600 }))).toThrow('a size is for a Linux desktop');
    expect((await cli('type', '@s1:e1', 'hello')).error).toContain('type is refused on macOS');
    expect((await cli('stop')).out).toContain('desktop stopped');
  });

  // A real hidden desktop needs the signed-in user's session, which a service account lacks.
  const hidden = process.platform === 'win32' ? hiddenDesktops : null;
  const windows = hidden !== null && hidden.unsupported() === null;

  /** The real hidden desktops, with the one the service makes kept for the test to look into. */
  const watched = () => {
    const made: HiddenDesktop[] = [];
    return { made, desktops: { ...hidden!, create: (name: string) => { const desktop = hidden!.create(name); made.push(desktop); return desktop; } } };
  };

  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  const until = async <T>(read: () => T | Promise<T>, ok: (value: T) => boolean, ms = 10_000): Promise<T> => {
    const deadline = Date.now() + ms;
    let value = await read();
    while (!ok(value) && Date.now() < deadline) { await Bun.sleep(200); value = await read(); }
    return value;
  };

  test.skipIf(!windows)('Windows: an app opens its window on the hidden desktop, and stop ends it', async () => {
    const { made, desktops } = watched();
    useDesktops({ platform: 'win32', hiddenDesktops: async () => desktops });
    const run = await cli('run', 'charmap');
    expect(run.error).toBe('');
    const helper = Number(/running as pid (\d+)/.exec(run.out)?.[1]);
    expect(alive(helper)).toBe(true);
    // The window is on the conversation's desktop, owned by charmap, a child of the launcher.
    const owners = await until(() => made[0]!.windowPids(), pids => pids.length > 0);
    expect(owners.length).toBeGreaterThan(0);
    expect(owners).not.toContain(helper);
    expect(owners).not.toContain(process.pid);
    expect((await cli('stop')).out).toContain('desktop stopped');
    expect(await until(() => [helper, ...owners].filter(alive), left => left.length === 0)).toEqual([]);
  }, 30_000);

  // Opt-in: downloads the pinned agent-desktop, as a first use on the machine would.
  test.skipIf(!windows || process.env['BOITE_E2E_DESKTOP'] !== '1')('Windows: agent-desktop reads, fills and captures an app on the hidden desktop', async () => {
    const { desktops } = watched();
    useDesktops({ platform: 'win32', hiddenDesktops: async () => desktops }, new AgentDesktopTool(join(harness.dataDir, 'tools'), harness.core.procs));
    await cli('run', 'charmap');
    // charmap opens small helper windows too: its main one has a title.
    const main = await until(async () => {
      const listed = JSON.parse((await cli('list-windows', '--app', 'charmap')).out || '{}') as { data?: ListedWindow[] };
      return (listed.data ?? []).find(window => window.title);
    }, window => window !== undefined);
    expect(main).toBeDefined();
    const snapshot = JSON.parse((await cli('snapshot', '--window-id', main!.id, '-i', '--compact')).out) as { data: { snapshot_id: string } };
    const field = `@${snapshot.data.snapshot_id}:e1`;
    expect((await cli('set-value', field, 'boite')).code).toBe(0);
    expect((await cli('get', field, '--property', 'value')).out).toContain('"value":"boite"');
    const shot = process.env['BOITE_E2E_DESKTOP_SHOT'] ?? join(harness.dataDir, 'charmap.png');
    expect((await cli('screenshot', '--window-id', main!.id, shot)).code).toBe(0);
    expect(statSync(shot).size).toBeGreaterThan(1_000);
    // The keyboard stays the user's.
    expect((await cli('press', 'ctrl+c', '--app', 'charmap')).error).toContain('press is refused');
  }, 120_000);

  // Opt-in, in a signed-in macOS session that granted agent-desktop's launcher Accessibility and Screen Recording.
  const front = () => Bun.spawnSync({ cmd: ['osascript', '-e', 'tell application "System Events" to get name of first process whose frontmost is true'] }).stdout.toString().trim();
  test.skipIf(process.platform !== 'darwin' || process.env['BOITE_E2E_DESKTOP'] !== '1')('macOS: agent-desktop drives the Calculator the conversation started, and the user keeps the front app', async () => {
    useDesktops({ platform: 'darwin' }, new AgentDesktopTool(join(harness.dataDir, 'tools'), harness.core.procs));
    const before = front();
    const run = await cli('run', 'Calculator');
    expect(run.error).toBe('');
    const pid = Number(/running as pid (\d+)/.exec(run.out)?.[1]);
    const window = await until(async () => {
      const listed = JSON.parse((await cli('list-windows')).out || '{}') as { data?: ListedWindow[] };
      return (listed.data ?? []).find(found => found.title !== undefined);
    }, found => found !== undefined, 20_000);
    expect(window?.pid).toBe(pid);
    // Only the conversation's apps are listed, and a command with no target is refused.
    const listed = JSON.parse((await cli('list-apps')).out) as { data: { apps: { pid: number }[] } };
    expect(listed.data.apps.map(app => app.pid)).toEqual([pid]);
    expect((await cli('snapshot', '-i')).error).toContain('needs --app or --window-id');
    const snapshot = (await cli('snapshot', '--window-id', window!.id, '-i', '--compact')).out;
    const seven = /"name":"7"[^{}]*"ref_id":"(@[^"]+)"|"ref_id":"(@[^"]+)"[^{}]*"name":"7"/.exec(snapshot)?.slice(1).find(Boolean);
    expect(seven).toBeDefined();
    expect((await cli('click', seven!)).code).toBe(0);
    const shot = process.env['BOITE_E2E_DESKTOP_SHOT'] ?? join(harness.dataDir, 'calculator.png');
    expect((await cli('screenshot', '--window-id', window!.id, shot)).code).toBe(0);
    expect(statSync(shot).size).toBeGreaterThan(1_000);
    // Started, read and clicked without taking the user's front app.
    expect(front()).toBe(before);
    expect((await cli('stop')).out).toContain('desktop stopped');
    expect(await until(() => alive(pid), running => !running)).toBe(false);
  }, 120_000);
});
