import type { BrowserPage } from './cdp.ts';

/**
 * Lists the sidebar's threads by project or by recency. The choice sits in the
 * display options menu, which stays open on a choice, so this closes it again.
 * `prefix` is `mobile-` for the phone's thread list.
 */
export async function showThreadView(page: BrowserPage, view: 'projects' | 'recent', prefix = ''): Promise<void> {
  const trigger = `[data-testid=${prefix}grouping-options]`, menu = `[data-testid=${prefix}grouping-options-menu]`;
  if (await page.evaluate(`document.querySelector('${trigger}')?.getAttribute('aria-expanded') !== 'true'`)) await page.click(trigger);
  await page.click(`${menu} [data-value="view:${view}"]`);
  await page.waitFor(`document.querySelector('${menu} [data-value="view:${view}"]')?.getAttribute('aria-checked') === 'true'`);
  await page.click(trigger);
  await page.waitFor(`!document.querySelector('${menu}')`);
}

/** Orders the projects by recent activity or by the user's own arrangement, from the same panel. */
export async function setProjectOrder(page: BrowserPage, order: 'recent' | 'manual', prefix = ''): Promise<void> {
  const trigger = `[data-testid=${prefix}grouping-options]`, menu = `[data-testid=${prefix}grouping-options-menu]`;
  if (await page.evaluate(`document.querySelector('${trigger}')?.getAttribute('aria-expanded') !== 'true'`)) await page.click(trigger);
  await page.click(`${menu} [data-value="order:${order}"]`);
  await page.waitFor(`document.querySelector('${menu} [data-testid=${prefix}project-sort]')?.dataset.order === '${order}'`);
  await page.click(trigger);
  await page.waitFor(`!document.querySelector('${menu}')`);
}

/** The desktop Settings nav has eight entries; a grouped one shows its pages as tabs at the top of its card. */
const SETTINGS_GROUP: Record<string, string> = {
  keyboard: 'appearance', voice: 'appearance', plugins: 'accounts', limits: 'usage',
  'task-manager': 'resources', diagnostics: 'advanced', experiments: 'advanced'
};

/** Opens a page of the desktop Settings, once its nav shows: the entry, then the page's tab when the entry groups several. */
export async function openSettingsPage(page: BrowserPage, tab: string): Promise<void> {
  const group = SETTINGS_GROUP[tab];
  await page.click(`[data-testid=settings-tab-${group ?? tab}]`);
  if (!group) return;
  await page.click(`[data-testid=settings-page-${tab}]`);
  await page.waitFor(`document.querySelector('[data-testid=settings-page-${tab}]')?.getAttribute('aria-selected') === 'true'`);
}

/** The terminal drawer opens and closes from the title bar's panel list, which names it beside the panel's surfaces. */
export async function toggleTerminal(page: BrowserPage): Promise<void> {
  await page.click('[data-testid=panel-list]');
  await page.click('[data-testid=panel-list-menu] [data-value=terminal]');
  await page.waitFor(`!document.querySelector('[data-testid=panel-list-menu]')`);
}

const FOLDS = '[data-testid=project-more][aria-expanded=false], [data-testid=project-more-needs][aria-expanded=false], [data-testid=mobile-more][aria-expanded=false], [data-testid=mobile-more-needs][aria-expanded=false]';

/** Opens one closed "N more" row, re-read each time since opening one redraws the list; false when none is left. */
async function openOneFold(page: BrowserPage): Promise<boolean> {
  const opened = await page.evaluate<boolean>(`(() => { const button = document.querySelector('${FOLDS}'); button?.click(); return !!button; })()`);
  if (opened) await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  return opened;
}

/** A project lists a few rows and folds the rest under "N more": unfold them until the thread's row shows. */
export async function revealThreadRow(page: BrowserPage, threadId: string): Promise<void> {
  // The list's own row: an Inbox card or a Done row carries the same thread id.
  const row = ['thread-row', 'mobile-row'].map(testid => `[data-testid=${testid}][data-thread-id="${threadId}"]`).join(', ');
  await page.waitFor(`document.querySelector('${row}') || document.querySelector('${FOLDS}')`);
  for (let round = 0; round < 20 && await page.evaluate<boolean>(`!document.querySelector('${row}')`); round++) {
    if (!await openOneFold(page)) break;
  }
  await page.waitFor(`document.querySelector('${row}')`);
}

/** Unfolds every project's "N more" rows, which stay open for the session (`lib/thread-lanes.svelte.ts`). */
export async function unfoldThreadRows(page: BrowserPage): Promise<void> {
  await page.waitFor(`document.querySelector('[data-testid=thread-row], [data-testid=mobile-list] .thread, [data-testid=mobile-list] [data-testid=mobile-row]')`);
  for (let round = 0; round < 20 && await openOneFold(page); round++);
}
