import type { BrowserPage } from './cdp.ts';
import { mobileAction } from './mobile.ts';

/**
 * The bots on a desktop: one picture per bot in the window's app rail
 * (`AppRail.svelte`), the teams after them, then the `+` that creates either.
 * A phone has no rail: its Bots screen lists `agent-entry-<id>` rows instead.
 */
export const railBot = (agentId: string) => `[data-testid="rail-bot"][data-agent-id="${agentId}"]`;
export const railTeam = (teamId: string) => `[data-testid="rail-team"][data-team-id="${teamId}"]`;

/** Opens a bot's conversation on the Bots page from its picture in the rail. */
export async function openRailBot(page: BrowserPage, agentId: string, timeoutMs?: number): Promise<void> {
  await page.waitFor(`document.querySelector('${railBot(agentId)}')`, timeoutMs);
  await page.click(railBot(agentId));
  await page.waitFor(`document.querySelector('[data-testid="agents-page"]') && document.querySelector('${railBot(agentId)}')?.getAttribute('aria-current') === 'page'`, timeoutMs);
}

/** Opens a team's chat on the Bots page from its picture in the rail. */
export async function openRailTeam(page: BrowserPage, teamId: string, timeoutMs?: number): Promise<void> {
  await page.waitFor(`document.querySelector('${railTeam(teamId)}')`, timeoutMs);
  await page.click(railTeam(teamId));
  await page.waitFor(`document.querySelector('[data-testid="agents-page"]')`, timeoutMs);
}

/** The rail's `+`: a new bot or a new team, each opening its form on the Bots page. */
export async function railAdd(page: BrowserPage, what: 'bot' | 'team'): Promise<void> {
  await page.waitFor(`document.querySelector('[data-testid="rail-add"]')`);
  await page.click('[data-testid="rail-add"]');
  await page.click(`[data-testid="context-menu"] [data-value="${what}"]`);
  await page.waitFor(`!document.querySelector('[data-testid="context-menu"]')`);
}

/**
 * Opens a bot's conversation the way the screen offers it: its picture in the
 * rail on a desktop, the Bots tab then its row on a phone (720 px and below).
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
