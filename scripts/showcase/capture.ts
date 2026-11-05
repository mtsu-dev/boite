/**
 * Captures every screen of the app full of the showcase seed, for design
 * reviews: `bun scripts/showcase/capture.ts --out <dir> [--only <name,...>]
 * [--theme dark|light|both] [--device desktop|phone|both] [--lang en|fr|both]
 * [--narrow] [--contrast] [--solid] [--view projects|recent] [--seed calm|stress]`.
 *
 * Each screen is a named step that navigates through the test bridge's store
 * (`__boiteTest.workspace.active`) or aria labels, waits for fonts and
 * animations, and writes `<device>-<theme>-<name>.png` with its accessibility
 * outline as `.txt`. Steps always run in English, since they find controls by
 * their English names; `--lang fr` switches the app to French just before each
 * snapshot (`<device>-<theme>-fr-<name>.png`) and back after. `--narrow` takes
 * the phone at 360x800 (`phone360-...`). `--contrast` also writes
 * `<file>.contrast.txt`: every text run under WCAG AA on the pixels behind it
 * (`contrast.ts`). Every screen gets `<file>.clip.txt` when a box cuts the
 * descenders off a label (`clipping.ts`). `--solid` switches the glass off (`<device>-<theme>-solid-...`).
 * `--view recent` opens the sidebar on its Recent list, one list across
 * projects, instead of project cards (`<device>-<theme>-recent-...`).
 * `--seed` picks the data: `calm` (the default, `?calm=1`) is one person's
 * normal day, three projects, two asks and one failed thread; `stress` is
 * the full seed, eight projects and about eight asks, for tests. A step marked
 * `stress` keeps the full seed under `calm`. File names do not change.
 * A failing step prints `FAIL` and the run goes on; the exit
 * code is 1 when any failed. `index.md` and `index.html` list what was taken.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ONBOARDING_STORAGE_KEY, ONBOARDING_VERSION } from '../../packages/ui/src/lib/onboarding';
import { SETTINGS_TABS } from '../../packages/ui/src/lib/settings-tabs';
import { auditClipping, auditTruncation, formatClipping, formatTruncation } from './clipping';
import { auditTouch, formatTouch } from './touch';
import { auditContrast, formatContrast } from './contrast';
import { assertHardware, launchBrowser, startServer, waitForMemory } from './server';

type Device = 'desktop' | 'phone';
type Theme = 'dark' | 'light';

interface Step {
  name: string;
  caption: string;
  devices: Device[];
  /** A separate page with these query flags instead of the shared one. */
  query?: string;
  /**
   * The step changes the seed in a way its cleanup cannot take back, so the
   * next step gets a fresh shared page. An archive stops its turn, as the core
   * does, and Undo brings the thread back without its pending permission.
   */
  spoils?: boolean;
  /** The screen needs a long list (a scroll, a third row): it takes the stress seed whatever `--seed` says. */
  stress?: boolean;
  /** The screen opens a project card's own control, which the Recent list does not draw. */
  projects?: boolean;
  /** The step writes text at the moment it runs (a toast): a one-language run plays it in that language. */
  speaks?: boolean;
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
const langArg = option('lang') ?? 'en';
if (!['en', 'fr', 'both'].includes(langArg)) throw new Error(`--lang: expected en, fr or both, got ${langArg}`);
const langs = langArg === 'both' ? ['en', 'fr'] : [langArg];
const narrow = args.includes('--narrow');
const contrast = args.includes('--contrast');
const solid = args.includes('--solid');
const view = option('view') ?? 'projects';
if (!['projects', 'recent'].includes(view)) throw new Error(`--view: expected projects or recent, got ${view}`);
const recent = view === 'recent';
const seed = option('seed') ?? 'calm';
if (!['calm', 'stress'].includes(seed)) throw new Error(`--seed: expected calm or stress, got ${seed}`);

const QUERY = 'fake=1&team=1&agents=1&subagents=1&board=1&debates=1&machines=1';
const FLAGSHIP = 't-trace';
const QUESTION = 't-scheduler';
const WORKING = 't-sc-ratelimit';
/** Threads both seeds keep: a failed one with a plain composer, an idle one with an open PR, one to archive. */
const FAILED = 't-sc-camera';
const FINISHED = 't-sc-push';
const ARCHIVABLE = 't-sc-paginate';
/** A page query with the seed's flag: `calm=1` unless the run or the step wants the stress seed. */
const seeded = (query: string, step?: Step) => seed === 'calm' && !step?.stress ? `${query}&calm=1` : query;
const EXPERIMENTS = ['resident-agents', 'contacts', 'teams', 'debates', 'pinned-quotas', 'prompt-cache'];
const VIEWPORTS: Record<Device, object> = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: narrow
    ? { viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const devicePrefix = (device: Device) => device === 'phone' && narrow ? 'phone360' : device;
const themePrefix = (theme: Theme) => `${theme}${solid ? '-solid' : ''}${recent ? '-recent' : ''}`;

/** Swaps the app's language in place through its own module, the one the dev server already loaded. */
async function speak(page: any, lang: string): Promise<void> {
  await page.evaluate(async (lang: string) => {
    const i18n = await import(/* @vite-ignore */ '/src/lib/i18n.svelte.ts');
    await i18n.setLocaleSetting(lang);
  }, lang);
  await page.waitForTimeout(250);
}

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
    // The lifecycle filter lasts the session: one pressed button clears it for desktop and phone alike.
    document.querySelector<HTMLButtonElement>('[data-testid$="lifecycle"] [aria-pressed="true"]')?.click();
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

/** A new thread draft on another provider, its first model picked through the picker as a user does. */
async function pickProvider(page: any, providerId: string): Promise<void> {
  await store(page, 's.startDraft("p-boite", { fresh: true });');
  await page.waitForTimeout(400);
  await page.getByTestId('composer-picker').first().click();
  const menu = page.getByTestId('composer-picker-menu');
  await menu.waitFor({ timeout: 5000 });
  await menu.locator(`[data-provider="${providerId}"]`).click();
  await menu.locator('button.row.model:not([disabled])').first().click();
  await menu.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
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

/** B1: how many project headers the first 1440x900 screen shows whole. */
async function logHeaders(page: any, seed: string): Promise<void> {
  const headers = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('[data-testid=sidebar] section[data-testid=project]')];
    const scroll = document.querySelector<HTMLElement>('[data-testid=sidebar] .scroll')!.getBoundingClientRect();
    const shown = cards.filter(card => { const head = card.querySelector<HTMLElement>('[data-testid=project-row]')!.getBoundingClientRect(); return head.top >= scroll.top && head.bottom <= scroll.bottom; });
    return `${shown.length} of ${cards.length}`;
  });
  console.log(`  B1 project headers on the first screen (${seed}): ${headers}`);
}

/** C2: where the first phone row starts, how many rows show whole above the tab bar, and each row's height. */
async function logPhoneDensity(page: any): Promise<void> {
  const facts = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('[data-testid=mobile-tabs]')?.getBoundingClientRect().top ?? innerHeight;
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid=mobile-list] [data-testid=mobile-row]')].map(row => row.getBoundingClientRect());
    const whole = rows.filter(box => box.top >= 0 && box.bottom <= bar);
    const strip = document.querySelector<HTMLElement>('[data-testid=mobile-lifecycle]')?.getBoundingClientRect().height ?? 0;
    const head = document.querySelector<HTMLElement>('[data-testid=mobile-list] .project-heading')?.getBoundingClientRect().height ?? 0;
    const cut = [...document.querySelectorAll<HTMLElement>('[data-testid=mobile-tabs] .name')].filter(name => name.scrollWidth > name.clientWidth).map(name => name.textContent);
    return `tab labels cut: ${cut.length ? cut.join(', ') : 'none'}; first row top ${Math.round(rows[0]?.top ?? -1)} px, ${whole.length} rows whole above ${Math.round(bar)} px, strip ${Math.round(strip)} px, header ${Math.round(head)} px, rows ${whole.map(box => Math.round(box.height)).join('/')}`;
  });
  console.log(`  C2 phone density: ${facts}`);
}

const steps: Step[] = [
  {
    name: 'home', caption: 'A new thread draft with the whole sidebar (desktop), the thread list (phone).', devices: both,
    async run(page) {
      if (await page.evaluate(() => innerWidth < 600)) {
        await phoneList(page);
        await logPhoneDensity(page);
      } else {
        await store(page, 's.startDraft("p-boite", { fresh: true });');
        await page.waitForTimeout(600);
        await logHeaders(page, 'seed');
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
    name: 'working-question', caption: 'A question asked while the turn runs: the strip says Working, then question for you.', devices: both,
    async run(page) {
      // A running turn with no permission card: the flagship's would make it Waiting for you.
      await openThread(page, WORKING);
      await store(page, `
        const thread = s.threads.find((t) => t.id === arg);
        s.pendingQuestions = [...s.pendingQuestions, { id: 'q-showcase-working', threadId: arg, turnId: thread?.activeTurnId ?? 'turn-showcase', text: 'Keep the old trace format readable for a release?', options: [{ id: 'keep', label: 'Keep it one release' }, { id: 'drop', label: 'Drop it now' }], allowText: true, multiple: false, async: true, createdAt: Date.now() - 4 * 60_000 }];
      `, WORKING);
      await scrollTimeline(page, 'bottom');
    },
  },
  {
    name: 'questions-several', caption: 'Two questions waiting on one thread: the dock takes them one at a time and says how many are left.', devices: both,
    async run(page) {
      await openThread(page, QUESTION);
      await store(page, `
        const thread = s.threads.find((t) => t.id === arg);
        s.pendingQuestions = [...s.pendingQuestions, { id: 'q-showcase-second', threadId: arg, turnId: thread?.activeTurnId ?? 'turn-showcase', text: 'Should the retry wait grow after each failure?', options: [{ id: 'grow', label: 'Double it each time' }, { id: 'flat', label: 'Keep 30 s' }], allowText: true, multiple: false, createdAt: Date.now() - 60_000 }];
      `, QUESTION);
      await scrollTimeline(page, 'bottom');
    },
  },
  {
    name: 'draft-kept', caption: 'A two-line draft typed, then the model menu, the effort menu and the changes panel opened and closed: the draft is still there (the log compares it).', devices: both,
    async run(page) {
      await openThread(page, FAILED);
      const input = page.getByTestId('composer-input');
      await input.click();
      const draft = 'Also try it on the Pixel 8\nthen on a tablet in landscape';
      await input.fill(draft);
      const phone = await page.evaluate(() => innerWidth < 600);
      for (const [trigger, menu] of [['composer-picker', 'composer-picker-menu'], ['composer-effort', 'composer-effort-menu']]) {
        const button = page.getByTestId(trigger).first();
        if (!await button.isVisible().catch(() => false)) continue;
        await button.click();
        await page.getByTestId(menu).waitFor({ timeout: 5000 });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      await panel(page, 's.panel.openChanges(arg);', 'src/lib/api/contacts.ts');
      await page.getByTestId('diff-view').first().waitFor({ timeout: 10000 });
      if (phone) await page.goBack();
      else await store(page, 's.panel.hide();');
      await page.waitForTimeout(700);
      const kept = await page.getByTestId('composer-input').inputValue().catch(() => '(no composer)');
      console.log(`  draft-kept: ${JSON.stringify(draft)} before, ${JSON.stringify(kept)} after: ${kept === draft ? 'kept' : 'LOST'}`);
      if (kept !== draft) throw new Error('draft-kept: the draft changed');
    },
  },
  {
    name: 'next', caption: 'Next needs you clicked from a waiting thread: the next one opens, its count one lower.', devices: both,
    async run(page) {
      await openThread(page, QUESTION);
      await page.getByTestId('status-strip-next').first().click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'next-back', caption: 'After Next needs you, the phone Back: where it lands.', devices: phone,
    async run(page) {
      await openThread(page, QUESTION);
      await page.getByTestId('status-strip-next').first().click();
      await page.waitForTimeout(600);
      await page.goBack();
      await page.waitForTimeout(800);
    },
  },
  {
    name: 'phone-keyboard', caption: 'The phone with the keyboard open: the composer and the strip in the 508 px left above it.', devices: phone,
    async run(page) {
      await openThread(page, FAILED);
      await page.setViewportSize({ width: page.viewportSize().width, height: 508 });
      const input = page.getByTestId('composer-input');
      await input.click();
      await input.fill('Also try it on the Pixel 8');
      await page.waitForTimeout(400);
      // A desktop browser has no keyboard to shrink its visual viewport: say it is open, as viewport.ts does on a phone.
      await page.evaluate(() => { document.documentElement.dataset.keyboard = 'open'; });
      await scrollTimeline(page, 'bottom');
    },
  },
  {
    name: 'composer', caption: 'The composer focused with a draft, keyboard space included.', devices: phone,
    async run(page) {
      await openThread(page, FAILED);
      const input = page.getByTestId('composer-input');
      await input.click();
      await input.fill('Also try it on the Pixel 8, then on a tablet');
    },
  },
  {
    name: 'menu-model', caption: 'The composer model picker open.', devices: both,
    async run(page) { await page.getByTestId('composer-picker').first().click(); await page.getByTestId('composer-picker-menu').waitFor(); },
  },
  {
    name: 'menu-thread', caption: 'The phone title menu: project, machine, branch and PR whole, one tap copies each.', devices: phone,
    async run(page) { await page.getByTestId('thread-menu-trigger').first().click(); await page.getByTestId('thread-menu-trigger-menu').waitFor(); },
  },
  {
    name: 'menu-effort', caption: 'The composer effort menu open.', devices: desktop,
    async run(page) { await page.getByTestId('composer-effort').first().click(); await page.getByTestId('composer-effort-menu').waitFor(); },
  },
  {
    name: 'menu-permissions', caption: 'The composer permission mode menu open.', devices: desktop,
    async run(page) {
      await page.getByTestId('composer-mode').first().click();
      await page.getByTestId('composer-mode-menu').waitFor({ timeout: 5000 });
    },
  },
  {
    name: 'provider-pi', caption: 'A new thread on pi, which asks no approvals: the composer drops the permission chip and keeps the rest.', devices: desktop,
    async run(page) { await pickProvider(page, 'pi'); },
  },
  {
    name: 'provider-acp', caption: 'A new thread on OpenCode, an ACP agent: a model it reported when probed, and the effort levels that model offers.', devices: desktop,
    async run(page) {
      await pickProvider(page, 'opencode');
      await page.getByTestId('composer-effort').first().click();
      await page.getByTestId('composer-effort-menu').waitFor({ timeout: 5000 });
    },
  },
  {
    name: 'provider-muse', caption: 'A new thread on Muse Code: its effort slider has five stops, Extra high and Max past High.', devices: desktop,
    async run(page) {
      await pickProvider(page, 'muse');
      await page.getByTestId('composer-effort').first().click();
      await page.getByTestId('composer-effort-menu').waitFor({ timeout: 5000 });
    },
  },
  {
    name: 'provider-codex', caption: 'A new thread on Codex: three permission modes instead of four, the default named This folder, since Codex already auto-approves edits there.', devices: desktop,
    async run(page) {
      await pickProvider(page, 'codex');
      await page.getByTestId('composer-mode').first().click();
      await page.getByTestId('composer-mode-menu').waitFor({ timeout: 5000 });
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
    name: 'panel-terminal', caption: 'The terminal drawer under the conversation, opened from the panel list with the panel closed.', devices: desktop,
    // The drawers open from the title bar's panel list (or More), the panel closed or not.
    async run(page) { await openThread(page, FLAGSHIP); await store(page, 's.panel.closeAll();'); await page.getByTestId('panel-list').click(); await page.locator('[data-testid=panel-list-menu] [data-value=terminal]').click(); await page.waitForTimeout(1200); },
  },
  {
    name: 'panel-board', caption: 'The project board drawer, 30 % of the chat height.', devices: desktop,
    async run(page) { await panel(page, 's.panel.openTasks();'); await page.getByTestId('panel-list').click(); await page.locator('[data-testid=panel-list-menu] [data-value=board]').click(); await page.waitForTimeout(1000); },
  },
  {
    name: 'panel-launcher', caption: 'The title bar panel list: every surface by name with its count, the panel closed.', devices: desktop,
    async run(page) { await openThread(page, FLAGSHIP); await store(page, 's.panel.closeAll();'); await page.getByTestId('panel-list').click(); await page.getByTestId('panel-list-menu').waitFor({ timeout: 5000 }); await page.waitForTimeout(300); },
  },
  {
    name: 'panel-more', caption: 'The right panel More menu: Terminal and Board first, then the rarer surfaces.', devices: desktop,
    async run(page) { await panel(page, 's.panel.openChanges();'); await page.getByTestId('panel-add').click(); await page.getByTestId('panel-add-menu').waitFor({ timeout: 5000 }); await page.waitForTimeout(300); },
  },
  {
    name: 'thread-finished', caption: 'A finished thread: the status strip with Mark done and Archive, the title bar context pill.', devices: both,
    async run(page) { await openThread(page, FINISHED); await scrollTimeline(page, 'bottom'); },
  },
  {
    name: 'notice', caption: 'A merged thread whose worktree was removed: the one-line notice banner above the composer.', devices: both,
    async run(page) {
      await openThread(page, 't-sc-openapi');
      await store(page, 's.openThread.worktreeRemoved = { path: "/home/boite/projects/boite/.boite/worktrees/wt-openapi", branch: "atlas/openapi", branchDeleted: true, reason: "pr-merged" }; if (s.boardShown) s.toggleBoard();');
      await scrollTimeline(page, 'bottom');
    },
  },
  {
    name: 'phone-thread', caption: 'The phone thread screen: back, title, project · branch · PR, one panel button.', devices: phone,
    async run(page) { await openThread(page, 't-sc-ratelimit'); await scrollTimeline(page, 'bottom'); },
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
        // No menu button on a phone row: a long press opens its sheet, through the row's contextmenu.
        await page.locator(`[data-testid="mobile-row"][data-thread-id="${QUESTION}"] .body`).first().dispatchEvent('contextmenu');
      } else {
        await row(page, QUESTION).hover();
        await row(page, QUESTION).getByRole('button', { name: 'Thread actions' }).click();
      }
      await page.getByRole('menu').first().waitFor({ timeout: 5000 });
    },
  },
  {
    name: 'project-menu', caption: 'A project actions menu.', devices: desktop, projects: true,
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
  ...(['waiting', 'archived'] as const).map((kind): Step => ({
    name: kind === 'waiting' ? 'filter-needs-you' : 'filter-archived',
    caption: `The lifecycle strip filtered to ${kind === 'waiting' ? 'Needs you' : 'Archived'}: matching threads under their project headers.`, devices: both,
    async run(page) {
      const phone = await page.evaluate(() => innerWidth < 600);
      if (phone) await phoneList(page);
      await page.getByTestId(`${phone ? 'mobile-' : ''}lifecycle-${kind}`).first().click();
      await page.waitForTimeout(600);
    },
  })),
  {
    name: 'limits', caption: 'The account limits popover with usage numbers.', devices: desktop,
    async run(page) { await page.getByRole('button', { name: 'Account limits' }).first().click(); await page.waitForTimeout(500); },
  },
  {
    name: 'archive', caption: 'Settings > General leads archived threads to the thread list, under its Archived filter.', devices: both,
    async run(page) {
      await store(page, 's.showSettings("general", "archived");');
      await page.waitForTimeout(500);
      // A phone lands on Settings' home: its Archived row opens the list's filter in one tap.
      if (await page.getByTestId('mobile-settings-archived').isVisible().catch(() => false)) await page.getByTestId('mobile-settings-archived').click();
      else await page.getByTestId('archived-show-list').click();
      await page.waitForTimeout(700);
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
    name: 'toast', caption: 'The undo toast after archiving a thread.', devices: both, speaks: true,
    async run(page) {
      await page.evaluate(async (id: string) => {
        // The app's own module, served by the dev server: the same instance the sidebar uses.
        const archive = '/src/lib/archive.ts';
        const { archiveThread } = await import(/* @vite-ignore */ archive);
        await archiveThread((globalThis as any).__boiteTest.workspace.active, id);
      }, ARCHIVABLE);
      await page.getByTestId('undo-toast').waitFor({ timeout: 5000 });
    },
  },
  ...SETTINGS_TABS.map((tab): Step => ({
    name: `settings-${tab}`, caption: `Settings, the ${tab} page.`, devices: desktop,
    async run(page) { await store(page, 's.showSettings(arg);', tab); await page.waitForTimeout(700); },
  })),
  {
    name: 'settings-field-error', caption: 'Settings, General: a value out of range in the done retention field, its error under it and Save held.', devices: desktop,
    async run(page) {
      await store(page, 's.showSettings("general");');
      await page.waitForTimeout(700);
      const field = page.getByTestId('done-retention-days');
      await field.scrollIntoViewIfNeeded();
      await field.fill('5000');
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'settings-field-saved', caption: 'Settings, General: a new done retention saved, the field marked as stored.', devices: desktop, spoils: true,
    async run(page) {
      await store(page, 's.showSettings("general");');
      await page.waitForTimeout(700);
      const field = page.getByTestId('done-retention-days');
      await field.scrollIntoViewIfNeeded();
      await field.fill('45');
      await page.getByTestId('done-retention-save').click();
      await page.waitForTimeout(900);
    },
  },
  {
    name: 'settings-grouped', caption: 'A grouped Settings entry: Usage and limits, its pages as tabs at the top of the card.', devices: desktop,
    async run(page) { await store(page, 's.showSettings("limits");'); await page.waitForTimeout(700); },
  },
  {
    name: 'settings-search', caption: 'Settings search on a phone: a word finds its section.', devices: phone,
    async run(page) { await store(page, 's.showSettings("home");'); await page.waitForTimeout(500); await page.getByTestId('settings-search').fill('theme'); await page.waitForTimeout(500); },
  },
  {
    name: 'settings-appearance', caption: 'Appearance: the swatch grid and the line saying what applies to this device and what to the machine.', devices: both,
    async run(page) { await store(page, 's.showSettings("appearance");'); await page.waitForTimeout(700); },
  },
  {
    name: 'settings-advanced', caption: 'Advanced: the core card keeps its version in view, the developer detail opened under Show details.', devices: desktop,
    async run(page) { await store(page, 's.showSettings("advanced");'); await page.waitForTimeout(600); await page.getByTestId('core-details-toggle').click(); await page.waitForTimeout(400); },
  },
  {
    name: 'settings-machines', caption: 'Machines: phone access linked from the page that lists the machines.', devices: both,
    async run(page) { await store(page, 's.showSettings("machines");'); await page.waitForTimeout(700); },
  },
  {
    name: 'settings', caption: 'Settings on a phone.', devices: phone,
    async run(page) { await store(page, 's.showSettings("home");'); await page.waitForTimeout(700); },
  },
  {
    name: 'first-run', caption: 'First run: no provider and no project yet.', devices: both, query: 'fake=1&uninstalled=1',
    async run(page) { await dismissBanners(page); await page.waitForTimeout(400); },
  },
  {
    name: 'inbox', caption: 'The home Inbox: threads that need you, then the ones at work unfolded (desktop); the phone Inbox tab.', devices: both,
    async run(page) {
      if (await page.evaluate(() => innerWidth < 600)) {
        await phoneList(page);
        await page.getByTestId('mobile-activity').click();
        await page.waitForTimeout(500);
      } else {
        await store(page, 's.startDraft("p-boite", { fresh: true });');
        await page.getByTestId('inbox').waitFor({ timeout: 5000 });
        // The home shows the contact requests (the `home` screen); this one is the lists, with the work unfolded.
        const dismiss = page.getByTestId('contact-request-dismiss');
        for (let round = 0; round < 4 && await dismiss.count(); round++) { await dismiss.dispatchEvent('click'); await page.waitForTimeout(350); }
        const fold = page.getByTestId('inbox-working-toggle');
        if (await fold.count() && await fold.getAttribute('aria-expanded') === 'false') await fold.dispatchEvent('click');
        // Scrolled to its end: the rows at work in view, the asks fading under the composer.
        await page.getByTestId('inbox').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(400);
      }
    },
  },
  {
    name: 'inbox-empty', caption: 'The home Inbox with nothing waiting: the quiet line on the sky, the work still listed.', devices: both, query: QUERY,
    // Its own page: what it answers in place would leave the next screens with nothing waiting.
    async run(page) {
      // Answer everything in place: nothing asks, nothing failed unread.
      await store(page, `
        for (const m of globalThis.__boiteTest.workspace.machines.length ? globalThis.__boiteTest.workspace.machines.map((m) => m.store) : [s]) {
          m.threads = m.threads.map((t) => ({ ...t, status: t.status === 'waiting' || t.status === 'error' ? 'idle' : t.status, openQuestions: 0, subagentQuestions: [], unread: false }));
          m.pendingQuestions = []; m.pendingPermissions = [];
        }`);
      if (await page.evaluate(() => innerWidth < 600)) {
        await phoneList(page);
        await page.getByTestId('mobile-activity').click();
        await page.waitForTimeout(500);
      } else {
        await store(page, 's.startDraft("p-boite", { fresh: true });');
        await page.getByTestId('inbox-empty').waitFor({ timeout: 5000 });
        await page.waitForTimeout(400);
      }
    },
  },
  {
    name: 'dense', caption: 'The sidebar on about sixty threads over nine projects on three machines (`?dense=1&machines=2`): the lanes fold, the headers fit the first screen.', devices: both, query: `${QUERY.replace('machines=1', 'machines=2')}&dense=1`, stress: true,
    async run(page) {
      await dismissBanners(page);
      if (await page.evaluate(() => innerWidth < 600)) { await phoneList(page); return; }
      await store(page, 's.startDraft("p-boite", { fresh: true });');
      await page.waitForTimeout(600);
      await logHeaders(page, 'dense');
    },
  },
  {
    name: 'filter-needs-you', caption: 'The Needs you filter: the projects with an ask, each under its header.', devices: both,
    async run(page) {
      if (await page.evaluate(() => innerWidth < 600)) await phoneList(page);
      else await store(page, 's.startDraft("p-boite", { fresh: true });');
      await page.locator('[data-testid$="lifecycle-waiting"]:visible').first().click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'filter-archived', caption: 'The Archived filter: each row with Restore and Delete.', devices: both,
    async run(page) {
      if (await page.evaluate(() => innerWidth < 600)) await phoneList(page);
      else await store(page, 's.startDraft("p-boite", { fresh: true });');
      await page.locator('[data-testid$="lifecycle-archived"]:visible').first().click();
      await page.waitForTimeout(800);
    },
  },
  {
    name: 'phone-swipe-undo', caption: 'A row slid left: archived, with the Undo toast.', devices: phone,
    spoils: true, speaks: true,
    async run(page) {
      await phoneList(page);
      const ok = await page.evaluate(async () => {
        const body = [...document.querySelectorAll<HTMLElement>('[data-testid=mobile-row] .body')].find(el => { const box = el.getBoundingClientRect(); return box.top > 200 && box.bottom < innerHeight - 120; });
        if (!body) return false;
        const box = body.getBoundingClientRect();
        const y = box.top + box.height / 2;
        const fire = (type: string, x: number) => body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
        fire('pointerdown', box.right - 30);
        for (let x = box.right - 40; x > box.left + 20; x -= 30) { fire('pointermove', x); await new Promise(r => setTimeout(r, 16)); }
        fire('pointerup', box.left + 20);
        return true;
      });
      if (!ok) throw new Error('no row to slide');
      await page.getByTestId('undo-toast').waitFor({ timeout: 5000 });
    },
  },
  {
    name: 'phone-long-press', caption: 'A long press on a row: its sheet of actions.', devices: phone,
    async run(page) {
      await phoneList(page);
      await page.locator('[data-testid=mobile-row] .body').nth(1).dispatchEvent('contextmenu');
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'filter-return', caption: 'The full list scrolled, a filter scrolled to its own place, a thread opened from it, then back to the full list and the filter: each list is where it was left. The desktop shot is a half-height window, where the filters scroll.', devices: both,
    // Long lists on both sides of the switch: the dense seed's 60 threads.
    query: `${QUERY.replace('machines=1', 'machines=2')}&dense=1`, stress: true,
    async run(page) {
      await prepare(page);
      const phone = await page.evaluate(() => innerWidth < 600);
      if (phone) await phoneList(page);
      else {
        // One-line desktop rows fit every filter of the seed in a full-height window: a half-height one (a laptop split) makes them scroll.
        await page.setViewportSize({ width: 1440, height: 520 });
        await store(page, 's.startDraft("p-boite", { fresh: true });');
        await page.waitForTimeout(400);
      }
      const list = phone ? '[data-testid=mobile-list]' : '[data-testid=sidebar] .scroll';
      const rows = phone ? '[data-testid^=mobile-thread-]' : '[data-testid=thread-row]';
      const scroll = (top: number) => page.evaluate(({ list, top }: { list: string; top: number }) => {
        const box = document.querySelector<HTMLElement>(list)!;
        box.scrollTop = Math.min(top, Math.max(0, box.scrollHeight - box.clientHeight - 40));
        return { top: box.scrollTop, height: box.scrollHeight, box: box.clientHeight };
      }, { list, top });
      const read = () => page.evaluate((list: string) => document.querySelector<HTMLElement>(list)?.scrollTop ?? -1, list);
      const filter = (kind: string) => page.locator(`[data-testid$="lifecycle-${kind}"]:visible`).first().click().then(() => page.waitForTimeout(500));
      // The full list first, away from its top.
      const full = await scroll(phone ? 260 : 220);
      await page.waitForTimeout(300);
      // Then the first filter long enough to scroll on its own, set to a place of its own.
      let kind = '';
      const sizes: string[] = [];
      for (const candidate of ['waiting', 'done', 'working', 'archived']) {
        await filter(candidate);
        const size = await page.evaluate((list: string) => { const box = document.querySelector<HTMLElement>(list)!; return { height: box.scrollHeight, box: box.clientHeight, more: document.querySelectorAll(`${list} [data-testid$=more], ${list} .more`).length }; }, list);
        sizes.push(`${candidate} ${size.height}/${size.box} (${size.more} folds)`);
        if (size.height > size.box + 100) { kind = candidate; break; }
        await filter(candidate);
      }
      if (!kind) throw new Error(`no filter of the dense seed is long enough to scroll: ${sizes.join(', ')}`);
      const own = await scroll(Math.round(full.top / 2) + 30);
      await page.waitForTimeout(300);
      // Open a row that is already in view, by a pointer click, so nothing scrolls it into view first.
      const point = await page.evaluate(({ list, rows }: { list: string; rows: string }) => {
        const box = document.querySelector<HTMLElement>(list)!.getBoundingClientRect();
        const row = [...document.querySelectorAll<HTMLElement>(`${list} ${rows}`)].map(el => el.getBoundingClientRect()).filter(r => r.top > box.top + 40 && r.bottom < box.bottom - 40)[1];
        return row ? { x: row.left + Math.min(80, row.width / 2), y: row.top + row.height / 2 } : null;
      }, { list, rows });
      if (!point) throw new Error('no row in view to open');
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(700);
      if (phone) { await page.getByTestId('mobile-back').click(); await page.waitForTimeout(700); }
      const back = await read();
      await filter(kind);
      const fullBack = await read();
      await filter(kind);
      const ownBack = await read();
      const kept = back === own.top && fullBack === full.top && ownBack === own.top;
      console.log(`  filter-return: full list ${full.top} px of ${full.height} (box ${full.box}), ${kind} ${own.top} px of ${own.height}; after the thread ${kind} ${back}, full list ${fullBack}, ${kind} again ${ownBack}: ${kept ? 'kept' : 'LOST'}`);
      if (!kept) throw new Error('filter-return: a list lost its place');
    },
  },
];

// After a step that changed data, put it back so the next one starts from the seed.
const CLEANUP: Record<string, (page: any) => Promise<void>> = {
  'phone-swipe-undo': async (page) => { await page.getByTestId('undo-action').click().catch(() => {}); await page.waitForTimeout(300); },
  toast: async (page) => { await page.getByTestId('undo-action').click().catch(() => {}); await page.waitForTimeout(300); },
  'working-question': async (page) => { await store(page, "s.pendingQuestions = s.pendingQuestions.filter((q) => q.id !== 'q-showcase-working');"); },
  'filter-return': async (page) => { if (await page.evaluate(() => innerWidth > 600)) await page.setViewportSize((VIEWPORTS.desktop as { viewport: { width: number; height: number } }).viewport); },
  'phone-keyboard': async (page) => {
    await page.getByTestId('composer-input').fill('').catch(() => {});
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); delete document.documentElement.dataset.keyboard; });
    await page.setViewportSize((VIEWPORTS.phone as { viewport: { width: number; height: number } }).viewport);
  },
};

interface Shot { file: string; caption: string; device: Device; theme: Theme }

async function newPage(browser: any, base: string, device: Device, theme: Theme, query: string): Promise<{ context: any; page: any }> {
  const context = await browser.newContext({ ...VIEWPORTS[device], locale: 'en-US', colorScheme: theme, reducedMotion: 'no-preference' });
  await context.addInitScript(({ key, version, theme, experiments, solid, recent }: any) => {
    localStorage.setItem('boite.theme', theme);
    if (solid) localStorage.setItem('boite.features', JSON.stringify({ glass: false }));
    if (recent) localStorage.setItem('boite.thread-view', 'recent');
    localStorage.setItem('boite.locale', 'en');
    localStorage.setItem('boite:right-panel-width', '560');
    localStorage.setItem('boite.experiments', JSON.stringify(experiments));
    localStorage.setItem('boite.experiments.follow', 'off');
    localStorage.setItem(key, JSON.stringify({ version, at: 0 }));
  }, { key: ONBOARDING_STORAGE_KEY, version: ONBOARDING_VERSION, theme, experiments: EXPERIMENTS, solid, recent });
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
  // The showcase rows are in (both seeds keep the working one) and so is the second machine.
  await page.waitForFunction((working: string) => {
    const workspace = (globalThis as any).__boiteTest?.workspace;
    return workspace?.active.threads.some((t: any) => t.id === working) && workspace.machines.length > 1 && workspace.machines.every((m: any) => m.store.threads.length > 0);
  }, WORKING, { timeout: 30000 });
  await store(page, `
    if (s.projects.some((p) => p.id === 'p-garden') && !s.isCollapsed('p-garden')) s.toggleProject('p-garden');
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
  // Cheap enough for every screen: labels whose descenders a box cuts off (`clipping.ts`).
  const clipped = await auditClipping(page).catch((error: Error) => [{ text: `(audit failed: ${error.message.split('\n')[0]})`, cut: 0, box: '' }]);
  if (clipped.length) {
    writeFileSync(`${path}.clip.txt`, formatClipping(clipped));
    console.log(`  clipped: ${clipped.length} labels, first ${JSON.stringify(clipped[0].text)} by ${clipped[0].box}`);
  }
  // And text cut sideways: a control's name under an ellipsis is a defect, a long title is not.
  const cut = await auditTruncation(page).catch((error: Error) => [{ text: `(audit failed: ${error.message.split('\n')[0]})`, shown: 0, needed: 0, label: true }]);
  writeFileSync(`${path}.trunc.txt`, formatTruncation(cut));
  const labels = cut.filter(one => one.label);
  if (labels.length) console.log(`  truncated: ${labels.length} labels, first ${JSON.stringify(labels[0].text)} ${labels[0].shown} of ${labels[0].needed}px`);
  // A phone screen also gets its touch targets measured where a finger lands (`touch.ts`).
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    const small = await auditTouch(page).catch((error: Error) => [{ name: `(audit failed: ${error.message.split('\n')[0]})`, width: 0, height: 0 }]);
    writeFileSync(`${path}.touch.txt`, formatTouch(small));
    const under = small.filter(one => Math.min(one.width, one.height) < 24);
    if (under.length) console.log(`  touch: ${under.length} targets under 24 px, first ${JSON.stringify(under[0].name)} ${under[0].width}x${under[0].height}`);
  }
  if (contrast) {
    const findings = await auditContrast(page);
    writeFileSync(`${path}.contrast.txt`, formatContrast(findings));
    if (findings.length) console.log(`  contrast: ${findings.length} runs under AA, worst ${findings[0].ratio} (${JSON.stringify(findings[0].text)})`);
  }
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
      const wanted = steps.filter(step => step.devices.includes(device) && !(recent && step.projects) && (!only || only.includes(step.name)));
      if (wanted.length === 0) continue;
      console.log(`${device} ${theme}: ${wanted.length} screens`);
      let shared: { context: any; page: any } | null = null;
      const sharedPage = async () => {
        if (!shared) {
          shared = await newPage(browser, rig.base, device, theme, seeded(QUERY));
          console.log(`  renderer ${await assertHardware(shared.page)}`);
          await prepare(shared.page);
        }
        return shared.page;
      };
      for (const step of wanted) {
        const file = `${devicePrefix(device)}-${themePrefix(theme)}-${step.name}`;
        let own: { context: any; page: any } | null = null;
        try {
          let page: any;
          if (step.query) {
            own = await newPage(browser, rig.base, device, theme, seeded(step.query, step));
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
          // Steps find controls by their English names, so most run in English and the screen switches language
          // after; a step that writes text as it runs plays in the one language a single-language run asks for.
          const played = step.speaks && langs.length === 1 && langs[0] !== 'en' ? langs[0] : 'en';
          if (played !== 'en') await speak(page, played);
          try {
            await step.run(page);
          } catch (error) {
            if (played !== 'en') await speak(page, 'en');
            throw error;
          }
          for (const lang of langs) {
            const name = lang === 'en' ? file : `${devicePrefix(device)}-${themePrefix(theme)}-${lang}-${step.name}`;
            if (lang !== played) await speak(page, lang);
            try {
              await snapshot(page, join(out, name));
            } finally {
              if (lang !== 'en') await speak(page, 'en');
            }
            shots.push({ file: `${name}.png`, caption: lang === 'en' ? step.caption : `${step.caption} (${lang})`, device, theme });
          }
          console.log(`  ok ${step.name}`);
          await CLEANUP[step.name]?.(page);
          if (step.spoils && !step.query && shared) { await (shared as any).context.close(); shared = null; }
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
const md = ['# Showcase captures', '', `Command: \`bun scripts/showcase/capture.ts --out ${outArg}${only ? ` --only ${only.join(',')}` : ''}${solid ? ' --solid' : ''}${recent ? ' --view recent' : ''} --seed ${seed}\``, ''];
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
