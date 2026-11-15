import { describe, expect, test } from 'vitest';
import { paletteSections, rankItems, scoreFields, scoreMatch, threadGroup, type PaletteItem } from './palette';

describe('scoreMatch', () => {
  test('a prefix beats a word start, which beats a substring, which beats scattered letters', () => {
    const prefix = scoreMatch('port', 'Port the scheduler') ?? -1;
    const wordStart = scoreMatch('sched', 'Port the scheduler') ?? -1;
    const inside = scoreMatch('hedul', 'Port the scheduler') ?? -1;
    const scattered = scoreMatch('pts', 'Port the scheduler') ?? -1;
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(scattered);
    expect(scattered).toBeGreaterThan(0);
  });

  test('nothing typed matches everything at zero, and a letter that is not there matches nothing', () => {
    expect(scoreMatch('', 'anything')).toBe(0);
    expect(scoreMatch('   ', 'anything')).toBe(0);
    expect(scoreMatch('xyz', 'Port the scheduler')).toBeNull();
    expect(scoreMatch('schedulers', 'scheduler')).toBeNull();
  });

  test('an abbreviation lands on word starts, letters merely in order do not', () => {
    expect(scoreMatch('ftt', 'Finish the trace tab')).not.toBeNull();
    expect(scoreMatch('fin tr', 'Finish the trace tab')).not.toBeNull();
    expect(scoreMatch('sett', 'Finish the trace tab')).toBeNull();
    expect(scoreMatch('ihe', 'Finish the trace tab')).toBeNull();
  });

  test('case and accents do not count', () => {
    expect(scoreMatch('ÉCHO', 'echo provider')).toBe(100);
  });
});

describe('rankItems', () => {
  const items: PaletteItem[] = [
    { id: 't-1', kind: 'thread', label: 'Finish the trace tab', hint: 'boite' },
    { id: 't-2', kind: 'thread', label: 'Port the scheduler', hint: 'boite' },
    { id: 't-3', kind: 'thread', label: 'Review the descriptor loader', hint: 'notes' },
    { id: 'new', kind: 'command', label: 'New thread', hint: 'Ctrl+N', keywords: 'draft start' },
    { id: 'settings', kind: 'command', label: 'Open settings', hint: 'Ctrl+,' }
  ];

  test('nothing typed keeps the given order, cut at the limit', () => {
    expect(rankItems('', items).map((item) => item.id)).toEqual(['t-1', 't-2', 't-3', 'new', 'settings']);
    expect(rankItems('', items, 2).map((item) => item.id)).toEqual(['t-1', 't-2']);
  });

  test('a query ranks by score and drops what does not match', () => {
    // "the" is a word start in three titles, the earlier the better; "New
    // thread" has t, h and e in order but the e sits mid-word after a gap.
    expect(rankItems('the', items).map((item) => item.id)).toEqual(['t-2', 't-1', 't-3']);
    expect(rankItems('notes', items).map((item) => item.id)).toEqual(['t-3']);
    expect(rankItems('draft', items).map((item) => item.id)).toEqual(['new']);
    expect(rankItems('zzz', items)).toEqual([]);
  });

  test('a label hit outranks a hint hit on the same query', () => {
    const rows: PaletteItem[] = [
      { id: 'a', kind: 'thread', label: 'Something else', hint: 'boite' },
      { id: 'b', kind: 'thread', label: 'Boite release notes', hint: 'notes' }
    ];
    expect(rankItems('boite', rows).map((item) => item.id)).toEqual(['b', 'a']);
  });
});

describe('scoreFields', () => {
  const boite = [{ text: 'Boite' }, { text: 'm2', penalty: 5 }, { text: '/home/boite/projects/boite', penalty: 15 }];
  const other = [{ text: 'Boite' }, { text: 'PC', penalty: 5 }, { text: 'D:/Dev/boite', penalty: 15 }];

  test('each word may land on its own field: the name, then the machine', () => {
    expect(scoreFields('boite m2', boite)).not.toBeNull();
    expect(scoreFields('boite m2', other)).toBeNull();
    expect(scoreFields('m2 boi', boite)).not.toBeNull();
  });

  test('the name outranks the machine and the folder, and every word has to land', () => {
    expect(scoreFields('boite', boite)!).toBeGreaterThan(scoreFields('m2', boite)!);
    expect(scoreFields('m2', boite)!).toBeGreaterThan(scoreFields('projects', boite)!);
    expect(scoreFields('boite zzz', boite)).toBeNull();
  });
});

describe('threadGroup', () => {
  test('done wins over archived, archived over the state, and only a turn under way or owed counts as running', () => {
    // The core keeps a thread marked done archived, with the date it was done (core threads.ts).
    expect(threadGroup({ archived: true, doneAt: 5 }, 'working')).toBe('done');
    expect(threadGroup({ archived: true, doneAt: null }, 'working')).toBe('archived');
    expect(threadGroup({ doneAt: 5 }, 'working')).toBe('done');
    for (const state of ['working', 'queued', 'waiting', 'delegating', 'monitoring', 'background', 'watching']) expect(threadGroup({}, state)).toBe('running');
    for (const state of [null, 'done', 'error', 'interrupted']) expect(threadGroup({ doneAt: null }, state)).toBe('finished');
  });
});

describe('paletteSections', () => {
  const thread = (id: string, section: string, at: number, label = id): PaletteItem => ({ id, kind: 'thread', label, section, at });
  const items: PaletteItem[] = [
    { id: 'settings', kind: 'command', label: 'Open settings' },
    thread('old-archived', 'archived', 1, 'Port the archive'),
    thread('bot', 'bots', 90, 'Port bot'),
    thread('done-old', 'done', 2, 'Port the docs'),
    thread('finished-old', 'finished', 10, 'Port the scheduler'),
    { id: 'project', kind: 'project', label: 'Portal' },
    thread('run-old', 'running', 20, 'Port the trace'),
    thread('done-new', 'done', 30, 'Ship the docs'),
    thread('finished-new', 'finished', 40, 'Review the loader'),
    thread('run-new', 'running', 50, 'Bench the core'),
    // A subagent is a thread like another: it stands in its state's group at its own date.
    thread('run-sub', 'running', 35, 'Explore'),
    { id: 'new-thread', kind: 'command', label: 'New thread' }
  ];
  const shape = (query: string) => paletteSections(query, items).map((section) => [section.id, section.items.map((item) => item.id)]);

  test('nothing typed: running, finished, done, then bots and commands, each thread group most recent first', () => {
    expect(shape('')).toEqual([
      ['running', ['run-new', 'run-sub', 'run-old']],
      ['finished', ['finished-new', 'finished-old']],
      ['done', ['done-new', 'done-old']],
      ['bots', ['bot']],
      ['command', ['settings', 'new-thread']]
    ]);
  });

  test('a query keeps the order among matches and brings the archived threads and the projects in', () => {
    // "Port the trace" is the oldest running match and "Portal" the best match of all: neither moves a heading.
    expect(shape('port')).toEqual([
      ['running', ['run-old']],
      ['finished', ['finished-old']],
      ['done', ['done-old']],
      ['archived', ['old-archived']],
      ['project', ['project']],
      ['bots', ['bot']]
    ]);
    // A weaker match that is more recent still leads its group.
    expect(shape('the')).toEqual([
      ['running', ['run-new', 'run-old']],
      ['finished', ['finished-new', 'finished-old']],
      ['done', ['done-new', 'done-old']],
      ['archived', ['old-archived']]
    ]);
  });

  test('a group is cut at its cap, so a long one never pushes the next out', () => {
    const many = Array.from({ length: 20 }, (_, n) => thread(`r${n}`, 'running', n));
    const sections = paletteSections('', [...many, thread('f', 'finished', 1)]);
    expect(sections.map((section) => [section.id, section.items.length])).toEqual([['running', 8], ['finished', 1]]);
    expect(sections[0]!.items[0]!.id).toBe('r19');
  });
});
