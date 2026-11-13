import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeepAwake } from '../src/keep-awake.ts';
import { keepAwakeCommands, posixKeepAwake } from '../src/platform/posix-keep-awake.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

let h: TestCore;
beforeEach(async () => { h = await startTestCore(); });
afterEach(async () => { await h.stop(); });

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('the machine is held awake while a turn runs or is queued, not for a thread waiting for the user, and given back when work ends, the setting goes off or the core closes', async () => {
  // The harness core holds nothing (`BOITE_KEEP_AWAKE=0` in the preload): this one counts.
  expect(h.core.keepAwake.held).toBe(false);
  let holds = 0, releases = 0;
  let lose: ((reason: string) => void) | null = null;
  let refuse = false;
  const keeper = new KeepAwake(h.core, onLost => {
    if (refuse) return null;
    holds += 1;
    lose = onLost;
    return () => { releases += 1; };
  }, 150);
  const warnings: string[] = [];
  const warn = h.core.logs.warn.bind(h.core.logs);
  h.core.logs.warn = (message, context) => { if (context?.event === 'keepAwake.unavailable') warnings.push(message); warn(message, context); };
  try {
    const owner = await h.connect();
    const { threadId } = await echoThread(h, owner);
    await pause(250);
    expect(holds).toBe(0);
    const status = (next: 'idle' | 'queued' | 'running' | 'waiting') => {
      const thread = { ...h.core.journal.getThread(threadId)!, status: next };
      h.core.journal.putThread(thread);
      h.core.bus.emit('thread.updated', thread);
    };
    // A real turn: held from its start, through a second one that follows, until 150 ms after the last.
    const done = async (prompt: string) => {
      const turn = await owner.call('turns.start', { threadId, prompt });
      await waitFor(() => keeper.held);
      await waitFor(() => h.core.journal.listTurns(threadId).find(t => t.id === turn.id)?.status === 'done');
    };
    await done('first '.repeat(250));
    await done('second');
    expect([holds, releases]).toEqual([1, 0]);
    await waitFor(() => !keeper.held);
    expect([holds, releases]).toEqual([1, 1]);
    // Queued holds like running.
    status('queued');
    await waitFor(() => keeper.held);
    // A question or an approval waiting for the user gives the machine back.
    status('waiting');
    await waitFor(() => !keeper.held);
    expect([holds, releases]).toEqual([2, 2]);
    await pause(250);
    expect(holds).toBe(2);
    // The setting off gives it back at once, without the 150 ms, and work no longer holds.
    status('running');
    await waitFor(() => keeper.held);
    const before = performance.now();
    h.core.settings.set({ keepAwake: false });
    await waitFor(() => !keeper.held);
    expect(performance.now() - before).toBeLessThan(140);
    expect([holds, releases]).toEqual([3, 3]);
    status('idle');
    status('running');
    await pause(250);
    expect(holds).toBe(3);
    // Back on while a turn runs: held again.
    h.core.settings.set({ keepAwake: true });
    await waitFor(() => keeper.held);
    expect(holds).toBe(4);
    // The inhibitor ends by itself: said once, and not taken again on every turn.
    lose!('the helper ended');
    expect(keeper.held).toBe(false);
    status('idle');
    status('running');
    await pause(250);
    expect(holds).toBe(4);
    expect(warnings).toEqual(['The machine is not kept awake while agents work: the helper ended']);
    // A machine without one: said once too, after the setting is toggled.
    refuse = true;
    h.core.settings.set({ keepAwake: false });
    await pause(150);
    h.core.settings.set({ keepAwake: true });
    await waitFor(() => warnings.length === 2);
    expect(warnings[1]).toContain('no sleep inhibitor');
    refuse = false;
    h.core.settings.set({ keepAwake: false });
    await pause(150);
    h.core.settings.set({ keepAwake: true });
    await waitFor(() => keeper.held);
    expect([holds, releases]).toEqual([5, 3]);
    // Shutdown gives it back.
    keeper.close();
    expect([keeper.held, releases]).toEqual([false, 4]);
    status('idle');
  } finally { h.core.logs.warn = warn; keeper.close(); }
});

test.skipIf(process.platform === 'win32')('a helper that cannot start is reported once and the turn goes on', async () => {
  const warnings: string[] = [];
  const warn = h.core.logs.warn.bind(h.core.logs);
  h.core.logs.warn = (message, context) => { if (context?.event === 'keepAwake.unavailable') warnings.push(message); warn(message, context); };
  // The report comes inside the hold call itself, before it has returned.
  const keeper = new KeepAwake(h.core, onLost => posixKeepAwake([['/missing-boite-inhibitor']], onLost), 150);
  try {
    const owner = await h.connect();
    const { threadId } = await echoThread(h, owner);
    const turn = await owner.call('turns.start', { threadId, prompt: 'first '.repeat(250) });
    await waitFor(() => warnings.length === 1);
    expect(warnings[0]).toContain('/missing-boite-inhibitor did not start');
    expect(keeper.held).toBe(false);
    await waitFor(() => h.core.journal.listTurns(threadId).find(t => t.id === turn.id)?.status === 'done');
    expect(warnings.length).toBe(1);
  } finally { h.core.logs.warn = warn; keeper.close(); }
});

test.skipIf(process.platform === 'win32')('the helper holds until released, a refused inhibitor falls back to the next, and the last refusal is reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boite-awake-'));
  const helper = join(dir, 'inhibit');
  // Refuses to block sleep as logind does for a user with no active session; holds anything else while its command runs.
  writeFileSync(helper, `#!/bin/sh\nwhat="$1"; shift 4\ncase "$what" in --what=sleep:idle) echo "Failed to inhibit: Access denied" 1>&2; exit 1;; esac\ntrap 'rm -f "${dir}/held"' EXIT\ntrap 'exit 0' TERM\necho "$$ $what" > "${dir}/held"\n"$@"\n`);
  chmodSync(helper, 0o755);
  const commands = keepAwakeCommands('linux', name => name === 'systemd-inhibit' ? helper : Bun.which(name));
  expect(commands.map(command => command.slice(1, 5))).toEqual([
    ['--what=sleep:idle', '--who=Boite', '--why=Agents are working', '--mode=block'],
    ['--what=idle', '--who=Boite', '--why=Agents are working', '--mode=block'],
  ]);
  expect(keepAwakeCommands('linux', () => null)).toEqual([]);
  expect(keepAwakeCommands('macos', name => `/usr/bin/${name}`)).toEqual([['/usr/bin/caffeinate', '-i', '/usr/bin/cat']]);
  const lost: string[] = [];
  const release = posixKeepAwake(commands, reason => lost.push(reason))!;
  await waitFor(() => existsSync(join(dir, 'held')));
  expect(readFileSync(join(dir, 'held'), 'utf8')).toContain('--what=idle');
  await pause(200);
  expect(existsSync(join(dir, 'held'))).toBe(true);
  release();
  await waitFor(() => !existsSync(join(dir, 'held')));
  expect(lost).toEqual([]);
  // Every command refused: one report, with what the helper said.
  posixKeepAwake([commands[0]!, commands[0]!], reason => lost.push(reason));
  await waitFor(() => lost.length === 1);
  expect(lost[0]).toBe(`${helper} ended with code 1: Failed to inhibit: Access denied`);
  expect(posixKeepAwake([], () => {})).toBeNull();
});

test.skipIf(process.platform !== 'linux')('on a Linux machine with logind, the hold is listed by systemd-inhibit and gone once released', async () => {
  const list = () => { const run = Bun.spawnSync({ cmd: ['systemd-inhibit', '--list', '--no-pager'], stdout: 'pipe', stderr: 'pipe' }); return run.exitCode === 0 ? run.stdout.toString() : null; };
  const commands = keepAwakeCommands('linux');
  if (commands.length === 0 || list() === null) { console.log('keep awake on logind: not checked, this machine has no systemd-inhibit or no system bus'); return; }
  let lost: string | null = null;
  const release = posixKeepAwake(commands, reason => { lost = reason; })!;
  try {
    await waitFor(() => lost !== null || (list() ?? '').includes('Boite'));
    if (lost !== null) { console.log(`keep awake on logind: refused here, ${lost}`); return; }
    console.log(`keep awake on logind: held\n${list()!.split('\n').filter(line => line.includes('Boite')).join('\n')}`);
  } finally { release(); }
  await waitFor(() => !(list() ?? '').includes('Boite'));
});
