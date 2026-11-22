import { expect, spyOn, test } from 'bun:test';
import { browserEngineOf, checkSettingsPatch } from '@boite/contracts';
import { assertAllowed } from '../src/access.ts';
import { profileIdentity } from '../src/browser/chromium.ts';
import { BrowserEngines } from '../src/browser/engines.ts';
import { BrowserHost } from '../src/browser/host.ts';
import { Cdp } from '../src/browser/cdp.ts';
import type { Engine } from '../src/browser/types.ts';
import type { Connection } from '../src/router.ts';
import { echoThread, startTestCore } from './harness.ts';
import { thrown } from './settle.ts';

test('profile User-Agent preserves the default, appends a suffix or replaces the whole value', () => {
  const native = { userAgent: 'Mozilla/5.0 Chrome/154.0.0.0', metadata: { platform: 'Windows', brands: [{ brand: 'Chromium', version: '154' }] } };
  expect(profileIdentity(native)).toBe(native);
  expect(profileIdentity(native, { mode: 'suffix', value: '' })).toBe(native);
  expect(profileIdentity(native, { mode: 'replace', value: '   ' })).toBe(native);
  expect(profileIdentity(native, { mode: 'suffix', value: ' Bounty/1 ' })).toEqual({ ...native, userAgent: `${native.userAgent} Bounty/1` });
  expect(profileIdentity(native, { mode: 'replace', value: 'Research/1' })).toEqual({ ...native, userAgent: 'Research/1' });
  expect(native.userAgent).toBe('Mozilla/5.0 Chrome/154.0.0.0');
});

test('profile settings keep User-Agent modes, normalize empty to absent and refuse injected headers', () => {
  const profile = { id: 'p-research', name: 'Research' };
  for (const mode of ['suffix', 'replace'] as const) {
    const userAgent = { mode, value: 'Bounty/1' };
    expect(checkSettingsPatch({ browserProfiles: [{ ...profile, userAgent: { ...userAgent, value: ' Bounty/1 ' } }] }))
      .toEqual({ ok: true, patch: { browserProfiles: [{ ...profile, userAgent }] } });
    expect(checkSettingsPatch({ browserProfiles: [{ ...profile, userAgent: { mode, value: '' } }] }))
      .toEqual({ ok: true, patch: { browserProfiles: [profile] } });
  }
  for (const userAgent of [null, 'Bounty/1', {}, { mode: 'other', value: 'ok' }, { mode: 'suffix', value: 1 },
    ...['x\r\nX-Injected: yes', '\t', '\x00', '\x7f', 'é', 'x'.repeat(8193)].map(value => ({ mode: 'suffix', value }))]) {
    expect(checkSettingsPatch({ browserProfiles: [{ ...profile, userAgent } as never] })).toMatchObject({ ok: false, field: 'browserProfiles' });
  }
  // A whole User-Agent as a suffix would send the browser's own twice; as a replacement it is what it says.
  const whole = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36';
  expect(checkSettingsPatch({ browserProfiles: [{ ...profile, userAgent: { mode: 'suffix', value: ` ${whole.toLowerCase()}` } }] }))
    .toMatchObject({ ok: false, field: 'browserProfiles', message: expect.stringContaining('cannot start with Mozilla/') });
  expect(checkSettingsPatch({ browserProfiles: [{ ...profile, userAgent: { mode: 'replace', value: whole } }] }))
    .toEqual({ ok: true, patch: { browserProfiles: [{ ...profile, userAgent: { mode: 'replace', value: whole } }] } });
});

test('a whole User-Agent stored as a suffix before it was refused reads as a replacement, so the list saves again', async () => {
  const harness = await startTestCore();
  try {
    const whole = 'Mozilla/5.0 Chrome/158.0.0.0';
    harness.core.journal.setSetting('settings', { ...harness.core.settings.stored(), browserProfiles: [{ id: 'p-old', name: 'Old', userAgent: { mode: 'suffix', value: whole } }, { id: 'p-tag', name: 'Tag', userAgent: { mode: 'suffix', value: 'Bounty/1' } }] });
    expect(harness.core.settings.get().browserProfiles).toEqual([{ id: 'p-old', name: 'Old', userAgent: { mode: 'replace', value: whole } }, { id: 'p-tag', name: 'Tag', userAgent: { mode: 'suffix', value: 'Bounty/1' } }]);
    const owner = await harness.connect();
    await owner.call('settings.set', { browserProfiles: [...harness.core.settings.get().browserProfiles!, { id: 'p-new', name: 'New' }] });
    expect(harness.core.settings.get().browserProfiles?.map(one => one.id)).toEqual(['p-old', 'p-tag', 'p-new']);
    owner.close();
  } finally { await harness.stop(); }
});

test('the engine is chosen per profile, the built-in default included, and refuses anything else', () => {
  expect(checkSettingsPatch({ browserProfiles: [{ id: 'p-a', name: 'A', engine: 'chrome' }, { id: 'p-b', name: 'B', engine: 'app' }] }))
    .toEqual({ ok: true, patch: { browserProfiles: [{ id: 'p-a', name: 'A', engine: 'chrome' }, { id: 'p-b', name: 'B', engine: 'app' }] } });
  expect(checkSettingsPatch({ browserBuiltinProfiles: { default: { engine: 'chrome' } } }))
    .toEqual({ ok: true, patch: { browserBuiltinProfiles: { default: { engine: 'chrome' } } } });
  expect(checkSettingsPatch({ browserBuiltinProfiles: { default: {} } })).toEqual({ ok: true, patch: { browserBuiltinProfiles: {} } });
  expect(checkSettingsPatch({ browserProfiles: [{ id: 'p-a', name: 'A', engine: 'firefox' } as never] })).toMatchObject({ ok: false, field: 'browserProfiles' });
  for (const builtins of [null, [], { default: { engine: 'edge' } }, { private: { engine: 'chrome' } }, { default: 'chrome' }, { default: { engine: 'app', userAgent: {} } }]) {
    expect(checkSettingsPatch({ browserBuiltinProfiles: builtins as never })).toMatchObject({ ok: false, field: 'browserBuiltinProfiles' });
  }
  // An absent engine reads as before it existed: a User-Agent ran the profile in Chromium.
  const settings = { browserProfiles: [{ id: 'p-ua', name: 'UA', userAgent: { mode: 'suffix' as const, value: 'Bounty/1' } }, { id: 'p-plain', name: 'Plain' }, { id: 'p-chrome', name: 'Chrome', engine: 'chrome' as const }] };
  expect(['p-ua', 'p-plain', 'p-chrome', 'default', 'private', 'p-gone'].map(id => browserEngineOf(settings, id))).toEqual(['chrome', 'app', 'chrome', 'app', 'app', 'app']);
  expect(browserEngineOf({ browserBuiltinProfiles: { default: { engine: 'chrome' } } }, 'default')).toBe('chrome');
});

test('an agent can neither set nor ask for a browser profile or its engine', async () => {
  const harness = await startTestCore();
  try {
    const owner = await harness.connect();
    const { threadId } = await echoThread(harness, owner);
    const agent = { id: 'con_agent', subscriptions: new Set(), identity: { principal: 'agent', sessionId: null, threadId }, sendEvent() {}, close() {} } as unknown as Connection;
    expect(() => assertAllowed('settings.set', agent, { threadId, browserBuiltinProfiles: { default: { engine: 'chrome' } } })).toThrow("not one of the agent's methods");
    for (const [key, value] of [['browserBuiltinProfiles', { default: { engine: 'chrome' } }], ['browserProfiles', [{ id: 'p-a', name: 'A', engine: 'chrome' }]], ['browserDefaultProfile', 'p-a']] as const) {
      expect(() => assertAllowed('settings.request', agent, { threadId, key, value })).not.toThrow();
      expect(await thrown(owner.call('settings.request', { threadId, key: key as never, value, reason: 'Run in Chrome' }))).toThrow(`${key} is not a setting an agent may ask about`);
    }
    expect(harness.core.settings.get().browserBuiltinProfiles).toBeUndefined();
    owner.close();
  } finally { await harness.stop(); }
});

test('a profile set to Chrome starts Chromium while the app hosts, and the other engine only from its next start', async () => {
  const harness = await startTestCore();
  const host = new BrowserHost();
  host.attach({ identity: { principal: 'owner' }, sentFrom: { client: 'shell' }, remote: false } as Connection);
  const engines = new BrowserEngines(harness.core, host, () => ({ path: null, reason: 'unused' }), 'fixture', 'system:browser', () => {}, () => {},
    { prepare: () => harness.dataDir, lost: () => {} });
  const created: Engine[] = [];
  const launching = spyOn(engines, 'launch').mockImplementation(async (profile, _identify, hosted) => {
    const relay = Cdp.relay(() => {}, () => { relay.end(); });
    const engine: Engine = { key: hosted ? `host:${profile}` : profile, profile, hosted: !!hosted, dir: '', cdp: relay.cdp,
      kill: () => relay.cdp.close(), exited: relay.cdp.closed, tabs: new Set(['open-tab']), throwaway: false, identity: null };
    created.push(engine);
    return engine;
  });
  const restart = async (engine: Engine) => { engine.cdp.close(); await engines.shut(engine); };
  try {
    expect((await engines.get('default')).hosted).toBe(true);
    harness.core.settings.set({ browserBuiltinProfiles: { default: { engine: 'chrome' } }, browserProfiles: [{ id: 'p-a', name: 'A', engine: 'chrome' }, { id: 'p-b', name: 'B', engine: 'app' }] });
    const before = await engines.get('default');
    expect(before.hosted).toBe(true);
    await restart(before);
    expect((await engines.get('default')).hosted).toBe(false);
    expect((await engines.get('p-a')).hosted).toBe(false);
    expect((await engines.get('p-b')).hosted).toBe(true);
    // A User-Agent needs Chromium whatever the engine says: a webview has no per-profile identity.
    harness.core.settings.set({ browserProfiles: [{ id: 'p-a', name: 'A', engine: 'chrome' }, { id: 'p-b', name: 'B', engine: 'app', userAgent: { mode: 'suffix', value: 'Bounty/1' } }] });
    await restart(await engines.get('p-b'));
    expect((await engines.get('p-b')).hosted).toBe(false);
    // Without a hosting app every profile runs in Chromium.
    host.detach();
    await restart(await engines.get('default'));
    harness.core.settings.set({ browserBuiltinProfiles: {} });
    expect((await engines.get('default')).hosted).toBe(false);
  } finally {
    for (const engine of created) { engine.cdp.close(); engines.lost(engine); }
    launching.mockRestore();
    host.detach();
    await harness.stop();
  }
});

test('User-Agent changes keep one engine owning a profile until its current engine closes', async () => {
  const harness = await startTestCore();
  const host = new BrowserHost();
  host.attach({ identity: { principal: 'owner' }, sentFrom: { client: 'shell' }, remote: false } as Connection);
  const hostedEngines = new BrowserEngines(harness.core, host, () => ({ path: null, reason: 'unused' }), 'fixture', 'system:browser', () => {}, () => {},
    { prepare: () => harness.dataDir, lost: () => {} });
  const created: Engine[] = [];
  // Keep the real acquisition and shutdown paths, without starting a native process.
  const launching = spyOn(hostedEngines, 'launch').mockImplementation(async (profile, _identify, hosted) => {
    const relay = Cdp.relay(() => {}, () => { relay.end(); });
    const { cdp } = relay;
    const engine: Engine = { key: hosted ? `host:${profile}` : profile, profile, hosted: !!hosted, dir: '', cdp,
      kill: () => cdp.close(), exited: cdp.closed, tabs: new Set(['open-tab']), throwaway: false, identity: null };
    created.push(engine);
    return engine;
  });
  let owner: Awaited<ReturnType<typeof harness.connect>> | undefined;
  try {
    owner = await harness.connect();
    await owner.call('settings.set', { browserProfiles: [{ id: 'p-research', name: 'Research' }] });
    const hosted = await hostedEngines.get('p-research');
    await owner.call('settings.set', { browserProfiles: [{ id: 'p-research', name: 'Research', userAgent: { mode: 'suffix', value: 'Bounty/1' } }] });
    expect(await hostedEngines.get('p-research')).toBe(hosted);
    expect(created).toHaveLength(1);
    const stopping = hostedEngines.shut(hosted);
    const opening = hostedEngines.get('p-research');
    await Promise.resolve();
    expect(created).toHaveLength(1);
    hosted.cdp.close();
    await stopping;
    const local = await opening;
    expect(local.hosted).toBe(false);
    await owner.call('settings.set', { browserProfiles: [{ id: 'p-research', name: 'Research' }] });
    expect(await hostedEngines.get('p-research')).toBe(local);
    expect(created).toHaveLength(2);
    local.cdp.close();
    await hostedEngines.shut(local);
    expect((await hostedEngines.get('p-research')).hosted).toBe(true);
  } finally {
    for (const engine of created) { engine.cdp.close(); hostedEngines.lost(engine); }
    launching.mockRestore();
    host.detach();
    owner?.close(); await harness.stop();
  }
});
