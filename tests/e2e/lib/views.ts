import type { BrowserPage } from './cdp.ts';

/**
 * Lists the sidebar's threads by project or by recency: the two words in the
 * list's head (ViewSwitch.svelte). `prefix` is `mobile-` for the phone's thread list.
 */
export async function showThreadView(page: BrowserPage, view: 'projects' | 'recent', prefix = ''): Promise<void> {
  const side = `[data-testid=${prefix}view-switch] [data-value=${view}]`;
  await page.waitFor(`document.querySelector('${side}')`);
  if (await page.evaluate(`document.querySelector('${side}').getAttribute('aria-checked') !== 'true'`)) await page.click(side);
  await page.waitFor(`document.querySelector('${side}')?.getAttribute('aria-checked') === 'true'`);
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

/**
 * Opens the thread list's display menu, which holds the project and
 * machine filters and Add a project since the redesign. A choice leaves it open.
 */
export async function openDisplayOptions(page: BrowserPage, prefix = ''): Promise<void> {
  const trigger = `[data-testid=${prefix}grouping-options]`;
  await page.waitFor(`document.querySelector('${trigger}')`);
  if (await page.evaluate(`document.querySelector('${trigger}').getAttribute('aria-expanded') !== 'true'`)) await page.click(trigger);
  await page.waitFor(`document.querySelector('[data-testid=${prefix}grouping-options-menu]')`);
}

/** Closes the display menu again when a choice left it open. */
export async function closeDisplayOptions(page: BrowserPage, prefix = ''): Promise<void> {
  const trigger = `[data-testid=${prefix}grouping-options]`;
  if (await page.evaluate(`document.querySelector('${trigger}')?.getAttribute('aria-expanded') === 'true'`)) await page.click(trigger);
  await page.waitFor(`!document.querySelector('[data-testid=${prefix}grouping-options-menu]')`);
}

/** Opens the Recent view's project filter, inside the display menu. */
export async function openProjectFilter(page: BrowserPage, prefix = ''): Promise<void> {
  await openDisplayOptions(page, prefix);
  await page.click(`[data-testid=${prefix}project-filter]`);
  await page.waitFor(`document.querySelector('[data-testid=${prefix}project-filter-menu]')`);
}

/** Add a project, the display menu's last row. */
export async function clickAddProject(page: BrowserPage): Promise<void> {
  await openDisplayOptions(page);
  await page.click('[data-testid=grouping-options-menu] [data-testid=add-project]');
}
