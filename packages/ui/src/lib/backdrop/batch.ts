/*
 * The triangles of one frame, as the renderer uploads them. A vertex is nine
 * numbers: its place in view space (x right, y up, z away from the viewer),
 * its texture coordinates, its brightness, then the material of its triangle:
 * texture, tint and a seed the texture may read.
 *
 * A scene fills up to four corners and emits them as a triangle or a quad, so
 * a frame allocates nothing: an array per vertex, sixty times a second, was a
 * garbage collection every few seconds and a visible hitch with each.
 */

import { markFeature } from '@boite/contracts';

markFeature('boite-feature:draft-backdrop');

export const STRIDE = 9;

/** The procedural textures the fragment shader draws, by the number a vertex carries. */
export const TEX = { flat: 0, checker: 1, crate: 2, grid: 3, glow: 4, glyph: 5, streak: 6, beam: 7 } as const;

/** The three colours a scene may use: the text colour, the accent and the accent turned toward blue. */
export const TINT = { text: 0, accent: 1, blend: 2 } as const;

export class Batch {
  data: Float32Array;
  /** Vertices written since the last reset. */
  count = 0;
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

  /** Corners 0, 1 and 2. */
  tri(): void {
    this.#emit(0); this.#emit(1); this.#emit(2);
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
}
