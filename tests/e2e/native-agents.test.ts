import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { mobileAction } from './lib/mobile.ts';
import { startDevUi } from './lib/ui.ts';

let server: { close(): Promise<void> };
let page: BrowserPage;
const onStore = (code: string) => page.evaluate(`import('/src/lib/store.svelte.ts').then(async ({ store }) => { ${code} })`);
async function capture(name: string) {
  await page.evaluate('document.querySelector("[data-testid=delegation-surface]")?.scrollTo(0, 0)');
  await page.settleAnimations();
  await page.screenshot(join(import.meta.dir, '.artifacts', name));
}
/** Subagents are a panel, desktop and phone: the header's Panels door opens it, on its launcher or on the surface it last showed. */
async function openAgents(): Promise<void> {
  await page.click('[data-testid=panel-toggle]');
  await page.waitFor('!!document.querySelector("[data-testid=launch-agents], [data-testid=delegation-surface]")');
  if (!await page.evaluate('!!document.querySelector("[data-testid=delegation-surface]")')) await page.click('[data-testid=launch-agents]');
  await page.waitFor('!!document.querySelector("[data-testid=delegation-surface]")');
}
/** A project card folds its quiet threads under "Show N more": unfold the cards until the row shows. */
async function unfoldFor(row: string): Promise<void> {
  await page.waitFor(`!!document.querySelector('${row}') || !!document.querySelector('[data-testid=project-more][aria-expanded=false]')`);
  await page.evaluate(`document.querySelector('${row}') || document.querySelectorAll('[data-testid=project-more][aria-expanded=false]').forEach(button => button.click())`);
  await page.waitFor(`!!document.querySelector('${row}')`);
}
beforeAll(async () => {
  const port = await freePort();
  server = await startDevUi(port);
  page = await BrowserPage.launch({ url: `http://127.0.0.1:${port}/?fake=1&team=1`, windowSize: { width: 1310, height: 820 } });
  await unfoldFor('[data-testid="thread-row"][data-thread-id="t-native"]');
  await page.click('[data-testid="thread-row"][data-thread-id="t-native"]');
  await openAgents();
  await page.waitFor('!!document.querySelector("[data-testid=native-agents]")');
}, 60_000);
afterAll(async () => { await page?.close(); await server?.close(); }, 30_000);

test('native agents remain visible beside Boite subagents on desktop and phone', async () => {
  await page.click('[data-testid="native-agent"] > summary');
  await capture('native-agents-desktop.png');
  expect(await page.text('[data-testid="delegation-surface"]')).toContain('Started by the provider');
  expect(await page.evaluate('document.querySelectorAll("[data-testid=native-agent]").length')).toBe(2);
  expect(await page.text('[data-testid="native-agents"]')).toContain('Parser checked');
  expect(await page.text('[data-testid="native-agents"]')).toContain('Status unknown');
  expect(await page.text('[data-testid="native-agents"]')).toContain('fake-smart');
  // Only native agents exist, so the tab must stay reachable after the panel closes.
  await page.click('[data-testid="panel-close"]');
  await openAgents();
  await page.waitFor('document.querySelectorAll("[data-testid=native-agent]").length === 2');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.waitFor('innerWidth === 390');
  await capture('native-agents-phone.png');
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  expect(await page.evaluate('(e => e.scrollWidth <= e.clientWidth)(document.querySelector("[data-testid=delegation-surface]"))')).toBe(true);
  await page.reload();
  await mobileAction(page, 'mobile-conversations');
  await unfoldFor('[data-testid="mobile-thread-t-native"]');
  await page.click('[data-testid="mobile-thread-t-native"]');
  await openAgents();
  await page.waitFor('document.querySelectorAll("[data-testid=native-agent]").length === 2');
  expect(page.errors()).toEqual([]);
}, 40_000);

test('running native agents contribute to one count without becoming Boite subagents', async () => {
  // Give refreshes the same agent states as the explicit reads in this test.
  await onStore(`
    const client = store.client;
    const call = client.call;
    let running = 1;
    client.call = async (method, params) => {
      const view = await call.call(client, method, params);
      if (method === "delegation.get" && params.threadId === "t-native") {
        for (const agent of view.nativeAgents.slice(-running)) agent.status = "running";
      }
      return view;
    };
    globalThis.runBothNativeAgents = () => { running = 2; return store.loadDelegation("t-native"); };
    globalThis.restoreNativeAgentFixture = () => {
      client.call = call;
      delete globalThis.runBothNativeAgents;
      delete globalThis.restoreNativeAgentFixture;
    };
    await store.loadDelegation("t-native");
  `);
  try {
    await page.waitFor('document.querySelector("[data-testid=agent-dock]")?.dataset.count === "1"');
    await page.evaluate('globalThis.runBothNativeAgents()');
    await page.waitFor('document.querySelector("[data-testid=agent-dock-label]")?.textContent === "Waiting on 2 subagents"');
    // The tooltip holds both names in full.
    expect(await page.evaluate('document.querySelector("[data-testid=agent-dock-names]").title.split(", ").length')).toBe(2);
    expect(await page.evaluate('document.querySelectorAll("[data-testid=delegation-member]").length')).toBe(0);
  } finally {
    await page.evaluate('globalThis.restoreNativeAgentFixture()');
  }
}, 15_000);

test('a detached CLI agent keeps the waiting line until its own exit on desktop and phone', async () => {
  await page.evaluate('globalThis.__boiteTest.setTheme("dark")');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1310, height: 820, deviceScaleFactor: 1, mobile: false });
  await page.click('[data-testid="panel-close"]');
  await onStore('await store.open("t-cli");');
  await page.waitFor('document.querySelector("[data-testid=agent-dock]")?.dataset.count === "1"');
  expect(await page.text('[data-testid="agent-dock"]')).not.toContain('claude-opus-5-5');
  // Stop never kills a command's own process: the line offers none for it.
  expect(await page.evaluate('!!document.querySelector("[data-testid=agent-dock-stop]")')).toBe(false);
  await capture('cli-agent-dock-desktop.png');
  await openAgents();
  await page.waitFor('!!document.querySelector("[data-testid=process-agents]")');
  await page.click('[data-testid="process-agent"] > summary');
  expect(await page.text('[data-testid="process-agents"]')).toContain('Started from a command');
  expect(await page.text('[data-testid="process-agents"]')).toContain('Working');
  expect(await page.text('[data-testid="process-agents"]')).toContain('xhigh');
  expect(await page.text('[data-testid="process-agents"]')).toContain('claude-opus-5-5');
  expect(await page.evaluate('document.querySelectorAll("[data-testid=native-agent]").length')).toBe(0);
  expect(await page.evaluate('document.querySelectorAll("[data-testid=delegation-member]").length')).toBe(0);
  await capture('cli-agent-desktop.png');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.waitFor('innerWidth === 390');
  await capture('cli-agent-phone.png');
  await onStore('store.delegation.nativeAgents.find(agent => agent.source === "process").model = undefined;');
  await page.waitFor('!document.querySelector("[data-testid=process-agent] .identity small")?.textContent.includes("claude-opus")');
  expect(await page.text('[data-testid="process-agent"] .identity small')).toBe('xhigh');
  await capture('cli-agent-effort-only-phone.png');
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  expect(await page.evaluate('(e => e.scrollWidth <= e.clientWidth)(document.querySelector("[data-testid=delegation-surface]"))')).toBe(true);
  await page.click('[data-testid="panel-close"]');
  await capture('cli-agent-dock-phone.png');
  await onStore('await store.client.call("resources.killTree", { threadId: "t-cli" });');
  await page.waitFor('!document.querySelector("[data-testid=agent-dock]")');
  await openAgents();
  await page.waitFor('document.querySelector("[data-testid=process-agent] [data-status=error]") !== null');
  expect(page.errors()).toEqual([]);
}, 25_000);
