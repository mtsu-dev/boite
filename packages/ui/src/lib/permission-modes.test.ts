import { describe, expect, it } from 'vitest';
import type { Protocol, ProviderSummary } from '@boite/contracts';
import { modeHint, modeIcon, modeLabel, modesFor, modeWord, shownMode } from './permission-modes';
import { defaultPrefs, PREFS_STORAGE_KEY, readPrefs, writePrefs } from './prefs';

const provider = (protocol: Protocol, approvals = true) => ({
  id: protocol, name: protocol, shortName: protocol, protocol, source: 'shipped', available: true, executable: null, models: [],
  capabilities: { approvals, hooks: false, checkpoint: false, images: false, planMode: false, resume: false }
}) as unknown as ProviderSummary;

describe('permission modes', () => {
  it('offers YOLO beside Auto, the most open first', () => {
    expect(modesFor(provider('claude-sdk'))).toEqual(['yolo', 'bypassPermissions', 'acceptEdits', 'default']);
    expect(modesFor(null)).toEqual(['yolo', 'bypassPermissions', 'acceptEdits', 'default']);
  });

  it('drops the Codex entry that would be the same sandbox as the default', () => {
    expect(modesFor(provider('codex-appserver'))).toEqual(['yolo', 'bypassPermissions', 'default']);
  });

  it('shows a Codex choice left on acceptEdits as the default it runs as', () => {
    expect(shownMode('acceptEdits', provider('codex-appserver'))).toBe('default');
    expect(shownMode('bypassPermissions', provider('codex-appserver'))).toBe('bypassPermissions');
    expect(shownMode('acceptEdits', provider('claude-sdk'))).toBe('acceptEdits');
    expect(shownMode('plan', provider('codex-appserver'))).toBe('plan');
  });

  it('offers nothing to an agent that never asks', () => {
    expect(modesFor(provider('pi', false))).toEqual([]);
  });

  it('says Codex writes in the folder on its default, and the open mode reaches the whole computer', () => {
    expect(modeLabel('default', provider('codex-appserver'))).toBe('Works in this folder, asks to go beyond it');
    expect(modeHint('default', provider('codex-appserver'))).toContain('in this folder without asking');
    // Each line says what the agent then does, as a consequence.
    expect(modeLabel('default', provider('claude-sdk'))).toBe('Asks before it edits a file or runs a command');
    expect(modeLabel('acceptEdits', provider('claude-sdk'))).toBe('Edits files on its own, asks before commands');
    expect(modeLabel('bypassPermissions', provider('claude-sdk'))).toBe('Runs everything without asking');
    expect(modeHint('bypassPermissions', null)).toContain('anywhere on this computer');
    // A plain name; the technical one stays in the hint.
    expect(modeLabel('yolo', provider('claude-sdk'))).toBe('Runs everything and skips your hooks');
    expect(modeHint('yolo', null)).toContain('(YOLO)');
    expect(modeHint('yolo', null)).toContain('skips Claude and Codex hooks');
  });

  it('reads each mode at rest in the same word on every agent, Codex\'s folder in the line under it', () => {
    expect(modesFor(provider('claude-sdk')).map((mode) => modeWord(mode, provider('claude-sdk')))).toEqual(['No limits', 'Auto', 'Edit freely', 'Ask first']);
    expect(modesFor(provider('codex-appserver')).map((mode) => modeWord(mode, provider('codex-appserver')))).toEqual(['No limits', 'Auto', 'Ask first']);
    expect(modeLabel('default', provider('codex-appserver'))).toBe('Works in this folder, asks to go beyond it');
    expect(modeWord('plan', null)).toBe('Plan');
    expect(modeWord('dontAsk', null)).toBe('Auto-deny');
  });

  it('gives each offered level its own glyph, so the chip reads without its word', () => {
    // Round 18 drew Auto and No limits with the same robot.
    const glyphs = modesFor(provider('claude-sdk')).map(modeIcon);
    expect(new Set(glyphs).size).toBe(4);
  });

  it('remembers YOLO across reloads', () => {
    try {
      writePrefs({ ...defaultPrefs(), permissionMode: 'yolo' });
      expect(readPrefs().permissionMode).toBe('yolo');
    } finally { localStorage.removeItem(PREFS_STORAGE_KEY); }
  });
});
