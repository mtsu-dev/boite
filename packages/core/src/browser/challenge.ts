/*
 * Bot checks a site puts in front of its page: Cloudflare's wait page, a
 * Turnstile, reCAPTCHA or hCaptcha checkbox, DataDome, HUMAN, Akamai, Amazon.
 * After a navigation the core looks for one, waits for a check that clears by
 * itself, clicks a checkbox once the way a pointer does, and tells the agent
 * what happened in the reply's note.
 *
 * Nothing here answers a check for the browser. No value a page reads is
 * changed, no puzzle is solved and no outside service is asked: the browser
 * passes what the same Chrome with the same cookies passes when a person
 * clicks the box, and the rest is named so the agent or the user takes over.
 */

import type { BrowserReply } from '@boite/contracts';
import type { Core } from '../core.ts';
import type { Tab } from './types.ts';

/** What the wait needs of a tab: an evaluation in its top document and DevTools input. */
export interface ChallengePage {
  evaluate(expression: string, timeoutMs?: number): Promise<unknown>;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

type ChallengeVendor = 'Cloudflare' | 'Turnstile' | 'reCAPTCHA' | 'hCaptcha' | 'DataDome' | 'HUMAN' | 'Akamai' | 'Amazon' | 'AWS WAF';

/**
 * `auto` clears by itself in a trusted browser. `checkbox` has a box to click.
 * `hold` (press and hold) and `puzzle` (images, a slider, letters to type)
 * need more than one click. `blocked` is a refusal with no check to pass.
 */
type ChallengeKind = 'auto' | 'checkbox' | 'hold' | 'puzzle' | 'blocked';

export interface Challenge {
  vendor: ChallengeVendor;
  kind: ChallengeKind;
  /**
   * The widget that holds the checkbox, in CSS pixels of the viewport. `hit`
   * answers a look made with a point: whether the widget, and not something
   * drawn over it, receives that point.
   */
  box?: { x: number; y: number; width: number; height: number; hit?: boolean };
}

export interface ChallengeOutcome {
  vendor: ChallengeVendor;
  kind: ChallengeKind;
  passed: boolean;
  clicked: boolean;
  ms: number;
  /** One short sentence for the reply's `note`. */
  note: string;
}

/** The whole wait: under the 15 s an agent's own wait may take, so the command answers inside the core's deadline. */
const CHALLENGE_WAIT_MS = 12_000;
const POLL_MS = 300;
/**
 * Cloudflare's widget runs its own check first and shows a box only when that
 * fails. Its frame is closed to the page, so the box cannot be seen arriving:
 * the click waits 4 s, which leaves the widget 8 s to verify it. A click on
 * a widget still checking does nothing.
 */
const CLICK_AFTER_MS: Partial<Record<ChallengeVendor, number>> = { Cloudflare: 4000, Turnstile: 4000 };
const CLICK_AFTER_DEFAULT_MS = 500;
/** How far from its widget's left edge the centre of each checkbox sits: Turnstile is 300 by 65, reCAPTCHA 304 by 78, hCaptcha 303 by 78. */
const CHECKBOX_LEFT_PX: Partial<Record<ChallengeVendor, number>> = { Cloudflare: 22, Turnstile: 22, reCAPTCHA: 27, hCaptcha: 30 };

/**
 * One evaluation in the top document, a few selectors and no layout beyond
 * the widget's own box: a page with no check pays this and nothing else.
 *
 * A vendor's own wait page is a check wherever it shows. A Turnstile,
 * reCAPTCHA or hCaptcha widget is one only on a page that holds little else:
 * the same widget inside a sign-up or comment form is that form's business,
 * and clicking it on arrival would be acting for the agent.
 *
 * `scroll` brings the widget into view first, for the click. `at` asks
 * whether the widget receives that point.
 */
function detectScript(scroll = false, at?: { x: number; y: number }): string {
  return `(() => {
  const d = document, w = window, q = s => d.querySelector(s);
  const seen = el => !!el && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
  const boxOf = el => {
    if (!seen(el)) return undefined;
    if (${scroll ? 'true' : 'false'}) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return undefined;
    ${at ? `const hit = d.elementFromPoint(${Number(at.x)}, ${Number(at.y)});
    return { x: r.left, y: r.top, width: r.width, height: r.height, hit: !!hit && (hit === el || el.contains(hit)) };` : 'return { x: r.left, y: r.top, width: r.width, height: r.height };'}
  };
  const widget = (vendor, el) => { const box = boxOf(el); return box ? { vendor, kind: 'checkbox', box } : { vendor, kind: 'auto' }; };
  const filled = s => [...d.querySelectorAll(s)].some(el => !!el.value);
  const title = d.title || '';
  const text = () => (d.body ? d.body.innerText : '').trim();

  // Cloudflare's wait page. Its Turnstile sits in a closed shadow root: the host element is what can be measured.
  if (w._cf_chl_opt || /^just a moment/i.test(title) || q('#challenge-form, #challenge-running, #cf-challenge-running, #challenge-stage, #challenge-error-text, .cf-browser-verification')) {
    const input = q('input[name="cf-turnstile-response"]');
    return widget('Cloudflare', input && (input.closest('.cf-turnstile') || input.parentElement));
  }
  if (/^attention required/i.test(title) && q('.cf-error-details, #cf-error-details, .cf-wrapper')) return { vendor: 'Cloudflare', kind: 'blocked' };

  if (q('#px-captcha, #px-captcha-wrapper') || (w._pxAppId && /denied|human/i.test(title))) return { vendor: 'HUMAN', kind: 'hold' };

  if (q('iframe[src*="captcha-delivery.com"]')) return { vendor: 'DataDome', kind: 'puzzle' };
  if (q('script[src*="captcha-delivery.com"]') && text().length < 600) return { vendor: 'DataDome', kind: 'auto' };

  if (q('#sec-if-cpt-container, #sec-cpt-if, #sec-text-if, #sec-container, script[src*="/_sec/cp_challenge/"]')) return { vendor: 'Akamai', kind: 'auto' };
  if (/^access denied$/i.test(title) && /errors\\.edgesuite\\.net/i.test(text())) return { vendor: 'Akamai', kind: 'blocked' };

  if (q('form[action*="validateCaptcha"]')) return { vendor: 'Amazon', kind: 'puzzle' };
  if (q('#captcha-container') && (w.AwsWafCaptcha || q('script[src*="awswaf.com"][src*="captcha"]'))) return { vendor: 'AWS WAF', kind: 'puzzle' };
  if (q('script[src*="awswaf.com"][src*="challenge"]') && text().length < 600) return { vendor: 'AWS WAF', kind: 'auto' };

  // A widget alone on its page. Google's own "unusual traffic" page lives under /sorry/.
  const re = q('iframe[src*="/recaptcha/"][src*="/anchor"]');
  const h = q('iframe[src*="hcaptcha.com"][src*="frame=checkbox"]');
  const turnstile = q('.cf-turnstile, input[name="cf-turnstile-response"]');
  if (!re && !h && !turnstile) return null;
  const alone = location.pathname.startsWith('/sorry/') || (text().length < 600 && !q('input[type="password"], input[type="email"], input[type="text"], input:not([type]), textarea:not([name$="-response"])'));
  if (!alone) return null;
  if (re) {
    if (seen(q('iframe[src*="/recaptcha/"][src*="/bframe"]'))) return { vendor: 'reCAPTCHA', kind: 'puzzle' };
    return filled('textarea[name="g-recaptcha-response"]') ? null : widget('reCAPTCHA', re);
  }
  if (h) {
    if (seen(q('iframe[src*="hcaptcha.com"][src*="frame=challenge"]'))) return { vendor: 'hCaptcha', kind: 'puzzle' };
    return filled('[name="h-captcha-response"]') ? null : widget('hCaptcha', h);
  }
  if (filled('input[name="cf-turnstile-response"]')) return null;
  const input = q('input[name="cf-turnstile-response"]');
  return widget('Turnstile', q('.cf-turnstile') || (input && input.parentElement));
})()`;
}

const VENDORS: ReadonlySet<string> = new Set<ChallengeVendor>(['Cloudflare', 'Turnstile', 'reCAPTCHA', 'hCaptcha', 'DataDome', 'HUMAN', 'Akamai', 'Amazon', 'AWS WAF']);
const KINDS: ReadonlySet<string> = new Set<ChallengeKind>(['auto', 'checkbox', 'hold', 'puzzle', 'blocked']);

/** The check on the page now, or null. Throws when the page cannot answer, as between two documents. */
async function detectChallenge(page: ChallengePage, scroll = false, at?: { x: number; y: number }): Promise<Challenge | null> {
  const found = await page.evaluate(detectScript(scroll, at), 3000) as Partial<Challenge> | null;
  if (!found || typeof found !== 'object' || !VENDORS.has(String(found.vendor)) || !KINDS.has(String(found.kind))) return null;
  const box = found.box;
  const sound = !!box && [box.x, box.y, box.width, box.height].every(Number.isFinite);
  return { vendor: found.vendor!, kind: found.kind!, ...(sound ? { box: { x: box.x, y: box.y, width: box.width, height: box.height, ...(typeof box.hit === 'boolean' ? { hit: box.hit } : {}) } } : {}) };
}

const AN = new Set<ChallengeVendor>(['hCaptcha', 'Akamai', 'Amazon', 'AWS WAF']);
const named = (vendor: ChallengeVendor) => `${AN.has(vendor) ? 'an' : 'a'} ${vendor}`;
const seconds = (ms: number) => ms >= 9950 ? String(Math.round(ms / 1000)) : (ms / 1000).toFixed(1);
const TAKE_OVER = 'take a screenshot, act on the page, or ask the user to take over in the panel';
const PUZZLES: Partial<Record<ChallengeVendor, string>> = {
  reCAPTCHA: 'image puzzle', hCaptcha: 'image puzzle', DataDome: 'slider puzzle', Amazon: 'captcha page', 'AWS WAF': 'puzzle',
};

/** The sentence an agent reads. Short: it rides in every reply that met a check. */
export function challengeNote(found: Challenge, passed: boolean, clicked: boolean, ms: number, covered = false): string {
  const click = clicked ? ' (its checkbox was clicked)' : covered ? ' (something covers its checkbox, so nothing was clicked)' : '';
  if (passed) return `passed ${named(found.vendor)} check in ${seconds(ms)} s${click}`;
  if (found.kind === 'blocked') return `${found.vendor} refused this browser and offers no check to pass; ask the user to open the page in the panel`;
  if (found.kind === 'hold') return `on ${named(found.vendor)} press-and-hold check${click}, which does not clear by itself; ${TAKE_OVER}`;
  if (found.kind === 'puzzle') return `on ${named(found.vendor)} ${PUZZLES[found.vendor] ?? 'puzzle'}${click}, which does not clear by itself; ${TAKE_OVER}`;
  return `still on ${named(found.vendor)} check after ${seconds(ms)} s${click}; ${TAKE_OVER}`;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const between = (low: number, high: number) => low + Math.random() * (high - low);

/**
 * One click on the widget's checkbox with the browser's own input, as a
 * pointer arrives: from outside the box, through a few points on the way, to
 * a point a little off the checkbox's centre. A widget ignores a click that
 * no pointer movement led to, which is also what a person never produces.
 * Just before the press, the widget must still receive the point: a banner or
 * a button drawn over it would take the click instead, so nothing is pressed
 * and the answer is false.
 */
async function clickCheckbox(page: ChallengePage, box: NonNullable<Challenge['box']>, vendor: ChallengeVendor): Promise<boolean> {
  const x = box.x + Math.min(CHECKBOX_LEFT_PX[vendor] ?? 27, box.width / 2) + between(-3, 3);
  const y = box.y + box.height / 2 + between(-3, 3);
  const fromX = Math.max(2, box.x + box.width + between(60, 140)), fromY = Math.max(2, box.y - between(40, 110));
  const steps = 6;
  for (let step = 0; step <= steps; step++) {
    // Eased, so the pointer slows as it arrives.
    const t = step / steps, eased = 1 - (1 - t) ** 2;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX + (x - fromX) * eased, y: fromY + (y - fromY) * eased, button: 'none', buttons: 0 });
    await sleep(between(15, 40));
  }
  if ((await detectChallenge(page, false, { x, y }))?.box?.hit !== true) return false;
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(between(50, 110));
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  return true;
}

/**
 * Looks for a check on the page a navigation ended on. None: null, after one
 * evaluation. One that clears by itself or has a checkbox is waited for, up
 * to `maxMs`, the checkbox clicked once on the way; one that needs more is
 * reported at once. A page that cannot answer is between two documents, as
 * when the check passed and the site loads: it counts as still checking.
 */
export async function passChallenge(page: ChallengePage, maxMs = CHALLENGE_WAIT_MS, now: () => number = Date.now): Promise<ChallengeOutcome | null> {
  let found: Challenge | null;
  try { found = await detectChallenge(page); } catch { return null; }
  if (!found) return null;
  const start = now();
  let clicked = false, covered = false, clear = 0;
  const outcome = (seen: Challenge, passed: boolean): ChallengeOutcome => {
    const ms = now() - start;
    return { vendor: seen.vendor, kind: seen.kind, passed, clicked, ms, note: challengeNote(seen, passed, clicked, ms, covered) };
  };
  while (true) {
    if (found.kind === 'hold' || found.kind === 'puzzle' || found.kind === 'blocked') return outcome(found, false);
    const elapsed = now() - start;
    if (elapsed >= maxMs) return outcome(found, false);
    if (found.kind === 'checkbox' && found.box && !clicked && !covered && elapsed >= (CLICK_AFTER_MS[found.vendor] ?? CLICK_AFTER_DEFAULT_MS)) {
      try {
        // Measured again with the widget in view: the page may have laid out since.
        const placed = await detectChallenge(page, true);
        // One try: a cover that stays is the agent's to deal with, and the note says so.
        if (placed?.kind === 'checkbox' && placed.box) { if (await clickCheckbox(page, placed.box, placed.vendor)) clicked = true; else covered = true; }
      } catch { /* the page moved on: the next look says where it stands */ }
    }
    await sleep(Math.min(POLL_MS, Math.max(1, maxMs - (now() - start))));
    let next: Challenge | null | undefined;
    try { next = await detectChallenge(page); } catch { next = undefined; }
    if (next === undefined) { clear = 0; continue; }
    if (next) { found = next; clear = 0; continue; }
    // Two looks in a row without a check: one alone may be the blank moment before the check's next step.
    if (++clear >= 2) return outcome(found, true);
  }
}

/**
 * What the core does after a navigation of `tab`: the wait above, then the
 * tab's address and title read again, since passing a check loads the page
 * that was asked for. The answer is what the reply's value gains: a `note`
 * that says how the check ended, or nothing when the page had none. Never
 * throws: a navigation that worked is not failed by its check.
 */
export async function settleChallenge(tab: Tab, evaluate: ChallengePage['evaluate'], changed: () => void, logs: Pick<Core['logs'], 'debug'>): Promise<{ note?: string }> {
  const outcome = await passChallenge({ evaluate, send: (method, params) => tab.engine.cdp.send(method, params ?? {}, tab.sessionId) }).catch(() => null);
  if (!outcome) return {};
  const now = await evaluate('({ url: location.href, title: document.title })', 3000).catch(() => null) as { url?: string; title?: string } | null;
  if (now?.url) { tab.url = now.url; tab.title = (now.title ?? '').slice(0, 200); }
  // Viewers hear the page the check gave way to before the agent's answer.
  changed();
  logs.debug(`browser tab ${tab.id} met ${outcome.vendor}'s check: ${outcome.note}`, { source: 'browser', event: 'browser.challenge', threadId: tab.threadId, durationMs: outcome.ms, data: { vendor: outcome.vendor, kind: outcome.kind, passed: outcome.passed, clicked: outcome.clicked } });
  return { note: outcome.note };
}

/** The reply of a back, forward or reload with the note of the check its page asked for, after the action's own. */
export function historyChallenge(reply: BrowserReply, noted: { note?: string }, tab: Pick<Tab, 'url' | 'title'>): BrowserReply {
  if (!noted.note) return reply;
  const value = reply.value && typeof reply.value === 'object' ? reply.value as Record<string, unknown> : { ok: true };
  const note = typeof value.note === 'string' && value.note ? `${value.note}; ${noted.note}` : noted.note;
  return { ...reply, value: { ...value, note, ...('url' in value ? { url: tab.url, title: tab.title } : {}) } };
}
