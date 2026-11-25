import type { BrowserPage } from './cdp.ts';
import { mobileAction } from './mobile.ts';

/**
 * The bots on a desktop: one picture per bot in the window's app rail
 * (`AppRail.svelte`), the teams after them, then the `+` that creates either.
 * A phone has no rail: its Bots screen lists `agent-entry-<id>` rows instead.
 */
export const railBot = (agentId: string) => `[data-testid="rail-bot"][data-agent-id="${agentId}"]`;
export const railTeam = (teamId: string) => `[data-testid="rail-team"][data-team-id="${teamId}"]`;

/** Opens a bot's conversation on the Bots page, via the app rail when Mochi layout is on or the sidebar list otherwise. */
export async function openRailBot(page: BrowserPage, agentId: string, timeoutMs?: number): Promise<void> {
  await page.waitFor(`document.querySelector('${railBot(agentId)}') || document.querySelector('[data-testid="nav-agents"]') || document.querySelector('[data-testid="agent-entry-${agentId}"]')`, timeoutMs);
  if (await page.evaluate<boolean>(`!!document.querySelector('${railBot(agentId)}')`)) {
    await page.click(railBot(agentId));
    await page.waitFor(`document.querySelector('[data-testid="agents-page"]') && document.querySelector('${railBot(agentId)}')?.getAttribute('aria-current') === 'page'`, timeoutMs);
    return;
  }
  const row = `[data-testid="agent-entry-${agentId}"]`;
  if (!await page.evaluate<boolean>(`!!document.querySelector('${row}')`)) await page.click('[data-testid="nav-agents"]');
  await page.waitFor(`document.querySelector('${row}')`, timeoutMs);
  await page.click(row);
  await page.waitFor(`document.querySelector('[data-testid="agents-page"]') && document.querySelector('${row}')?.getAttribute('aria-current') === 'page'`, timeoutMs);
}

/** Opens a team's chat on the Bots page, via the app rail when Mochi layout is on or the sidebar list otherwise. */
export async function openRailTeam(page: BrowserPage, teamId: string, timeoutMs?: number): Promise<void> {
  await page.waitFor(`document.querySelector('${railTeam(teamId)}') || document.querySelector('[data-testid="nav-agents"]') || document.querySelector('[data-testid="agent-team-${teamId}"]')`, timeoutMs);
  if (await page.evaluate<boolean>(`!!document.querySelector('${railTeam(teamId)}')`)) {
    await page.click(railTeam(teamId));
    await page.waitFor(`document.querySelector('[data-testid="agents-page"]')`, timeoutMs);
    return;
  }
  const row = `[data-testid="agent-team-${teamId}"]`;
  if (!await page.evaluate<boolean>(`!!document.querySelector('${row}')`)) await page.click('[data-testid="nav-agents"]');
  await page.waitFor(`document.querySelector('${row}')`, timeoutMs);
  await page.click(row);
  await page.waitFor(`document.querySelector('[data-testid="agents-page"]')`, timeoutMs);
}

/** The `+` menu for a new bot or team, from the app rail or the compact Mochis sidebar head. */
export async function railAdd(page: BrowserPage, what: 'bot' | 'team'): Promise<void> {
  await page.waitFor(`document.querySelector('[data-testid="rail-add"], [data-testid="agents-rail-add"], [data-testid="nav-agents"]')`);
  if (!await page.evaluate<boolean>(`!!document.querySelector('[data-testid="rail-add"], [data-testid="agents-rail-add"]')`)) {
    await page.click('[data-testid="nav-agents"]');
    await page.waitFor(`document.querySelector('[data-testid="agents-rail-add"]')`);
  }
  await page.click('[data-testid="rail-add"], [data-testid="agents-rail-add"]');
  await page.click(`[data-testid="context-menu"] [data-value="${what}"]`);
  await page.waitFor(`!document.querySelector('[data-testid="context-menu"]')`);
}

/**
 * Opens a bot's conversation the way the screen offers it: its picture in the
 * rail (or compact sidebar list) on a desktop, the Bots tab then its row on a phone (720 px and below).
 */
export async function openBot(page: BrowserPage, agentId: string, timeoutMs?: number): Promise<void> {
  if (!await page.evaluate<boolean>(`matchMedia('(max-width: 720px)').matches`)) return openRailBot(page, agentId, timeoutMs);
  const row = `[data-testid="agent-entry-${agentId}"]`;
  // A phone opens on a draft, which hides the tab bar: back to the list first.
  if (!await page.evaluate<boolean>(`document.querySelector('${row}')?.getBoundingClientRect().width > 0`)) await mobileAction(page, 'mobile-agents');
  await page.waitFor(`document.querySelector('${row}')?.getBoundingClientRect().width > 0`, timeoutMs);
  await page.click(row);
  await page.waitFor(`document.querySelector('[data-testid="agents-page"]')`, timeoutMs);
}
