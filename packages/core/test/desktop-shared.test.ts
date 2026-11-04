/*
 * `boite desktop` on Windows and macOS (docs/desktop.md#windows-and-macos):
 * the desktop shares the user's session, so only semantic input passes and, on
 * macOS, only toward the apps the conversation started.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AGENT_ENV } from '@boite/contracts';
import { runCli } from '../src/cli.ts';
import { AgentDesktopTool } from '../src/desktop/agent-desktop.ts';
import { DESKTOP_EXEC, desktopExecCommand } from '../src/desktop/launcher.ts';
import { descendants, macosTargetProblem, ownedListing, parsePs, sharedSessionRefusal, type ListedWindow } from '../src/desktop/scope.ts';
import { imageName, singleInstanceLaunch } from '../src/desktop/single-instance.ts';
import { macosLaunch, macosProgram, VirtualDesktops, type VirtualDesktopsOptions } from '../src/desktop/service.ts';
import { hiddenDesktops, quoteBatchArg, quoteWindowsArg, windowsCommandLine } from '../src/platform/windows/hidden-desktop.ts';
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
  // A whole display holds the user's windows, whatever ref comes with it.
  expect(sharedSessionRefusal('windows', ['screenshot', '--screen', '0', '@s123:e1'])).toContain('--screen is refused');
  expect(sharedSessionRefusal('macos', ['snapshot', '--screenshot=/tmp/x.html', '--app', 'x'])).toContain('--screenshot is refused');
  // Prompts and settings in the user's session are the user's to answer.
  expect(sharedSessionRefusal('macos', ['permissions'])).toBeNull();
  expect(sharedSessionRefusal('macos', ['permissions', '--guide'])).toContain('permissions only reads here');
  expect(sharedSessionRefusal('windows', ['permissions', '--request'])).toContain('permissions only reads here');
  // close-app finds the app by name, which may be the user's copy.
  expect(sharedSessionRefusal('windows', ['close-app', 'charmap'])).toContain('close-app is refused');
  expect(sharedSessionRefusal('macos', ['close-app', '--force', 'Calculator'])).toContain('close-app --force is refused');
  expect(sharedSessionRefusal('macos', ['close-app', 'Calculator'])).toBeNull();
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
  // A ref proves the target only where agent-desktop reads it: right after the command.
  expect(macosTargetProblem(['screenshot', '@s8f3k2p9:e1'], windows, owned)).toContain('needs --app or --window-id');
  expect(macosTargetProblem(['click', '--timeout-ms', '1', '@s8f3k2p9:e1'], windows, owned)).toContain('takes its ref right after it');
  expect(macosTargetProblem(['wait', '--element', '@s8f3k2p9:e1'], windows, owned)).toBeNull();
  expect(macosTargetProblem(['wait', '--element', '@s8f3k2p9:e1', '--app', 'Safari'], windows, owned)).toContain('start it with boite desktop run');
  // close-app names its app as its first word.
  expect(macosTargetProblem(['close-app', 'Preview'], windows, owned)).toBeNull();
  expect(macosTargetProblem(['close-app', 'TextEdit'], windows, owned)).toContain('the user runs TextEdit too');
  expect(macosTargetProblem(['close-app', 'Safari'], windows, owned)).toContain('start it with boite desktop run');
});

test('app and window lists keep only the conversation\'s apps', () => {
  const owned = new Set([10, 11]);
  expect(JSON.parse(ownedListing(JSON.stringify({ ok: true, data: [{ pid: 10, id: 'w-1' }, { pid: 20, id: 'w-2' }] }), owned))).toEqual({ ok: true, data: [{ pid: 10, id: 'w-1' }] });
  expect(JSON.parse(ownedListing(JSON.stringify({ ok: true, data: { apps: [{ pid: 20 }, { pid: 11 }] } }), owned))).toEqual({ ok: true, data: { apps: [{ pid: 11 }] } });
  expect(ownedListing('not json\n', owned)).toBe('not json\n');
  const ps = parsePs('  1     0 /sbin/launchd\n  2     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n  3     2\n  4     9 x\n');
  expect(ps[1]).toEqual({ pid: 2, ppid: 1, name: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  expect([...descendants([1], ps)].sort()).toEqual([1, 2, 3]);
});

test('a macOS app name finds its bundle, which LaunchServices opens in the background', () => {
  const plist = (name: string) => () => `<plist><dict><key>CFBundleExecutable</key>\n\t<string>${name}</string></dict></plist>`;
  expect(macosProgram('TextEdit', () => null, path => path === '/System/Applications/TextEdit.app', plist('TextEdit'))).toBe('/System/Applications/TextEdit.app/Contents/MacOS/TextEdit');
  expect(macosProgram('/Applications/Visual Studio Code.app/', () => null, () => true, plist('Electron'))).toBe('/Applications/Visual Studio Code.app/Contents/MacOS/Electron');
  expect(macosProgram('Tool.app', () => null, () => true, () => { throw new Error('no plist'); })).toBe('Tool.app/Contents/MacOS/Tool');
  expect(macosProgram('open', () => '/usr/bin/open', () => true, plist('x'))).toBe('open');
  expect(macosProgram('Nothing', () => null, () => false, plist('x'))).toBe('Nothing');
  // macOS kills an Apple app started by another parent than launchd; -g keeps the user's front app, -W keeps open the core's child.
  expect(macosLaunch('/System/Applications/TextEdit.app/Contents/MacOS/TextEdit', [])).toEqual(['/usr/bin/open', '-n', '-g', '-W', '-a', '/System/Applications/TextEdit.app']);
  expect(macosLaunch('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--user-data-dir=/t/p', 'https://x'])).toEqual(['/usr/bin/open', '-n', '-g', '-W', '-a', '/Applications/Google Chrome.app', '--args', '--user-data-dir=/t/p', 'https://x']);
  expect(macosLaunch('/usr/local/bin/tool', ['a'])).toEqual(['/usr/local/bin/tool', 'a']);
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
  // cmd.exe reads the line, then the batch file's own lines again: each character it reads gets a caret, twice.
  expect(batch.commandLine).toEndWith(' /d /s /c "C:\\t\\tool.cmd ^^^"x^^^ y^^^""');
  expect(quoteBatchArg('a&b')).toBe('^^^"a^^^&b^^^"');
  expect(quoteBatchArg('%PATH%')).toBe('^^^"^^^%PATH^^^%^^^"');
  expect(windowsCommandLine(['tool'], () => 'C:\\my tools\\tool.cmd').commandLine).toEndWith(' /d /s /c "C:\\my^ tools\\tool.cmd"');
  expect(() => windowsCommandLine([])).toThrow('a program to run is needed');
});

test('an app that keeps one copy per user gets a profile of its own, or is refused while the user runs it', () => {
  expect(imageName('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe('chrome');
  expect(imageName('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')).toBe('google chrome');
  const user = [{ pid: 50, ppid: 1, name: 'chrome.exe' }, { pid: 60, ppid: 1, name: 'Notepad.exe' }, { pid: 70, ppid: 9, name: 'notepad.exe' }, { pid: 9, ppid: 1, name: 'boite-core.exe' }];
  const dir = join('D:', 'tmp', 'boite-desktop-1');
  expect(singleInstanceLaunch('chrome', ['https://example.com'], dir, user, [])).toEqual({ args: [`--user-data-dir=${join(dir, 'profiles', 'chrome')}`, 'https://example.com'], profile: join(dir, 'profiles', 'chrome') });
  expect(singleInstanceLaunch('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [], dir, [], [])).toMatchObject({ profile: join(dir, 'profiles', 'google chrome') });
  expect(singleInstanceLaunch('msedge.exe', ['--user-data-dir=X:\\p'], dir, user, [])).toEqual({ args: ['--user-data-dir=X:\\p'], profile: null });
  expect(singleInstanceLaunch('firefox', ['about:blank'], dir, user, [])).toEqual({ args: ['-no-remote', '-profile', join(dir, 'profiles', 'firefox'), 'about:blank'], profile: join(dir, 'profiles', 'firefox') });
  expect(singleInstanceLaunch('firefox', ['-P', 'dev'], dir, user, [])).toEqual({ args: ['-P', 'dev'], profile: null });
  expect(singleInstanceLaunch('C:\\Windows\\explorer.exe', [], dir, user, [])).toMatchObject({ refused: expect.stringContaining('the user\'s own Explorer') });
  // The user's Notepad would take the launch; the conversation's own copy would not.
  expect(singleInstanceLaunch('notepad', [], dir, user, [])).toMatchObject({ refused: expect.stringContaining('notepad already runs on the user\'s desktop') });
  expect(singleInstanceLaunch('notepad', [], dir, user.filter(entry => entry.pid !== 60), [9])).toEqual({ args: [], profile: null });
  expect(singleInstanceLaunch('charmap', ['x'], dir, user, [])).toEqual({ args: ['x'], profile: null });
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
      processes: () => [{ pid: 4242, ppid: 1, name: 'notepad.exe' }],
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
    // The user's Notepad and Explorer would open the window on the user's screen.
    expect((await cli('run', 'notepad')).error).toContain('notepad already runs on the user\'s desktop');
    expect((await cli('run', 'explorer', '.')).error).toContain('the user\'s own Explorer');
    expect((await harness.core.desktops.status({ threadId })).session!.apps).toEqual([]);
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

  test.skipIf(!windows)('Windows: the process list names this process and its parent', () => {
    const self = hidden!.processes().find(entry => entry.pid === process.pid);
    expect(self).toEqual({ pid: process.pid, ppid: process.ppid, name: expect.stringMatching(/^bun(\.exe)?$/i) });
  });

  test.skipIf(!windows)('Windows: a batch file on the hidden desktop gets its arguments as given, and cmd.exe runs none of them', () => {
    const folder = join(harness.dataDir, 'batch & tools');
    mkdirSync(folder, { recursive: true });
    const script = join(folder, 'argv.js'), batch = join(folder, 'argv.cmd'), mark = join(folder, 'ran');
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    writeFileSync(batch, `@"${process.execPath}" "${script}" %*\r\n`);
    const words = ['a&b', '%PATH%', 'x y', 'say "hi"', 'a"&b', 'C:\\dir\\', '', '(p)|q<r>^!', `& echo ran> "${mark}"`];
    const desktop = hidden!.create(`boite-test-${process.pid}`);
    try {
      const run = Bun.spawnSync({ cmd: desktopExecCommand(desktop.path, [batch, ...words]), stdout: 'pipe', stderr: 'pipe', windowsHide: true });
      expect(run.stderr.toString()).toBe('');
      expect(JSON.parse(run.stdout.toString())).toEqual(words);
      expect(existsSync(mark)).toBe(false);
    } finally {
      desktop.close();
    }
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
    type Node = { name?: string; ref_id?: string; children?: Node[] };
    const ref = (node: Node, name: string): string | undefined => node.name === name && node.ref_id ? node.ref_id : (node.children ?? []).map(child => ref(child, name)).find(Boolean);
    const seven = ref((JSON.parse(snapshot) as { data: { tree: Node } }).data.tree, '7');
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
