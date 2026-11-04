/**
 * Captures every screen of the app full of the showcase seed, for design
 * reviews: `bun scripts/showcase/capture.ts --out <dir> [--only <name,...>]
 * [--theme dark|light|both] [--device desktop|phone|both]`.
 *
 * Each screen is a named step that navigates through the test bridge's store
 * (`__boiteTest.workspace.active`) or aria labels, waits for fonts and
 * animations, and writes `<device>-<theme>-<name>.png` with its accessibility
 * outline as `.txt`. A failing step prints `FAIL` and the run goes on; the exit
 * code is 1 when any failed. `index.md` and `index.html` list what was taken.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ONBOARDING_STORAGE_KEY, ONBOARDING_VERSION } from '../../packages/ui/src/lib/onboarding';
import { SETTINGS_TABS } from '../../packages/ui/src/lib/settings-tabs';
import { assertHardware, launchBrowser, startServer, waitForMemory } from './server';

type Device = 'desktop' | 'phone';
type Theme = 'dark' | 'light';

interface Step {
  name: string;
  caption: string;
  devices: Device[];
  /** A separate page with these query flags instead of the shared one. */
  query?: string;
  run(page: any): Promise<void>;
}

const args = Bun.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name}: expected a value`);
  return value;
};
const pick = <T extends string>(name: string, values: readonly T[]): T[] => {
  const value = option(name) ?? 'both';
  if (value === 'both') return [...values];
  if (!values.includes(value as T)) throw new Error(`--${name}: expected ${values.join(', ')} or both, got ${value}`);
  return [value as T];
};

const outArg = option('out');
if (!outArg) throw new Error('--out: expected the directory the captures go to');
const out = resolve(outArg);
const only = option('only')?.split(',').map(name => name.trim()).filter(Boolean) ?? null;
const themes = pick<Theme>('theme', ['dark', 'light']);
const devices = pick<Device>('device', ['desktop', 'phone']);

const QUERY = 'fake=1&team=1&agents=1&subagents=1&board=1&debates=1&machines=1';
const FLAGSHIP = 't-trace';
const QUESTION = 't-scheduler';
const EXPERIMENTS = ['resident-agents', 'contacts', 'teams', 'debates', 'pinned-quotas', 'prompt-cache'];
const VIEWPORTS: Record<Device, object> = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

// Page helpers. Steps reach the app through the store, test ids, roles and aria
// labels, never a class name, so a restyle keeps them working.

const store = (page: any, body: string, arg?: unknown) =>
  page.evaluate(new Function('arg', `return (async () => { const s = globalThis.__boiteTest.workspace.active; ${body} })()`) as any, arg);

async function settle(page: any): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const deadline = performance.now() + 2500;
    while (performance.now() < deadline) {
      const running = document.getAnimations().filter(a => a.playState === 'running' && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)));
      if (running.length === 0) break;
      await new Promise(r => setTimeout(r, 100));
    }
  });
  await page.waitForTimeout(250);
}

/**
 * Back to the flagship with nothing open. Escape that reaches the page stops
 * the running turn, which would settle the pending permission: it is pressed
 * only inside an open menu or dialog, which keeps it. An outside press on the
 * body closes popovers. Returns false when the seed's live state is gone.
 */
async function reset(page: any): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    const inside = await page.evaluate(() => {
      const open = [...document.querySelectorAll<HTMLElement>('[role=menu], [role=dialog], [role=listbox]')].find(el => el.getClientRects().length > 0);
      if (!open) return false;
      (open.querySelector<HTMLElement>('button, input, [tabindex]') ?? open).focus();
      return document.activeElement !== document.body && open.contains(document.activeElement);
    });
    if (!inside) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) document.body.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  await page.mouse.move(1, 1);
  const waiting = await store(page, `
    s.paletteOpen = false;
    s.search = '';
    if (s.sidebarCollapsed) s.toggleSidebar();
    s.sidebarOpen = false;
    s.showChat();
    await s.open(arg);
    if (s.terminalShown(arg)) s.hideTerminal(arg);
    s.panel.closeAll();
    document.activeElement?.blur?.();
    return s.threads.find((t) => t.id === arg)?.status === 'waiting';
  `, FLAGSHIP);
  await openThread(page, FLAGSHIP);
  return waiting;
}

async function scrollTimeline(page: any, to: 'top' | 'bottom'): Promise<void> {
  const timeline = page.getByTestId('timeline');
  await timeline.waitFor({ timeout: 10000 });
  // A long thread loads older messages as the top comes into view: scroll until it stops growing.
  for (let i = 0; i < 6; i++) {
    const before = await timeline.evaluate((el: HTMLElement) => el.scrollHeight);
    await timeline.evaluate((el: HTMLElement, top: boolean) => { el.scrollTop = top ? 0 : el.scrollHeight; }, to === 'top');
    await page.waitForTimeout(300);
    if (await timeline.evaluate((el: HTMLElement) => el.scrollHeight) === before) break;
  }
}

/** Opens a thread. A phone left on its list stays there, so the row is tapped then. */
async function openThread(page: any, id: string): Promise<void> {
  await store(page, 'await s.open(arg);', id);
  await page.waitForTimeout(300);
  if (await page.getByTestId('mobile-list').isVisible().catch(() => false)) {
    await page.getByTestId(`mobile-thread-${id}`).click();
    await page.waitForTimeout(500);
  }
}

/** A thread's card in the sidebar: the parent of its row button, which holds the actions button too. */
const row = (page: any, id: string) => page.locator(`[data-testid="thread-row"][data-thread-id="${id}"]`).first().locator('xpath=..');

/** The phone's conversation list, through its bottom bar. */
async function phoneList(page: any): Promise<void> {
  await store(page, 's.showSettings("home");');
  await page.getByTestId('mobile-conversations').click();
  await page.getByTestId('mobile-list').waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
}

async function panel(page: any, body: string, arg?: unknown): Promise<void> {
  await store(page, body, arg);
  await page.waitForTimeout(600);
}

const both: Device[] = ['desktop', 'phone'];
const desktop: Device[] = ['desktop'];
const phone: Device[] = ['phone'];

const steps: Step[] = [
  {
    name: 'home', caption: 'A new thread draft with the whole sidebar (desktop), the thread list (phone).', devices: both,
    async run(page) {
      if (await page.evaluate(() => innerWidth < 600)) {
        await phoneList(page);
      } else {
        await store(page, 's.startDraft("p-boite", { fresh: true });');
      }
    },
  },
  {
    name: 'thread', caption: 'The flagship thread at the top of its conversation: plan, table, tool cards.', devices: both,
    async run(page) { await scrollTimeline(page, 'top'); },
  },
  {
    name: 'thread-end', caption: 'The flagship scrolled to its end: running turn, queued message, permission card, Stop.', devices: both,
    async run(page) { await scrollTimeline(page, 'bottom'); },
  },
  {
    name: 'question', caption: 'A thread asking a question in the question dock.', devices: both,
    async run(page) { await openThread(page, QUESTION); await scrollTimeline(page, 'bottom'); },
  },
  {
    name: 'composer', caption: 'The composer focused with a draft, keyboard space included.', devices: phone,
    async run(page) {
      await openThread(page, 't-sc-export');
      const input = page.getByTestId('composer-input');
      await input.click();
      await input.fill('Also export the tags column, comma separated');
    },
  },
  {
    name: 'menu-model', caption: 'The composer model picker open.', devices: both,
    async run(page) { await page.getByTestId('composer-picker').first().click(); await page.getByTestId('composer-picker-menu').waitFor(); },
  },
  {
    name: 'menu-effort', caption: 'The composer effort menu open.', devices: desktop,
    async run(page) { await page.getByTestId('composer-effort').first().click(); await page.getByTestId('composer-effort-menu').waitFor(); },
  },
  {
    name: 'menu-permissions', caption: 'The composer permission mode menu open.', devices: desktop,
    async run(page) {
      await page.getByRole('button', { name: /permission|Ask|approval/i }).filter({ hasText: /Ask|Auto|Plan|Full/ }).first().click();
      await page.getByRole('menu').or(page.getByRole('listbox')).first().waitFor({ timeout: 5000 });
    },
  },
  {
    name: 'panel-changes', caption: 'Right panel, Changes: the file list and a diff.', devices: both,
    async run(page) { await panel(page, 's.panel.openChanges(arg);', 'src/lib/api/contacts.ts'); await page.getByTestId('diff-view').first().waitFor({ timeout: 10000 }); },
  },
  {
    name: 'panel-files', caption: 'Right panel, Files: the project tree.', devices: desktop,
    async run(page) { await panel(page, 's.panel.openFiles("src/lib");'); },
  },
  {
    name: 'panel-file', caption: 'Right panel, one file open in the editor.', devices: desktop,
    async run(page) { await panel(page, 's.panel.openFile("src/lib/csv/parse.ts", 12);'); },
  },
  {
    name: 'panel-browser', caption: 'Right panel, Browser tab.', devices: desktop,
    async run(page) { await panel(page, 's.panel.open("browser", "https://example.com/");'); },
  },
  {
    name: 'panel-tasks', caption: 'Right panel, Tasks: the thread todo list.', devices: desktop,
    async run(page) { await panel(page, 's.panel.openTasks();'); },
  },
  {
    name: 'panel-subagents', caption: 'Right panel, Subagents: the children this thread started.', devices: desktop,
    async run(page) { await panel(page, 's.panel.open("agents");'); },
  },
  {
    name: 'panel-workflow', caption: 'Right panel, a workflow run and its graph of steps.', devices: desktop,
    async run(page) {
      // The workflow demo runs on one root thread: open that thread, then its run.
      const found = await store(page, `
        for (const t of [arg, ...s.threads.map((t) => t.id)]) {
          const runs = await s.client.call('workflows.list', { threadId: t }).catch(() => []);
          if (runs.length) return { threadId: t, runId: runs[0].id };
        }
        return null;`, FLAGSHIP);
      if (!found) throw new Error('the fake core lists no workflow run');
      await openThread(page, found.threadId);
      await panel(page, 's.panel.openWorkflow(arg);', found.runId);
    },
  },
  {
    name: 'panel-trace', caption: 'Right panel, Trace: the processes of the thread.', devices: desktop,
    async run(page) { await panel(page, 's.panel.open("trace");'); },
  },
  {
    name: 'panel-messages', caption: 'Right panel, Messages between agents.', devices: desktop,
    async run(page) { await panel(page, 's.panel.openMessages();'); },
  },
  {
    name: 'panel-debate', caption: 'Right panel, a debate salon.', devices: desktop,
    async run(page) {
      const ids = await store(page, 'const r = await s.client.call("debates.list", {}); return (r.debates ?? r).map?.((d) => d.id) ?? [];');
      if (!ids?.length) throw new Error('the fake core lists no debate');
      await panel(page, 's.panel.openDebate(arg);', ids[0]);
    },
  },
  {
    name: 'panel-device', caption: 'Right panel, Device: emulators and phones.', devices: desktop,
    async run(page) { await panel(page, 's.panel.open("device");'); },
  },
  {
    name: 'panel-terminal', caption: 'The terminal drawer under the conversation.', devices: desktop,
    async run(page) { await page.getByRole('button', { name: "Terminal in this thread's folder" }).click(); await page.waitForTimeout(1200); },
  },
  {
    name: 'panel-board', caption: 'The project board drawer.', devices: desktop,
    async run(page) { await page.getByRole('button', { name: 'Project board' }).first().click(); await page.waitForTimeout(1000); },
  },
  {
    name: 'palette', caption: 'The command palette.', devices: desktop,
    async run(page) { await store(page, 's.paletteOpen = true;'); await page.getByTestId('palette').waitFor(); },
  },
  {
    name: 'row-menu', caption: 'A thread row actions menu.', devices: both,
    async run(page) {
      if (await page.evaluate(() => innerWidth < 600)) {
        await phoneList(page);
        await page.getByTestId(`mobile-thread-menu-${QUESTION}`).click();
      } else {
        await row(page, QUESTION).hover();
        await row(page, QUESTION).getByRole('button', { name: 'Thread actions' }).click();
      }
      await page.getByRole('menu').first().waitFor({ timeout: 5000 });
    },
  },
  {
    name: 'project-menu', caption: 'A project actions menu.', devices: desktop,
    async run(page) {
      const button = page.getByRole('button', { name: 'Project actions' }).first();
      await button.hover({ force: true });
      await button.click({ force: true });
      await page.getByTestId('project-menu').or(page.getByRole('menu')).first().waitFor({ timeout: 5000 });
    },
  },
  {
    name: 'search', caption: 'The sidebar thread search with a query.', devices: desktop,
    async run(page) {
      await page.getByRole('button', { name: 'Search threads' }).first().click();
      await page.keyboard.type('csv');
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'display-options', caption: 'The sidebar display options popover.', devices: desktop,
    async run(page) { await page.getByRole('button', { name: 'Display options' }).first().click(); await page.waitForTimeout(400); },
  },
  {
    name: 'limits', caption: 'The account limits popover with usage numbers.', devices: desktop,
    async run(page) { await page.getByRole('button', { name: 'Account limits' }).first().click(); await page.waitForTimeout(500); },
  },
  {
    name: 'archive', caption: 'The archived threads list in Settings.', devices: desktop,
    async run(page) {
      await store(page, 's.showSettings("general", "settings-archived");');
      await page.getByTestId('archived-show').click();
      await page.getByTestId('archived-list').waitFor({ timeout: 5000 });
      await page.getByTestId('archived-list').scrollIntoViewIfNeeded();
    },
  },
  {
    name: 'bots', caption: 'The Bots page with its list of persistent agents.', devices: both,
    async run(page) { await store(page, 's.showAgents();'); await page.waitForTimeout(800); },
  },
  {
    name: 'bot-desk', caption: 'One bot opened, its thread and desk.', devices: desktop,
    async run(page) {
      const id = await store(page, 'const list = (await s.client.call("agents.snapshot", { desk: null })).profiles; return (list.find((a) => a.name === "Nova") ?? list[0]).id;');
      await store(page, 's.showAgents(arg);', id);
      await page.waitForTimeout(1000);
    },
  },
  {
    name: 'teams', caption: 'A team chat of three bots on the Bots page.', devices: desktop,
    async run(page) {
      const threadId = await store(page, `
        const listed = await s.client.call('teams.list', {});
        let team = (listed.teams ?? []).find((t) => t.name === 'Release crew');
        if (!team) {
          team = await s.client.call('teams.create', { name: 'Release crew', brief: 'Ship 2.1: the CSV import, the sync retries and the release notes.', members: ['Nova', 'Iris', 'Mira'] });
          await s.client.call('teams.post', { teamId: team.id, id: 'showcase-1', text: 'Morning all. @Nova where are the release notes? @Iris is staging green after the retry change?' });
          await s.client.call('teams.post', { teamId: team.id, id: 'showcase-2', text: '@Mira collect the two screenshots for the changelog when the import page lands.' });
        }
        return team.threadId;`);
      await openThread(page, threadId);
      await page.waitForTimeout(800);
    },
  },
  {
    name: 'contacts', caption: 'The Contacts page on one contact.', devices: desktop,
    async run(page) { await store(page, 's.showHome("core-chris");'); await page.waitForTimeout(800); },
  },
  {
    name: 'sidebar-collapsed', caption: 'The sidebar hidden, the conversation full width.', devices: desktop,
    async run(page) { await store(page, 'if (!s.sidebarCollapsed) s.toggleSidebar();'); await page.waitForTimeout(500); },
  },
  {
    name: 'toast', caption: 'The undo toast after archiving a thread.', devices: desktop,
    async run(page) {
      await page.evaluate(async (id: string) => {
        // The app's own module, served by the dev server: the same instance the sidebar uses.
        const archive = '/src/lib/archive.ts';
        const { archiveThread } = await import(/* @vite-ignore */ archive);
        await archiveThread((globalThis as any).__boiteTest.workspace.active, id);
      }, 't-sc-links');
      await page.getByTestId('undo-toast').waitFor({ timeout: 5000 });
    },
  },
  ...SETTINGS_TABS.map((tab): Step => ({
    name: `settings-${tab}`, caption: `Settings, the ${tab} page.`, devices: desktop,
    async run(page) { await store(page, 's.showSettings(arg);', tab); await page.waitForTimeout(700); },
  })),
  {
    name: 'settings', caption: 'Settings on a phone.', devices: phone,
    async run(page) { await store(page, 's.showSettings("home");'); await page.waitForTimeout(700); },
  },
  {
    name: 'first-run', caption: 'First run: no provider and no project yet.', devices: desktop, query: 'fake=1&uninstalled=1',
    async run(page) { await dismissBanners(page); },
  },
];

// After a step that changed data, put it back so the next one starts from the seed.
const CLEANUP: Record<string, (page: any) => Promise<void>> = {
  toast: async (page) => { await page.getByTestId('undo-action').click().catch(() => {}); await page.waitForTimeout(300); },
};

interface Shot { file: string; caption: string; device: Device; theme: Theme }

async function newPage(browser: any, base: string, device: Device, theme: Theme, query: string): Promise<{ context: any; page: any }> {
  const context = await browser.newContext({ ...VIEWPORTS[device], locale: 'en-US', colorScheme: theme, reducedMotion: 'no-preference' });
  await context.addInitScript(({ key, version, theme, experiments }: any) => {
    localStorage.setItem('boite.theme', theme);
    localStorage.setItem('boite.locale', 'en');
    localStorage.setItem('boite:right-panel-width', '560');
    localStorage.setItem('boite.experiments', JSON.stringify(experiments));
    localStorage.setItem('boite.experiments.follow', 'off');
    localStorage.setItem(key, JSON.stringify({ version, at: 0 }));
  }, { key: ONBOARDING_STORAGE_KEY, version: ONBOARDING_VERSION, theme, experiments: EXPERIMENTS });
  const page = await context.newPage();
  page.on('pageerror', (error: Error) => console.log(`  pageerror ${error.message.split('\n')[0]}`));
  await page.goto(`${base}/?${query}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => (globalThis as any).__boiteTest?.workspace.active.booted, null, { timeout: 120000 });
  return { context, page };
}

/** The contact request banner would cover the top of every screen. */
async function dismissBanners(page: any): Promise<void> {
  await page.waitForTimeout(500);
  for (let i = 0; i < 3; i++) {
    const dismiss = page.getByRole('status').getByRole('button', { name: 'Dismiss' }).first();
    if (!await dismiss.isVisible().catch(() => false)) break;
    await dismiss.click();
    await page.waitForTimeout(300);
  }
}

/** The shared page once the second machine and the seed are in. */
async function prepare(page: any): Promise<void> {
  await page.waitForFunction(() => (globalThis as any).__boiteTest.workspace.active.threads.length > 30, null, { timeout: 30000 });
  await store(page, `
    if (!s.isCollapsed('p-garden')) s.toggleProject('p-garden');
  `);
  await dismissBanners(page);
  // The queued message: typed while the flagship's turn waits on its permission.
  await store(page, 'await s.open(arg);', FLAGSHIP);
  const input = page.getByTestId('composer-input');
  await input.waitFor({ timeout: 10000 });
  await input.click();
  await input.fill('Then add a test for a file with a BOM at the start');
  // A touch screen's Enter is a new line: the send button queues it there.
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await page.getByTestId('composer-send').first().tap();
  else await page.keyboard.press('Enter');
  await page.getByTestId('composer-queued').first().waitFor({ timeout: 5000 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

async function snapshot(page: any, path: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: `${path}.png`, animations: 'disabled', caret: 'hide' });
  const outline = await page.locator('body').ariaSnapshot({ timeout: 10000 }).catch((error: Error) => `(no outline: ${error.message.split('\n')[0]})`);
  writeFileSync(`${path}.txt`, outline.split('\n').filter((line: string) => line.trim()).join('\n') + '\n');
}

const shots: Shot[] = [];
const failures: string[] = [];

mkdirSync(out, { recursive: true });
await waitForMemory(3.5e9);
const rig = await startServer();
let browser: any;
try {
  browser = await launchBrowser('/usr/bin/google-chrome');
  for (const device of devices) {
    for (const theme of themes) {
      const wanted = steps.filter(step => step.devices.includes(device) && (!only || only.includes(step.name)));
      if (wanted.length === 0) continue;
      console.log(`${device} ${theme}: ${wanted.length} screens`);
      let shared: { context: any; page: any } | null = null;
      const sharedPage = async () => {
        if (!shared) {
          shared = await newPage(browser, rig.base, device, theme, QUERY);
          console.log(`  renderer ${await assertHardware(shared.page)}`);
          await prepare(shared.page);
        }
        return shared.page;
      };
      for (const step of wanted) {
        const file = `${device}-${theme}-${step.name}`;
        let own: { context: any; page: any } | null = null;
        try {
          let page: any;
          if (step.query) {
            own = await newPage(browser, rig.base, device, theme, step.query);
            page = own.page;
          } else {
            page = await sharedPage();
            if (!await reset(page)) {
              console.log(`  the flagship turn ended before ${step.name}: reloading the seed`);
              await (shared as any).context.close();
              shared = null;
              page = await sharedPage();
              if (!await reset(page)) throw new Error('the flagship turn is not waiting on its permission after a fresh boot');
            }
            await page.waitForTimeout(300);
          }
          await step.run(page);
          await snapshot(page, join(out, file));
          shots.push({ file: `${file}.png`, caption: step.caption, device, theme });
          console.log(`  ok ${step.name}`);
          await CLEANUP[step.name]?.(page);
        } catch (error) {
          const reason = (error as Error).message.split('\n')[0];
          failures.push(`FAIL ${file}: ${reason}`);
          console.log(`FAIL ${file}: ${reason}`);
          // A broken page does not get to spoil the next step.
          if (!step.query && shared) { await (shared as any).context.close().catch(() => {}); shared = null; }
        } finally {
          await own?.context.close().catch(() => {});
        }
      }
      if (shared) await (shared as any).context.close();
    }
  }
} finally {
  await browser?.close().catch(() => {});
  await rig.close();
}

const groups = new Map<string, Shot[]>();
for (const shot of shots) {
  const key = `${shot.device} ${shot.theme}`;
  groups.set(key, [...(groups.get(key) ?? []), shot]);
}
const md = ['# Showcase captures', '', `Command: \`bun scripts/showcase/capture.ts --out ${outArg}${only ? ` --only ${only.join(',')}` : ''}\``, ''];
for (const [key, list] of groups) {
  md.push(`## ${key}`, '');
  for (const shot of list) md.push(`- \`${shot.file}\`: ${shot.caption}`);
  md.push('');
}
if (failures.length) md.push('## Failures', '', ...failures.map(line => `- ${line}`), '');
writeFileSync(join(out, 'index.md'), md.join('\n'));

const escape = (text: string) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Showcase captures</title>
<style>
body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; background: Canvas; color: CanvasText; color-scheme: light dark; }
h2 { margin-top: 32px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
figure { margin: 0; border: 1px solid GrayText; border-radius: 8px; overflow: hidden; }
figure img { width: 100%; display: block; }
figcaption { padding: 8px; }
figcaption code { display: block; opacity: .7; font-size: 12px; }
</style></head><body><h1>Showcase captures</h1>
${[...groups].map(([key, list]) => `<h2>${escape(key)}</h2><div class="grid">${list.map(shot =>
  `<figure><a href="${shot.file}"><img loading="lazy" src="${shot.file}" alt="${escape(shot.caption)}"></a><figcaption><code>${shot.file}</code>${escape(shot.caption)}</figcaption></figure>`).join('')}</div>`).join('\n')}
${failures.length ? `<h2>Failures</h2><ul>${failures.map(line => `<li>${escape(line)}</li>`).join('')}</ul>` : ''}
</body></html>\n`;
writeFileSync(join(out, 'index.html'), html);

console.log(`${shots.length} captures, ${failures.length} fails`);
process.exit(failures.length ? 1 : 0);
