import { afterEach, describe, expect, test } from 'vitest';
import { KEYBINDING_COMMANDS, parseChord } from '@boite/contracts';
import { COMMAND_GROUPS, chordFromEvent, chordFromWheel, chordLabel, chordParts, commandForKey, isMac, matchesChord, matchesWheel, resolveBindings } from './keybindings';
import { setLocaleSetting } from './i18n.svelte';

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('the keyboard table', () => {
  test('the defaults stand until the file names a command, and null takes its key away', () => {
    const table = resolveBindings({ 'new-thread': 'mod+shift+n', palette: null });
    expect(table['new-thread']).toEqual({
      text: 'mod+shift+n',
      chord: { mod: true, ctrl: false, alt: false, shift: true, meta: false, key: 'n' },
      custom: true
    });
    expect(table.palette).toEqual({ text: null, chord: null, custom: true });
    expect(table.sidebar).toEqual({
      text: 'mod+s',
      chord: { mod: true, ctrl: false, alt: false, shift: false, meta: false, key: 's' },
      custom: false
    });
    expect(table.archive).toEqual({ text: null, chord: null, custom: false });
  });

  test('a chord matches its exact modifiers, and mod is Ctrl here and Cmd on a Mac', () => {
    const modB = resolveBindings({ sidebar: 'mod+b' }).sidebar.chord!;
    expect(matchesChord(key({ key: 'b', ctrlKey: true }), modB, false)).toBe(true);
    expect(matchesChord(key({ key: 'B', ctrlKey: true }), modB, false)).toBe(true);
    expect(matchesChord(key({ key: 'b', ctrlKey: true, altKey: true }), modB, false)).toBe(false);
    expect(matchesChord(key({ key: 'b', ctrlKey: true, shiftKey: true }), modB, false)).toBe(false);
    expect(matchesChord(key({ key: 'b', metaKey: true }), modB, false)).toBe(false);
    expect(matchesChord(key({ key: 'b', metaKey: true }), modB, true)).toBe(true);
    expect(matchesChord(key({ key: 'b', ctrlKey: true }), modB, true)).toBe(false);
  });

  test('a keydown finds its command, and one the file unbound finds nothing', () => {
    const table = resolveBindings({ palette: null, 'theme-dark': 'mod+shift+d' });
    expect(commandForKey(table, key({ key: 'n', ctrlKey: true }), false)).toBe('new-thread');
    expect(commandForKey(table, key({ key: 'k', ctrlKey: true }), false)).toBeNull();
    expect(commandForKey(table, key({ key: 'D', ctrlKey: true, shiftKey: true }), false)).toBe('theme-dark');
    expect(commandForKey(table, key({ key: ',', ctrlKey: true }), false)).toBe('settings');
    expect(commandForKey(table, key({ key: 'Enter', ctrlKey: true }), false)).toBe('send-and-draft');
    expect(commandForKey(table, key({ key: 'n' }), false)).toBeNull();
  });

  test('in a terminal its own chords come first, T3 Code`s, and elsewhere they are not there', () => {
    const table = resolveBindings({ 'theme-dark': 'mod+shift+d' });
    const ctrl = (k: string, shiftKey = false) => key({ key: k, ctrlKey: true, shiftKey });
    expect(commandForKey(table, ctrl('n'), false, 'terminal')).toBe('terminal-new');
    expect(commandForKey(table, ctrl('d'), false, 'terminal')).toBe('terminal-split');
    expect(commandForKey(table, ctrl('D', true), false, 'terminal')).toBe('terminal-split-vertical');
    expect(commandForKey(table, ctrl('w'), false, 'terminal')).toBe('terminal-close');
    // Out of the terminal the same keys keep the app's commands.
    expect(commandForKey(table, ctrl('n'), false)).toBe('new-thread');
    expect(commandForKey(table, ctrl('D', true), false)).toBe('theme-dark');
    expect(commandForKey(table, ctrl('w'), false)).not.toBe('terminal-close');
    // A terminal key with no terminal command of its own still finds the app's.
    expect(commandForKey(table, key({ key: ',', ctrlKey: true }), false, 'terminal')).toBe('settings');
  });

  test('labels read the way the tooltips always did', () => {
    const table = resolveBindings({ trace: 'alt+up', pair: 'f5', rename: 'mod+shift+,' });
    expect(chordLabel(table['new-thread'].chord!, false)).toBe('Ctrl+N');
    expect(chordLabel(table['new-thread'].chord!, true)).toBe('Cmd+N');
    expect(chordLabel(table.panel.chord!, false)).toBe('Ctrl+Alt+B');
    expect(chordLabel(table.panel.chord!, true)).toBe('Option+Cmd+B');
    expect(chordLabel(table.settings.chord!, false)).toBe('Ctrl+,');
    expect(chordLabel(table['send-and-draft'].chord!, false)).toBe('Ctrl+Enter');
    expect(chordLabel(table.trace.chord!, false)).toBe('Alt+Up');
    expect(chordLabel(table.pair.chord!, false)).toBe('F5');
    expect(chordLabel(table.rename.chord!, false)).toBe('Ctrl+Shift+,');
  });

  test('the platform is read from the navigator string', () => {
    expect(isMac('MacIntel')).toBe(true);
    expect(isMac('Win32')).toBe(false);
    expect(isMac('Linux x86_64')).toBe(false);
  });
});

describe('recording a chord on the Keyboard page', () => {
  test('a keydown spells the words of the file, the platform modifier becoming mod', () => {
    expect(chordFromEvent(key({ key: 'K', ctrlKey: true, shiftKey: true }), false)).toBe('mod+shift+k');
    expect(chordFromEvent(key({ key: 'k', metaKey: true }), true)).toBe('mod+k');
    expect(chordFromEvent(key({ key: 'k', ctrlKey: true }), true)).toBe('ctrl+k');
    expect(chordFromEvent(key({ key: 'ArrowUp', altKey: true }), false)).toBe('alt+up');
    expect(chordFromEvent(key({ key: ' ', ctrlKey: true }), false)).toBe('mod+space');
    expect(chordFromEvent(key({ key: '+', ctrlKey: true }), false)).toBe('mod+plus');
    expect(chordFromEvent(key({ key: 'F5' }), false)).toBe('f5');
    // Only modifiers held: the recording waits for the key.
    expect(chordFromEvent(key({ key: 'Control', ctrlKey: true }), false)).toBeNull();
    expect(chordFromEvent(key({ key: 'Shift', shiftKey: true }), false)).toBeNull();
  });

  test('what it records reads back as the same chord, and a bare letter is refused', () => {
    for (const event of [key({ key: 'K', ctrlKey: true, shiftKey: true }), key({ key: 'ArrowLeft', ctrlKey: true, altKey: true }), key({ key: ',', ctrlKey: true })]) {
      const text = chordFromEvent(event, false)!;
      const parsed = parseChord(text);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(matchesChord(event, parsed.chord, false)).toBe(true);
    }
    expect(parseChord(chordFromEvent(key({ key: 'b' }), false)!).ok).toBe(false);
  });

  test('Alt and a digit reach the thread in that row, on a layout where the digit needs Shift too', () => {
    const table = resolveBindings({});
    expect(commandForKey(table, key({ key: '3', code: 'Digit3', altKey: true }), false)).toBe('thread-3');
    // French AZERTY: the top row types `"` without Shift, the code still says Digit3.
    expect(commandForKey(table, key({ key: '"', code: 'Digit3', altKey: true }), false)).toBe('thread-3');
    expect(commandForKey(table, key({ key: '3', code: 'Numpad3', altKey: true }), false)).toBe('thread-3');
    expect(commandForKey(table, key({ key: '"', code: 'Quote', altKey: true }), false)).toBeNull();
    expect(commandForKey(table, key({ key: 't', code: 'KeyT', ctrlKey: true, shiftKey: true }), false)).toBe('reopen-thread');
    expect(commandForKey(table, key({ key: 'f', code: 'KeyF', ctrlKey: true }), false)).toBe('find');
  });

  test('the page draws one cap per key, and every command sits in exactly one section', () => {
    expect(chordParts(resolveBindings({}).tasks.chord!, false)).toEqual(['Ctrl', 'Shift', 'K']);
    expect(chordParts(resolveBindings({}).tasks.chord!, true)).toEqual(['Shift', 'Cmd', 'K']);
    const listed = COMMAND_GROUPS.flatMap((group) => group.commands);
    expect([...listed].sort()).toEqual([...KEYBINDING_COMMANDS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });
});

describe('the wheel chord', () => {
  afterEach(async () => { await setLocaleSetting('system'); });

  test('the wheel zoom has no chord until the file gives it one', () => {
    expect(resolveBindings({})['zoom-wheel']).toEqual({ text: null, chord: null, custom: false });
    expect(resolveBindings({ 'zoom-wheel': 'mod+wheel' })['zoom-wheel'].chord).toEqual({ mod: true, ctrl: false, alt: false, shift: false, meta: false, key: 'wheel' });
    expect(COMMAND_GROUPS.find((group) => group.id === 'general')?.commands).toContain('zoom-wheel');
  });

  test('it reads Ctrl+Wheel, Molette in French', async () => {
    const chord = resolveBindings({ 'zoom-wheel': 'mod+wheel' })['zoom-wheel'].chord!;
    expect(chordLabel(chord, false)).toBe('Ctrl+Wheel');
    expect(chordLabel(chord, true)).toBe('Cmd+Wheel');
    expect(chordParts(resolveBindings({ 'zoom-wheel': 'mod+shift+wheel' })['zoom-wheel'].chord!, false)).toEqual(['Ctrl', 'Shift', 'Wheel']);
    await setLocaleSetting('fr');
    expect(chordLabel(chord, false)).toBe('Ctrl+Molette');
  });

  test('no key fires it, and no wheel fires a key\'s command', () => {
    const table = resolveBindings({ 'zoom-wheel': 'mod+wheel' });
    const chord = table['zoom-wheel'].chord!;
    // Not even a key that would call itself the wheel.
    expect(matchesChord(key({ key: 'Wheel', ctrlKey: true }), chord, false)).toBe(false);
    expect(commandForKey(table, key({ key: 'Wheel', ctrlKey: true }), false)).toBeNull();
    expect(commandForKey(table, key({ key: 'n', ctrlKey: true }), false)).toBe('new-thread');
    expect(matchesWheel({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, table['new-thread'].chord!, false)).toBe(false);
  });

  test('a turn matches its exact modifiers, mod being Ctrl here and Cmd on a Mac', () => {
    const mod = resolveBindings({ 'zoom-wheel': 'mod+wheel' })['zoom-wheel'].chord!;
    const alt = resolveBindings({ 'zoom-wheel': 'alt+wheel' })['zoom-wheel'].chord!;
    const turn = (init: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>>) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });
    expect(matchesWheel(turn({ ctrlKey: true }), mod, false)).toBe(true);
    expect(matchesWheel(turn({ ctrlKey: true, altKey: true }), mod, false)).toBe(false);
    expect(matchesWheel(turn({ metaKey: true }), mod, true)).toBe(true);
    expect(matchesWheel(turn({ ctrlKey: true }), mod, true)).toBe(false);
    expect(matchesWheel(turn({ altKey: true }), alt, false)).toBe(true);
    expect(matchesWheel(turn({ ctrlKey: true }), alt, false)).toBe(false);
    expect(matchesWheel(turn({}), mod, false)).toBe(false);
  });

  test('a turn of the wheel spells the words of the file', () => {
    expect(chordFromWheel({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, false)).toBe('mod+wheel');
    expect(chordFromWheel({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: true }, true)).toBe('mod+shift+wheel');
    expect(chordFromWheel({ ctrlKey: false, metaKey: false, altKey: true, shiftKey: false }, false)).toBe('alt+wheel');
    expect(chordFromWheel({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: true }, false)).toBe('shift+wheel');
    expect(parseChord(chordFromWheel({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: true }, false)).ok).toBe(false);
  });
});
