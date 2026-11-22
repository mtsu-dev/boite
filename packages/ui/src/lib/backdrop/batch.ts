/*
 * The triangles of one frame, as the renderer uploads them. A vertex is nine
 * numbers: its place in view space (x right, y up, z away from the viewer),
 * its texture coordinates, its brightness, then the material of its triangle:
 * texture, tint and a number the texture may read.
 *
 * A scene fills up to four corners and emits them as a quad, so a frame
 * allocates nothing: an array per vertex, sixty times a second, was a
 * garbage collection every few seconds and a visible hitch with each.
 */

import { markFeature } from '@boite/contracts';

markFeature('boite-feature:draft-backdrop');

export const STRIDE = 9;

/**
 * What the fragment shader draws in a triangle, by the number a vertex carries:
 * a flat fill, a line with a sharp edge, a line of light that fades across, a
 * disc, a soft glow, then the two that fill the whole screen by themselves.
 */
export const TEX = { flat: 0, line: 1, beam: 2, dot: 3, glow: 4, contour: 5, ascii: 6 } as const;

/** The three colours a scene may use: the text colour, the accent and the two mixed half and half. */
export const TINT = { text: 0, accent: 1, blend: 2 } as const;

/** Nothing nearer the eye than this is drawn: a line that crosses it is cut there. */
const NEAREST = 0.05;

export class Batch {
  data: Float32Array;
  /** Vertices written since the last reset. */
  count = 0;
  /** Distance from the eye to the picture plane, in CSS pixels: what turns a width in pixels into a width in the scene. */
  focal = 1;
  #corners = new Float32Array(24);
  #tex = 0;
  #tint = 0;
  #seed = 0;

  constructor(vertices = 4096) {
    this.data = new Float32Array(vertices * STRIDE);
  }

  reset(): void {
    this.count = 0;
  }

  /** What the triangles emitted next are made of. */
  material(tex: number, tint: number, seed = 0): void {
    this.#tex = tex;
    this.#tint = tint;
    this.#seed = seed;
  }

  corner(index: 0 | 1 | 2 | 3, x: number, y: number, z: number, u: number, v: number, shade: number): void {
    const at = index * 6;
    const c = this.#corners;
    c[at] = x; c[at + 1] = y; c[at + 2] = z; c[at + 3] = u; c[at + 4] = v; c[at + 5] = shade;
  }

  #emit(index: number): void {
    if ((this.count + 1) * STRIDE > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const from = index * 6;
    const to = this.count * STRIDE;
    const c = this.#corners;
    const d = this.data;
    d[to] = c[from]!; d[to + 1] = c[from + 1]!; d[to + 2] = c[from + 2]!;
    d[to + 3] = c[from + 3]!; d[to + 4] = c[from + 4]!; d[to + 5] = c[from + 5]!;
    d[to + 6] = this.#tex; d[to + 7] = this.#tint; d[to + 8] = this.#seed;
    this.count++;
  }

  /** The four corners, in order around the quad. */
  quad(): void {
    this.#emit(0); this.#emit(1); this.#emit(2);
    this.#emit(0); this.#emit(2); this.#emit(3);
  }

  /** A square facing the viewer, its texture running from 0 to 1 across it. */
  sprite(x: number, y: number, z: number, half: number, shade: number): void {
    this.corner(0, x - half, y - half, z, 0, 0, shade);
    this.corner(1, x + half, y - half, z, 1, 0, shade);
    this.corner(2, x + half, y + half, z, 1, 1, shade);
    this.corner(3, x - half, y + half, z, 0, 1, shade);
    this.quad();
  }

  /**
   * A stroke between two points, as wide on screen wherever it is: `width` in
   * CSS pixels, with a pixel of room on each side for its edge to fade in. The
   * shade runs from one end to the other. The part behind the eye is cut off.
   */
  stroke(tex: number, tint: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, shade0: number, shade1 = shade0): void {
    if (z0 < NEAREST && z1 < NEAREST) return;
    if (z0 < NEAREST) {
      const cut = (NEAREST - z0) / (z1 - z0);
      x0 += (x1 - x0) * cut; y0 += (y1 - y0) * cut; shade0 += (shade1 - shade0) * cut; z0 = NEAREST;
    } else if (z1 < NEAREST) {
      const cut = (NEAREST - z1) / (z0 - z1);
      x1 += (x0 - x1) * cut; y1 += (y0 - y1) * cut; shade1 += (shade0 - shade1) * cut; z1 = NEAREST;
    }
    // Across the stroke as the screen sees it, then back to the depth of each end.
    let ax = y0 / z0 - y1 / z1, ay = x1 / z1 - x0 / z0;
    const length = Math.hypot(ax, ay);
    if (length < 1e-9) return;
    const half = width / 2 + 1;
    ax *= half / (length * this.focal); ay *= half / (length * this.focal);
    this.material(tex, tint, width / 2);
    this.corner(0, x0 - ax * z0, y0 - ay * z0, z0, 0, 0, shade0);
    this.corner(1, x0 + ax * z0, y0 + ay * z0, z0, 1, 0, shade0);
    this.corner(2, x1 + ax * z1, y1 + ay * z1, z1, 1, 1, shade1);
    this.corner(3, x1 - ax * z1, y1 - ay * z1, z1, 0, 1, shade1);
    this.quad();
  }

  /** A disc of `radius` CSS pixels, whatever its depth. */
  dot(tint: number, x: number, y: number, z: number, radius: number, shade: number): void {
    if (z < NEAREST) return;
    this.material(TEX.dot, tint, radius);
    this.sprite(x, y, z, ((radius + 1) * z) / this.focal, shade);
  }

  /** The whole screen at once, for a texture that works out each pixel from where it is. */
  screen(tex: number, width: number, height: number): void {
    const x = width / 2 / this.focal, y = height / 2 / this.focal;
    this.material(tex, TINT.text);
    this.corner(0, -x, -y, 1, 0, 0, 1);
    this.corner(1, x, -y, 1, 1, 0, 1);
    this.corner(2, x, y, 1, 1, 1, 1);
    this.corner(3, -x, y, 1, 0, 1, 1);
    this.quad();
  }
}
