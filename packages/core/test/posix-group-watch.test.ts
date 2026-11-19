import { describe, expect, test } from 'bun:test';
import { GroupWatch } from '../src/platform/posix-group-watch.ts';

/** A fake kernel: live pids and live group ids, and every signal sent. */
function fake() {
  const pids = new Set<number>();
  const groups = new Set<number>();
  const sent: string[] = [];
  const lines: string[] = [];
  const signal = (pid: number, sig: NodeJS.Signals | 0) => {
    const alive = pid < 0 ? groups.has(-pid) : pids.has(pid);
    if (!alive) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    if (sig !== 0) sent.push(`${sig} ${pid}`);
  };
  const watch = new GroupWatch(() => (line) => { lines.push(line.trim()); }, signal, 60_000);
  return { pids, groups, sent, lines, watch };
}

describe('the group watcher', () => {
  test('a group whose leader exited stays watched while a member runs, and is dropped once empty', () => {
    const { pids, groups, sent, lines, watch } = fake();
    pids.add(500); groups.add(500);
    watch.add(500);
    pids.delete(500);
    watch.leaderExited(500);
    watch.sweep();
    expect(lines).toEqual(['+ 500', 'x 500']);
    watch.killAll();
    expect(sent).toEqual(['SIGKILL -500']);
    groups.delete(500);
    watch.sweep();
    expect(lines).toEqual(['+ 500', 'x 500', '- 500']);
    watch.killAll();
    expect(sent).toEqual(['SIGKILL -500']);
  });

  test('a group id a stranger now holds is dropped, never signalled', () => {
    const { pids, groups, sent, lines, watch } = fake();
    pids.add(600); groups.add(600);
    watch.add(600);
    pids.delete(600);
    watch.leaderExited(600);
    // The group emptied and the kernel gave pid 600, and with it group 600, to someone else.
    pids.add(600);
    watch.killAll();
    expect(sent).toEqual([]);
    watch.sweep();
    expect(lines).toEqual(['+ 600', 'x 600', '- 600']);
  });

  test('a group the keeper takes over is untied at once, leader running or not', () => {
    const { pids, groups, lines, watch } = fake();
    pids.add(700); groups.add(700);
    watch.add(700);
    watch.remove(700);
    watch.killAll();
    expect(lines).toEqual(['+ 700', '- 700']);
  });
});
