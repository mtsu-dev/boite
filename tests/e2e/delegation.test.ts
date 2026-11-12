import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { DEFAULT_DELEGATION_CONFIG } from '../../packages/contracts/src/index.ts';
import { connect, type CoreClient } from '../../packages/core/src/client.ts';
import { BrowserPage } from './lib/cdp.ts';
import { pairingUrlOf, startCore, type RunningCore } from './lib/core.ts';

let core: RunningCore;
let page: BrowserPage;
let owner: CoreClient;
let threadId: string;
/** Subagents are a panel: the header's Panels door opens the panel, on its launcher or on the surface it last showed. */
async function openAgents(): Promise<void> {
  await page.click('[data-testid=panel-toggle]');
  await page.waitFor('!!document.querySelector("[data-testid=launch-agents], [data-testid=delegation-surface]")');
  if (!await page.evaluate('!!document.querySelector("[data-testid=delegation-surface]")')) await page.click('[data-testid=launch-agents]');
  await page.waitFor('!!document.querySelector("[data-testid=delegation-surface]")');
}
beforeAll(async () => {
  core = await startCore(); owner = await connect(core.url, core.token);
  const project = await owner.call('projects.add', { path: core.dataDir, name: 'Delegation checks' });
  const account = (await owner.call('accounts.list', {})).find(a => a.providerId === 'echo')!;
  const thread = await owner.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, model: 'echo', title: 'Coordinate parser review' });
  threadId = thread.id;
  await owner.call('delegation.configure', { threadId, config: { ...DEFAULT_DELEGATION_CONFIG, enabled: true, profiles: [{ id: 'review', name: 'Reviewer', providerId: 'echo', accountId: account.id, model: 'echo', effort: null }] } });
  page = await BrowserPage.launch({ url: pairingUrlOf(core) });
  await page.click(`[data-testid="thread-row"][data-thread-id="${threadId}"]`);
  await openAgents();
}, 60_000);
afterAll(async () => { await page?.close(); owner?.close(); await core?.stop(); }, 30_000);

test('inspect and stop a real delegated thread from the panel, which launches nothing itself', async () => {
  // An empty conversation shows one line on what subagents are, and nothing to fill in.
  expect(await page.evaluate('document.querySelectorAll("[data-testid=delegation-surface] :is(textarea, input, details, p:not([data-testid=delegation-empty]))").length')).toBe(0);
  expect(await page.text('[data-testid="delegation-empty"]')).not.toBe('');
  await owner.call('delegation.spawn', { threadId, profileId: 'review', task: 'Review parser boundaries [sleep:20000]', requestId: 'first-agent' });
  // The conversation waits on it: one line above the composer, its name and Stop.
  await page.waitFor('document.querySelector("[data-testid=agent-dock]")?.dataset.count === "1"');
  expect(await page.text('[data-testid="agent-dock-label"]')).toBe('Waiting on 1 subagent');
  await page.waitFor('document.querySelectorAll("[data-testid=delegation-member]").length === 1');
  const view = await owner.call('delegation.get', { threadId });
  expect(view.agents).toHaveLength(1);
  expect(view.agents[0]!.thread.parentThreadId).toBe(threadId);
  await page.click('[data-testid="panel-close"]');
  await page.waitFor('!document.querySelector("[data-testid=right-panel]")');
  expect(await page.text('[data-testid="delegation-activity"]')).toContain('1 subagent');
  expect(await page.text('[data-testid="delegation-progress"]')).toContain('1 working');
  expect(await page.evaluate('!!document.querySelector("[data-testid=delegation-activity] [data-testid=agent-elapsed]")')).toBe(true);
  // The grouped row unfolds in place on one row per subagent.
  await page.click('[data-testid="delegation-activity"]');
  await page.waitFor('document.querySelector("[data-testid=delegation-activity]")?.getAttribute("aria-expanded") === "true"');
  expect(await page.evaluate('document.querySelectorAll("[data-testid=delegation-agent][data-state=working]").length')).toBe(1);
  await page.click('[data-testid="delegation-activity"]');
  await openAgents();
  await page.waitFor('!!document.querySelector("[data-testid=delegation-member]")');
  expect(await page.evaluate('document.querySelector("[data-testid=delegation-member-route]").title')).toContain('Echo · Echo');
  expect(await page.evaluate('!!document.querySelector("[data-testid=delegation-active] [data-testid=delegation-member]")')).toBe(true);
  expect(await page.evaluate('document.querySelectorAll("[data-testid=delegation-surface] :is(textarea, input)").length')).toBe(0);
  await page.click('[data-testid="delegation-stop-all"]');
  await page.waitFor('!document.querySelector("[data-testid=agent-dock]")');
  expect((await owner.call('delegation.get', { threadId })).config.paused).toBe(true);
  await page.waitFor('document.querySelector("[data-testid=delegation-progress]")?.textContent.includes("1 stopped")');
  expect(await page.text('[data-testid="delegation-progress"]')).toBe('1 stopped');
  expect(page.errors()).toEqual([]);
  await page.waitFor('document.getAnimations().every(animation => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity || animation.timeline !== document.timeline)');
  await page.screenshot(join(import.meta.dir, '.artifacts/delegation-desktop.png'));
}, 40_000);

test('the phone opens a subagent in the chat, under its parent\'s title', async () => {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.click('[data-testid="panel-close"]');
  await page.click('[data-testid="delegation-activity"]');
  await page.waitFor('document.querySelector("[data-testid=delegation-activity]")?.getAttribute("aria-expanded") === "true"');
  await page.click('[data-testid="delegation-agent"]');
  await page.waitFor(`document.querySelector("[data-testid=thread-header]") && document.querySelector("[data-testid=delegation-back-parent]")`);
  expect(await page.evaluate('!!document.querySelector("[data-testid=delegation-surface]")')).toBe(false);
  // The task shows as the chat's first message, the way any conversation reads.
  await page.waitFor('document.querySelector("[data-testid=timeline]")?.textContent.includes("Review parser boundaries")');
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  await page.waitFor('document.getAnimations().every(animation => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity || animation.timeline !== document.timeline)');
  await page.screenshot(join(import.meta.dir, '.artifacts/delegation-phone.png'));
  await page.click('[data-testid="delegation-back-parent"]');
  await page.waitFor(`!document.querySelector("[data-testid=delegation-back-parent]") && !!document.querySelector("[data-testid=delegation-activity]")`);
  expect(page.errors()).toEqual([]);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
}, 15_000);

test('completed counts and frozen duration survive reopening the conversation', async () => {
  const view = await owner.call('delegation.get', { threadId });
  await owner.call('delegation.configure', { threadId, config: { ...view.config, paused: false } });
  await owner.call('delegation.spawn', { threadId, profileId: 'review', task: 'Check the final result', requestId: 'completed-agent' });
  await page.waitFor('document.querySelector("[data-testid=delegation-progress]")?.textContent.includes("1 done")');
  await page.waitFor('!document.querySelector("[data-testid=agent-dock]")');
  const elapsed = await page.text('[data-testid="delegation-activity"] [data-testid="agent-elapsed"]');
  await page.reload();
  await page.click(`[data-testid="thread-row"][data-thread-id="${threadId}"]`);
  await page.waitFor('!!document.querySelector("[data-testid=delegation-activity]")');
  expect(await page.text('[data-testid="delegation-progress"]')).toBe('1 done, 1 stopped');
  expect(await page.text('[data-testid="delegation-activity"] [data-testid="agent-elapsed"]')).toBe(elapsed);
  expect(page.errors()).toEqual([]);
}, 15_000);

test('a newly started workflow appears above the composer without reopening the conversation', async () => {
  if (await page.evaluate('!!document.querySelector("[data-testid=panel-close]")')) await page.click('[data-testid=panel-close]');
  const run = await owner.call('workflows.start', { threadId, requestId: 'visible-workflow', plan: {
    name: 'Check the workflow indicator', steps: [{ id: 'review', profile: 'review', task: 'Review the workflow indicator [sleep:20000]' }]
  } });
  await page.waitFor('document.querySelector("[data-testid=agent-dock]")?.dataset.runs === "1"');
  expect(await page.text('[data-testid="agent-dock-label"]')).toBe('Waiting on 1 workflow');
  expect(await page.text('[data-testid="agent-dock-names"]')).toContain('Check the workflow indicator');
  // The line's two controls: its fold and a Stop that names what it stops.
  expect(await page.evaluate('[...document.querySelectorAll("[data-testid=agent-dock] button")].map(button => button.dataset.testid)')).toEqual(['composer-foot-fold', 'agent-dock-stop']);
  expect(await page.text('[data-testid="agent-dock-stop"]')).toBe('Stop workflows');
  await page.waitFor('document.getAnimations().every(a => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity || a.timeline !== document.timeline)');
  await page.screenshot(join(import.meta.dir, '.artifacts/workflow-dock-desktop.png'));
  // Its own grouped row in the timeline opens its graph.
  await page.click(`[data-testid="workflow-activity"][data-run-id="${run.id}"]`);
  await page.waitFor(`document.querySelector('[data-testid=workflow-graph]')`);
  await page.click('[data-testid="panel-close"]');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.waitFor('innerWidth === 390');
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  await page.waitFor('document.getAnimations().every(a => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity || a.timeline !== document.timeline)');
  await page.screenshot(join(import.meta.dir, '.artifacts/workflow-dock-phone.png'));
  // Stop on the waiting line stops the run.
  await page.click('[data-testid="agent-dock-stop"]');
  await page.waitFor('!document.querySelector("[data-testid=agent-dock]")');
  expect(page.errors()).toEqual([]);
}, 25_000);
