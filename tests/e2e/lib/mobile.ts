import type { BrowserPage } from './cdp.ts';

/**
 * The phone's slides and sheets (`app.css`'s `screen-*` and `sheet-*` keyframes) have come
 * to rest: what is measured or tapped next is where it stays.
 */
export const screensSettled = `!document.getAnimations().some(animation => /^(screen|sheet)-/.test(animation.animationName ?? '') && animation.playState === 'running')`;

/** From a conversation, which hides the bottom bar, Back leads to the list that shows it. */
export async function toMobileList(page: BrowserPage): Promise<void> {
  if (await page.evaluate(`!!document.querySelector('[data-testid=mobile-tabs]')`)) return;
  // Settings is a page over the place it was opened from (MobileNavigation.svelte leaveSettings): its arrow leads back
  // there, to the list or to the conversation it covered, whose own arrow then leads to the list.
  if (await page.evaluate(`!!document.querySelector('[data-testid=mobile-settings-leave]')`)) {
    await page.click('[data-testid=mobile-settings-leave]');
    await page.waitFor(`document.querySelector('[data-testid=mobile-tabs], [data-testid=mobile-back]')`);
    if (await page.evaluate(`!!document.querySelector('[data-testid=mobile-tabs]')`)) return;
  }
  await page.click('[data-testid=mobile-back]');
  await page.waitFor(`document.querySelector('[data-testid=mobile-tabs]')`);
}

/** Navigate through the phone's bottom bar, from a conversation too; Settings is the list header's gear. */
export async function mobileAction(page: BrowserPage, destination: string): Promise<void> {
  await toMobileList(page);
  await page.click(destination === 'mobile-settings' ? '[data-testid=mobile-settings]' : `[data-testid=mobile-tabs] [data-testid=${destination}]`);
}

/** A new draft from the thread list's "New" in its header. */
export async function newMobileThread(page: BrowserPage): Promise<void> {
  await toMobileList(page);
  await page.click('[data-testid=mobile-new]');
}

/** The panel from the conversation header's Panels door, on a phone too. */
export async function openMobilePanel(page: BrowserPage): Promise<void> {
  await page.click('[data-testid=panel-toggle]');
  await page.waitFor(`document.querySelector('[data-testid=right-panel]')`);
}

/** Limits, once Settings is open: a desktop tab, or on a phone the second tab of the Usage screen. */
export async function openLimitsTab(page: BrowserPage): Promise<void> {
  await page.waitFor(`document.querySelector('[data-testid=mobile-settings-home], [data-testid=mobile-settings-detail], [data-testid=settings-tab-limits]')`);
  if (await page.evaluate(`!!document.querySelector('[data-testid=settings-tab-limits]')`)) {
    await page.click('[data-testid=settings-tab-limits]');
    return;
  }
  if (!await page.evaluate(`!!document.querySelector('[data-testid=mobile-usage-tab-limits]')`)) await page.click('[data-testid=settings-tab-usage]');
  await page.click('[data-testid=mobile-usage-tab-limits]');
}
