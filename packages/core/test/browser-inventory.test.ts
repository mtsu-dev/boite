import { expect, spyOn, test } from 'bun:test';
import type { BrowserAction } from '@boite/contracts';
import { AgentBrowser } from '../src/browser.ts';
import { Cdp } from '../src/browser/cdp.ts';
import { BrowserEngines } from '../src/browser/engines.ts';
import { BrowserIdentities } from '../src/browser/launch.ts';
import { echoThread, startTestCore } from './harness.ts';
import { thrown } from './settle.ts';

type PageTarget = { targetId: string; type: 'page'; url: string; title: string; openerId?: string };

async function browserFixture() {
  const harness = await startTestCore();
  const { threadId } = await echoThread(harness, await harness.connect());
  const url = (targetId: string) => `https://fixture.invalid/${targetId}`;
  const targets = new Map<string, PageTarget>();
  const evaluated: string[] = [];
  let opened = 0;
  let list: ((reply: () => void) => void) | undefined;
  let cookies = () => Promise.resolve();

  function destroy(targetId: string): void {
    targets.delete(targetId);
    relay.receive(JSON.stringify({ method: 'Target.targetDestroyed', params: { targetId } }));
  }

  const relay = Cdp.relay(text => {
    const { id, method, params, sessionId } = JSON.parse(text) as {
      id: number; method: string; params: { targetId?: string; expression?: string }; sessionId?: string;
    };
    const reply = (result: object) => relay.receive(JSON.stringify({ id, result }));
    const missingTarget = () => relay.receive(JSON.stringify({ id, error: { message: 'No target with given id found' } }));
    const target = typeof params.targetId === 'string' ? targets.get(params.targetId) : undefined;
    switch (method) {
      case 'Target.createTarget': {
        const targetId = `tab-${++opened}`;
        targets.set(targetId, { type: 'page', targetId, url: url(targetId), title: '' });
        return reply({ targetId });
      }
      case 'Target.getTargets': {
        const targetInfos = [...targets.values()];
        const respond = () => reply({ targetInfos });
        return list ? list(respond) : respond();
      }
      case 'Target.getTargetInfo': return target ? reply({ targetInfo: target }) : missingTarget();
      case 'Target.attachToTarget': return target ? reply({ sessionId: target.targetId }) : missingTarget();
      case 'Target.closeTarget': {
        if (!target) return missingTarget();
        destroy(target.targetId);
        return reply({ success: true });
      }
      case 'Runtime.evaluate': {
        if (params.expression !== 'location.pathname' || !sessionId) return reply({ result: { value: null } });
        evaluated.push(sessionId);
        return reply({ result: { value: `/${sessionId}` } });
      }
      case 'Storage.getCookies': return void cookies().then(() => reply({ cookies: [] }));
      case 'Browser.close': reply({}); relay.end(); return;
      default: return reply({});
    }
  }, () => {});

  const identity = spyOn(BrowserIdentities.prototype, 'of').mockResolvedValue(null);
  const launch = spyOn(BrowserEngines.prototype, 'start').mockResolvedValue({
    cdp: relay.cdp, exited: relay.cdp.closed, kill: async () => relay.cdp.close(),
  });
  const browser = new AgentBrowser(harness.core, () => ({ path: 'mock-browser' }));
  return {
    targets, evaluated, destroy,
    run: (action: BrowserAction) => browser.command({ threadId, action }),
    tabs: () => browser.status({ threadId }).tabs,
    open: () => browser.command({ threadId, action: { kind: 'open', url: url('open') } }),
    archive() { harness.core.threads.archive(threadId, true); browser.release(threadId); },
    popup(targetId: string) {
      const target: PageTarget = { type: 'page', targetId, openerId: 'tab-1', url: url(targetId), title: '' };
      targets.set(targetId, target);
      return () => relay.receive(JSON.stringify({ method: 'Target.targetCreated', params: { targetInfo: target } }));
    },
    onList(respond: typeof list) { list = respond; },
    holdCookies(until: Promise<void>) {
      const requested = Promise.withResolvers<void>();
      cookies = () => { requested.resolve(); return until; };
      return requested.promise;
    },
    async close() {
      try { await browser.close(); }
      finally { launch.mockRestore(); identity.mockRestore(); await harness.stop(); }
    },
  };
}

const location: BrowserAction = { kind: 'evaluate', expression: 'location.pathname' };

test('a destroyed popup in a target inventory does not take the last slot from a live popup', async () => {
  const fixture = await browserFixture();
  try {
    for (let index = 0; index < 7; index++) await fixture.open();
    fixture.popup('closing-popup')();
    expect((await fixture.run(location)).value).toBe('/closing-popup');
    expect(fixture.tabs()).toHaveLength(8);

    const announce = fixture.popup('live-popup');
    fixture.onList(reply => {
      // Same CDP read: the response resolves the promise, then the destroy event runs before it resumes.
      reply();
      fixture.destroy('closing-popup');
    });
    expect((await fixture.run(location)).value).toBe('/live-popup');
    announce();
    expect(fixture.targets.has('live-popup')).toBe(true);
    expect(fixture.tabs()).toHaveLength(8);
  } finally { await fixture.close(); }
});

test('a command waiting for a target inventory does not act after the conversation is archived', async () => {
  const fixture = await browserFixture();
  const saving = Promise.withResolvers<void>();
  try {
    await fixture.open();
    const listed = Promise.withResolvers<() => void>();
    fixture.onList(listed.resolve);
    const pending = thrown(fixture.run(location));
    const respond = await listed.promise;
    const cookiesRequested = fixture.holdCookies(saving.promise);
    fixture.archive();
    await cookiesRequested;
    expect(fixture.tabs()).toHaveLength(1);
    respond();

    expect(await pending).toThrow('the agent browser needs an active conversation');
    expect(fixture.evaluated).toEqual([]);
  } finally { saving.resolve(); await fixture.close(); }
});
