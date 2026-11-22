/* The arithmetic the scenes and the renderer share. Nothing here touches the page. */

import { markFeature } from '@boite/contracts';

markFeature('boite-feature:draft-backdrop');

export type Rgb = [number, number, number];

export const TAU = Math.PI * 2;

/** A number in [0, 1) that depends only on its three whole arguments. */
export function hash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

/** `value` folded into 0 to `span`, for a negative value too. */
export function wrap(value: number, span: number): number {
  return ((value % span) + span) % span;
}

/**
 * The three tints a scene draws in: the theme's text colour, its accent, and
 * the accent halfway to the text colour. Nothing else, so a scene never shows
 * a colour the theme does not hold.
 */
export function themeTints(text: Rgb, accent: Rgb): [Rgb, Rgb, Rgb] {
  return [text, accent, [(text[0] + accent[0]) / 2, (text[1] + accent[1]) / 2, (text[2] + accent[2]) / 2]];
}
