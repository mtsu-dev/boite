import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { setExperiment } from '../lib/experiments';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { workspace } from '../lib/workspace.svelte';
import { workTally } from '../lib/work-counts';
import { lifecycleCounts, lifecycleProjects } from '../lib/lifecycle-filter.svelte';
import Inbox from './home/Inbox.svelte';
import LifecycleStrip from './LifecycleStrip.svelte';
import MobileNavigation from './MobileNavigation.svelte';
import SurfaceSwitch from './SurfaceSwitch.svelte';

/**
 * The one count rule, end to end: on the showcase seed, every surface that
 * shows how many threads need the user draws the same number. A second
 * selector anywhere would split them, as round 1 found (strip 11, Inbox 12).
 */
const apps: ReturnType<typeof mount>[] = [];
const stores: Store[] = [];
const previousActive = workspace.active;
const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  for (const app of apps.splice(0)) await unmount(app);
  for (const store of stores.splice(0)) { store.detach(); store.client?.close(); }
  workspace.machines = []; workspace.active = previousActive;
  setExperiment('resident-agents', false);
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

async function seed() {
  const store = new Store();
  store.attach(new FakeClient({ delayMs: 0 }));
  await store.connect();
  stores.push(store);
  return store;
}
const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;
const attr = (id: string, name: string) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute(name) ?? null;

test('the strip, the Inbox header, the Inbox tab badge and the switch agree on the seed, and a machine gone offline leaves all of them', async () => {
  setExperiment('resident-agents', true);
  const local = await seed(), remote = await seed();
  // The second machine asks something too, so a disconnect has a number to take away.
  remote.threads = remote.threads.map(thread => thread.id === 't-bench' ? { ...thread, status: 'waiting' } : thread);
  // A project thread and a bot at work here, so Working has a thread to count and a bot to keep apart.
  const [working, bot] = local.threads.filter(thread => thread.status === 'idle' && !thread.archived && !thread.parentThreadId).map(thread => thread.id);
  expect(bot).toBeDefined();
  local.threads = local.threads.map(thread => thread.id === working ? { ...thread, status: 'running', runningSince: Date.now() }
    : thread.id === bot ? { ...thread, status: 'running', runningSince: Date.now(), agentSessionId: 'agt_count' } : thread);
  // A bot on the second machine asks, so the Inbox's robot chip has a card of its own behind it.
  remote.threads = remote.threads.map(thread => thread.id === bot ? { ...thread, status: 'waiting', requestSince: Date.now(), agentSessionId: 'agt_ask' } : thread);
  workspace.machines = [{ id: 'local', label: 'Local', store: local }, { id: 'remote', label: 'Builder', store: remote }];
  workspace.active = local;
  const entries = () => workspace.machines.flatMap(machine => machine.store.projects.filter(project => !project.archived).map(project => ({ machine, project })));

  const draw = async () => {
    for (const app of apps.splice(0)) await unmount(app);
    document.body.innerHTML = '';
    for (const [component, props] of [
      [LifecycleStrip, { entries: entries() }],
      [Inbox, { store: local }],
      [SurfaceSwitch, { store: local, current: 'agents' }]
    ] as const) {
      const target = document.body.appendChild(document.createElement('div'));
      apps.push(mount(component as never, { target, props: props as never }));
    }
    await settle();
  };
  const read = () => ({
    strip: Number(attr('lifecycle-waiting', 'data-count')),
    inbox: Number(text('inbox-needs-count') ?? 0),
    switch: Number(attr('threads-at-work', 'data-count') ?? 0)
  });

  await draw();
  const expected = workTally([local, remote]).threads.needs;
  expect(expected).toBeGreaterThan(1);
  expect(read()).toEqual({ strip: expected, inbox: expected, switch: expected });
  expect(attr('threads-at-work', 'data-counts')).toBe('needs');
  // Working agrees too: the Inbox's header counts threads as the strip does, a bot at work apart (round 2 read 7 against 8).
  const atWork = workTally([local, remote]);
  expect(atWork.threads.working).toBeGreaterThan(0);
  expect(atWork.bots.working).toBeGreaterThan(0);
  expect({ strip: Number(attr('lifecycle-working', 'data-count')), inbox: Number(text('inbox-working-count') ?? 0) }).toEqual({ strip: atWork.threads.working, inbox: atWork.threads.working });

  // The Inbox's two needs numbers name one set each (round 2 read "Needs you 9", a robot 1, then "See all (10)"):
  // the header and See all count the thread cards, the robot chip counts the bot cards it opens.
  const cards = (scope: string) => document.querySelectorAll(`${scope} [data-testid=inbox-card]`).length;
  expect(atWork.bots.needs).toBeGreaterThan(0);
  expect(Number(text('inbox-needs-bots'))).toBe(atWork.bots.needs);
  expect(document.querySelector('[data-testid=inbox-bot-cards]')).toBeNull();
  const seeAll = document.querySelector<HTMLButtonElement>('[data-testid=inbox-more]');
  if (seeAll) { expect(Number(seeAll.dataset.count)).toBe(expected); seeAll.click(); await settle(); }
  expect(cards('[data-testid=inbox] > .cards:not(.bot-cards):not(.offline)')).toBe(expected);
  document.querySelector<HTMLButtonElement>('[data-testid=inbox-needs-bots]')!.click();
  await settle();
  expect(cards('[data-testid=inbox-bot-cards]')).toBe(atWork.bots.needs);

  // The phone's Inbox tab reads the same pass through MobileNavigation.
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), { media, matches: true, onchange: null, addListener() {}, removeListener() {} }) as never);
  const phone = document.body.appendChild(document.createElement('div'));
  apps.push(mount(MobileNavigation, { target: phone, props: { store: local, screen: 'threads' } }));
  await settle();
  expect(Number(text('mobile-activity-waiting'))).toBe(expected);
  // The phone's Recent chip and its Inbox lanes split threads from bots as the desktop does (round 2: "3 at work" counted the bot).
  for (const app of apps.splice(-1)) await unmount(app);
  workspace.view = 'recent';
  apps.push(mount(MobileNavigation, { target: phone, props: { store: local, screen: 'threads' } }));
  await settle();
  expect(Number(attr('mobile-at-work-threads', 'data-count'))).toBe(atWork.threads.working);
  expect(Number(text('mobile-at-work-bots'))).toBe(atWork.bots.working);
  for (const app of apps.splice(-1)) await unmount(app);
  workspace.view = 'projects';
  apps.push(mount(MobileNavigation, { target: phone, props: { store: local, screen: 'activity' } }));
  await settle();
  expect({
    needs: Number(attr('mobile-inbox-needs-threads', 'data-count')), needsBots: Number(attr('mobile-inbox-needs-bots', 'data-count')),
    working: Number(attr('mobile-inbox-working-threads', 'data-count')), workingBots: Number(attr('mobile-inbox-working-bots', 'data-count'))
  }).toEqual({ needs: expected, needsBots: atWork.bots.needs, working: atWork.threads.working, workingBots: atWork.bots.working });

  // A machine that stops answering counts nowhere; its asks move to the Inbox's muted Offline list.
  remote.connection = 'closed';
  await draw();
  const fewer = workTally([local, remote]).threads.needs;
  expect(fewer).toBeLessThan(expected);
  expect(read()).toEqual({ strip: fewer, inbox: fewer, switch: fewer });
  expect(document.querySelectorAll('[data-testid=inbox-offline] [data-testid=inbox-card]').length).toBeGreaterThan(0);
});

test('a filter lists the rows its count holds: a parent whose remote subagent asks sits under Needs you, never under Working', async () => {
  const local = await seed();
  // The child runs on another machine, so only the parent's summary carries the question while its own turn runs.
  const parent = local.threads.find(thread => thread.status === 'idle' && !thread.archived && !thread.parentThreadId && !thread.agentSessionId)!;
  local.threads = local.threads.map(thread => thread.id === parent.id
    ? { ...thread, status: 'running', runningSince: Date.now(), subagentQuestions: [{ threadId: 'remote-child', title: 'Keep the old key?' }] } as typeof thread
    : thread);
  workspace.machines = [{ id: 'local', label: 'Local', store: local }];
  const entries = local.projects.filter(project => !project.archived).map(project => ({ machine: workspace.machines[0]!, project }));
  const rows = (kind: 'waiting' | 'working') => lifecycleProjects(entries, kind).flatMap(({ threads }) => threads.map(thread => thread.id));
  const counts = lifecycleCounts(entries);
  expect(rows('waiting')).toContain(parent.id);
  expect(rows('working')).not.toContain(parent.id);
  expect({ waiting: rows('waiting').length, working: rows('working').length }).toEqual({ waiting: counts.waiting, working: counts.working });
});
