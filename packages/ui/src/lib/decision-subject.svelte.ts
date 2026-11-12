import type { PermissionRequest } from '@boite/contracts';

/**
 * A waiting permission named in a sentence, as the composer's placeholder
 * says Send declines it: the decision's own title (`lib/decision-title.ts`),
 * cut after the last whole word within `max` characters. The titles stay out
 * of the first load, so the first call asks for them and answers null, the
 * caller's generic words, until they arrive. A title whose first two words
 * already pass `max` ("Edit src/lib/upload.ts" on a phone) is null as well:
 * one verb alone names nothing.
 */
let titles = $state.raw<typeof import('./decision-title') | null>(null);
let asked = false;

export function decisionSubject(permission: Pick<PermissionRequest, 'toolName' | 'input'> | null | undefined, max: number): string | null {
  if (!permission) return null;
  if (!titles) {
    if (!asked) { asked = true; void import('./decision-title').then((module) => { titles = module; }, () => { asked = false; }); }
    return null;
  }
  return cutAtWord(titles.decisionTitle(permission.toolName, permission.input).replace(/[.?!]$/, ''), max);
}

/** `text` whole when it fits `max`, else its leading words that do and an ellipsis; null when fewer than two fit. */
export function cutAtWord(text: string, max: number): string | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const words = clean.split(' ');
  let kept = '';
  let count = 0;
  for (const word of words) {
    const next = kept ? `${kept} ${word}` : word;
    if (next.length > max) break;
    kept = next;
    count++;
  }
  return count >= 2 ? `${kept}\u2026` : null;
}
