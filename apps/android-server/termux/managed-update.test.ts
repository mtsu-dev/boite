import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { thrown } from '../../../packages/core/test/settle.ts';
import { runManagedUpdate, type ManagedUpdatePlan } from './managed-update.ts';

test('managed controller prepares and verifies before ready, waits for exact admission and cancels without activation', async () => {
  for (const cancel of [true, false]) {
    const directory = mkdtempSync(join(tmpdir(), 'boite-managed-gate-'));
    const plan = { id: 'gate', version: '2.0.0', previousVersion: '1.0.0', channel: 'nightly' } as ManagedUpdatePlan;
    let prepared = false; let activated = false;
    try {
      const worker = runManagedUpdate(directory, plan, {
        validate: () => {},
        find: async () => ({ version: '2.0.0', url: 'signed Android bundle', signature: 'signature' }),
        prepare: async () => { prepared = true; return { staging: join(directory, 'stage') } as never; },
        activate: async () => { activated = true; },
      }, 5, 1000);
      for (let i = 0; i < 100 && !existsSync(join(directory, 'ready')); i++) await Bun.sleep(5);
      expect(prepared).toBe(true);
      expect(readFileSync(join(directory, 'ready'), 'utf8')).toBe('gate');
      expect(activated).toBe(false);
      writeFileSync(join(directory, cancel ? 'cancelled' : 'admitted'), cancel ? '' : 'gate');
      expect(await worker).toBe(cancel ? 'cancelled' : 'installed');
      expect(activated).toBe(!cancel);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test('managed controller refuses an offer changed after the RPC check without preparing or stopping', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'boite-managed-version-'));
  try {
    let prepared = false;
    expect(await thrown(runManagedUpdate(directory, { version: '2.0.0', channel: 'nightly' } as ManagedUpdatePlan, {
      validate: () => {}, find: async () => ({ version: '3.0.0', url: '', signature: '' }),
      prepare: async () => { prepared = true; return {} as never; }, activate: async () => { throw new Error('must not stop'); },
    }, 5, 100))).toThrow('offered version');
    expect(prepared).toBe(false);
    expect(existsSync(join(directory, 'ready'))).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('managed controller rejects a forged admission and a cancelled operation before preparation', async () => {
  for (const cancelled of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), 'boite-managed-invalid-admission-'));
    let prepared = false; let activated = false;
    try {
      writeFileSync(join(directory, cancelled ? 'cancelled' : 'admitted'), cancelled ? '' : 'different-operation');
      const operation = runManagedUpdate(directory, { id: 'gate', version: '2.0.0', channel: 'nightly' } as ManagedUpdatePlan, {
        validate: () => {}, find: async () => ({ version: '2.0.0', url: '', signature: '' }),
        prepare: async () => { prepared = true; return { staging: join(directory, 'stage') }; },
        activate: async () => { activated = true; },
      }, 5, 100);
      if (cancelled) expect(await operation).toBe('cancelled');
      else expect(await thrown(operation)).toThrow('admission must match');
      expect(prepared).toBe(!cancelled);
      expect(activated).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
