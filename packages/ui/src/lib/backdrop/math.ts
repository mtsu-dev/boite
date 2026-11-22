/* The arithmetic the scenes and the renderer share. Nothing here touches the page. */

import { markFeature } from '@boite/contracts';

markFeature('boite-feature:draft-backdrop');

export type Rgb = [number, number, number];

export const TAU = Math.PI * 2;

/** A number from 0 to 1 that depends only on its three whole arguments. */
export function hash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

/** `value` folded into 0 to `span`, for a negative value too. */
export function wrap(value: number, span: number): number {
  return ((value % span) + span) % span;
}

/**
 * The colour with its hue turned by `degrees`, lightness and saturation kept
 * (HSL). The scenes' second colour is the accent turned 70 degrees toward
 * blue, so it follows whatever accent the device picked.
 */
export function turnHue([red, green, blue]: Rgb, degrees: number): Rgb {
  const r = red / 255, g = green / 255, b = blue / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const light = (max + min) / 2, spread = max - min;
  const chroma = 1 - Math.abs(2 * light - 1);
  const saturation = spread && chroma ? spread / chroma : 0;
  let hue = 0;
  if (spread) hue = max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
  hue = wrap(hue * 60 + degrees, 360);
  const c = chroma * saturation, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = light - c / 2;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}
