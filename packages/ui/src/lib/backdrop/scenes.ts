/*
 * The three scenes behind the empty new thread screen, in the manner of a
 * console of the early 2000s: few polygons, flat light, procedural textures,
 * fog that eats the far end. A scene is a function of the time alone, so the
 * motion is as smooth as the screen refreshes and a still frame can be drawn
 * at any moment for a device that asked for reduced motion.
 *
 * Brightness doubles as opacity: a scene draws in the theme's text colour and
 * accent over whatever ground the theme has, and what the fog eats shows that
 * ground.
 */

import { markFeature } from '@boite/contracts';
import { Batch, TEX, TINT } from './batch';
import { clamp, hash, TAU, wrap } from './math';

markFeature('boite-feature:draft-backdrop');

export type SceneId = 'glyphs' | 'crates' | 'tunnel';

export interface Frame {
  /** Opaque triangles: the nearest one wins a pixel. */
  solid: Batch;
  /** Triangles laid over what is behind them, emitted from far to near. */
  soft: Batch;
  /** Seconds since the scene began. */
  time: number;
  /** Where the pointer leans the view, each from -1 to 1 and eased. */
  leanX: number;
  leanY: number;
  /** Distance from the eye to the picture plane, in CSS pixels. */
  focal: number;
}

export interface Scene {
  /**
   * CSS pixels per drawn pixel: above 1 the frame is drawn small and stretched
   * smooth, the soft picture of the era. 0 draws at the screen's own density.
   */
  pixel(width: number, height: number): number;
  focal(width: number, height: number): number;
  /** How much the middle of the frame, where the heading and the composer sit, is quietened. */
  calm: number;
  /** Brightness steps, cut through an ordered dither. 0 leaves brightness whole. */
  levels: number;
  draw(frame: Frame): void;
}

/** The characters of the glyph tunnel, in the order the renderer lays them in its atlas. */
export const GLYPHS = '01<>[]{}/\\=+*#%$&@;:';

/** The line a tube winds along, by distance down it. */
const pathX = (z: number) => Math.sin(z * 0.21) * 0.9;
const pathY = (z: number) => Math.cos(z * 0.17) * 0.6;

const soften = (width: number, height: number) => clamp(Math.sqrt(width * height) / 440, 1.5, 2);
const wideFocal = (width: number, height: number) => Math.max(width * 0.55, height * 0.7);

// ---------------------------------------------------------------------------
// Tunnel: a twelve-sided tube with a dim checker on its walls, a hoop of light
// at an accent gate every eight rings that lights the panels beside it, air
// that takes the accent with the distance, lamps set in the panels, streaks
// of light passing the viewer and a glow at the far end.

const TUNNEL_RINGS = 26;
const TUNNEL_SIDES = 12;
const TUNNEL_GAP = 0.55;
const TUNNEL_RADIUS = 1.15;
const TUNNEL_FOG = 12.5;
/** How much of its light a gate throws on the panel next to it. */
const SPILL = 0.2;
/** How much accent the far air holds. */
const HAZE = 0.2;
// A ring's corners, then the middle of the ring.
const RING_MIDDLE = (TUNNEL_SIDES + 1) * 2;
const ringA = new Float32Array(RING_MIDDLE + 2);
const ringB = new Float32Array(RING_MIDDLE + 2);

const tunnelHaze = (z: number) => HAZE * clamp((z - 1.5) / 5);
const tunnelFog = (z: number) => Math.pow(Math.max(0, 1 - z / TUNNEL_FOG), 1.7) * clamp(z * 0.55);

function tunnel({ solid, soft, time, leanX, leanY }: Frame): void {
  const run = time * 1.1, part = run % 1, base = Math.floor(run);
  const hereX = pathX(run * 0.5), hereY = pathY(run * 0.5);
  // The whole tube rolls slowly, and leans with the pointer.
  const roll = Math.sin(time * 0.11) * 0.14 + leanX * 0.05;
  const cos = Math.cos(roll), sin = Math.sin(roll);
  const shiftX = -leanX * 0.35, shiftY = leanY * 0.2;

  const ring = (into: Float32Array, k: number) => {
    const turns = k + base;
    const cx = pathX(turns * 0.5) - hereX, cy = pathY(turns * 0.5) - hereY;
    for (let s = 0; s <= TUNNEL_SIDES; s++) {
      const angle = (s / TUNNEL_SIDES) * TAU + turns * 0.05;
      const x = cx + Math.cos(angle) * TUNNEL_RADIUS, y = cy + Math.sin(angle) * TUNNEL_RADIUS;
      into[s * 2] = x * cos - y * sin + shiftX;
      into[s * 2 + 1] = x * sin + y * cos + shiftY;
    }
    into[RING_MIDDLE] = cx * cos - cy * sin + shiftX;
    into[RING_MIDDLE + 1] = cx * sin + cy * cos + shiftY;
  };

  let far = ringA, near = ringB;
  ring(far, TUNNEL_RINGS);
  // The light at the end, which the bends of the tube hide and show.
  soft.material(TEX.glow, TINT.accent);
  soft.sprite(far[RING_MIDDLE]! * 0.7, far[RING_MIDDLE + 1]! * 0.7, TUNNEL_FOG * 0.8, 3.4, 0.5);
  for (let k = TUNNEL_RINGS - 1; k >= 0; k--) {
    ring(near, k);
    const turns = k + base;
    const zNear = 0.12 + (k - part) * TUNNEL_GAP, zFar = zNear + TUNNEL_GAP;
    const fogNear = tunnelFog(zNear), fogFar = tunnelFog(zFar);
    const gate = turns % 8 === 0;
    // A wave of light runs down the tube, faster than the viewer.
    const wave = Math.pow(Math.max(0, Math.sin(turns * 0.4 - time * 2.6)), 10) * 0.1;
    for (let s = 0; s < TUNNEL_SIDES; s++) {
      const ax = near[s * 2]!, ay = near[s * 2 + 1]!, bx = near[s * 2 + 2]!, by = near[s * 2 + 3]!;
      const cx = far[s * 2 + 2]!, cy = far[s * 2 + 3]!, dx = far[s * 2]!, dy = far[s * 2 + 1]!;
      const light = 0.4 + 0.6 * (0.5 + 0.5 * Math.cos(((s + 0.5) / TUNNEL_SIDES) * TAU - 4.2));
      const lamp = !gate && hash(s, turns, 3) > 0.94;
      const bright = (gate ? 0.8 : 0.17 + wave * 1.4) * light;
      solid.material(gate ? TEX.grid : TEX.checker, gate ? TINT.accent : TINT.text);
      solid.corner(0, ax, ay, zNear, 0, 0, bright * fogNear);
      solid.corner(1, bx, by, zNear, 2, 0, bright * fogNear);
      solid.corner(2, cx, cy, zFar, 2, 2, bright * fogFar);
      solid.corner(3, dx, dy, zFar, 0, 2, bright * fogFar);
      solid.quad();
      // A gate lights the panels on either side of it, less with each ring,
      // and the air of the tube takes the accent with the distance.
      const phase = turns % 8;
      const spillNear = SPILL * Math.exp(-1.2 * Math.min(phase - 1, 8 - phase)) + tunnelHaze(zNear);
      const spillFar = SPILL * Math.exp(-1.2 * Math.min(phase, 7 - phase)) + tunnelHaze(zFar);
      if (!gate) {
        soft.material(TEX.flat, TINT.accent);
        soft.corner(0, ax, ay, zNear, 0, 0, spillNear * light * fogNear);
        soft.corner(1, bx, by, zNear, 1, 0, spillNear * light * fogNear);
        soft.corner(2, cx, cy, zFar, 1, 1, spillFar * light * fogFar);
        soft.corner(3, dx, dy, zFar, 0, 1, spillFar * light * fogFar);
        soft.quad();
      }
      if (lamp) {
        // A lamp set in the panel, and the pool of light it throws around it:
        // the panel shrunk, then grown, about its middle, each lifted off the
        // wall toward the axis.
        const mx = (ax + bx + cx + dx) / 4, my = (ay + by + cy + dy) / 4, mz = (zNear + zFar) / 2;
        const ox = (near[RING_MIDDLE]! + far[RING_MIDDLE]!) / 2, oy = (near[RING_MIDDLE + 1]! + far[RING_MIDDLE + 1]!) / 2;
        // A lamp about to pass the eye dims, so it never fills a corner of the screen.
        const lit = light * tunnelFog(mz) * clamp((mz - 0.9) / 1.8);
        const panel = (batch: Batch, size: number, deep: number, lift: number, shade: number) => {
          const place = (index: 0 | 1 | 2 | 3, x: number, y: number, z: number, u: number, v: number) =>
            batch.corner(index, ox + (mx + (x - mx) * size - ox) * lift, oy + (my + (y - my) * size - oy) * lift, z, u, v, shade);
          const reach = (TUNNEL_GAP / 2) * deep;
          place(0, ax, ay, mz - reach, 0, 0);
          place(1, bx, by, mz - reach, 1, 0);
          place(2, cx, cy, mz + reach, 1, 1);
          place(3, dx, dy, mz + reach, 0, 1);
          batch.quad();
        };
        // Both laid over the wall: a lamp that dims must show the wall, not a hole in it.
        soft.material(TEX.glow, TINT.accent);
        panel(soft, 2.6, 2.6, 0.95, 0.36 * lit);
        soft.material(TEX.flat, TINT.blend);
        panel(soft, 0.4, 0.34, 0.985, 0.85 * lit);
      }
      if (gate) {
        // The hoop of light at the mouth of a gate, a band just off the wall.
        const ox = near[RING_MIDDLE]!, oy = near[RING_MIDDLE + 1]!, lift = 0.965, shade = 0.95 * fogNear;
        const hx = ox + (ax - ox) * lift, hy = oy + (ay - oy) * lift, ix = ox + (bx - ox) * lift, iy = oy + (by - oy) * lift;
        soft.material(TEX.beam, TINT.accent);
        soft.corner(0, hx, hy, zNear - 0.07, 0, 0, shade);
        soft.corner(1, hx, hy, zNear + 0.07, 1, 0, shade);
        soft.corner(2, ix, iy, zNear + 0.07, 1, 1, shade);
        soft.corner(3, ix, iy, zNear - 0.07, 0, 1, shade);
        soft.quad();
      }
    }
    const swap = far; far = near; near = swap;
  }

  // Streaks of light rushing past the viewer, each a thin strip along the tube.
  const depth = TUNNEL_RINGS * TUNNEL_GAP;
  for (let i = 0; i < 34; i++) {
    const speed = 2.2 + hash(i, 1, 6) * 3.5;
    const z0 = depth - wrap(hash(i, 2, 6) * depth + time * speed, depth) + 0.1, z1 = z0 + 0.5 + hash(i, 5, 6) * 0.9;
    const angle = hash(i, 3, 6) * TAU + time * 0.05, reach = TUNNEL_RADIUS * (0.3 + 0.6 * hash(i, 4, 6));
    const px = Math.cos(angle) * reach, py = Math.sin(angle) * reach, tx = -Math.sin(angle) * 0.012, ty = Math.cos(angle) * 0.012;
    const turn0 = (z0 / TUNNEL_GAP + run) * 0.5, turn1 = (z1 / TUNNEL_GAP + run) * 0.5;
    const x0 = pathX(turn0) - hereX + px, y0 = pathY(turn0) - hereY + py, x1 = pathX(turn1) - hereX + px, y1 = pathY(turn1) - hereY + py;
    const shade = 0.55 * tunnelFog(z0);
    soft.material(TEX.streak, i % 3 === 0 ? TINT.accent : i % 7 === 0 ? TINT.blend : TINT.text);
    soft.corner(0, (x0 - tx) * cos - (y0 - ty) * sin + shiftX, (x0 - tx) * sin + (y0 - ty) * cos + shiftY, z0, 0, 0, shade);
    soft.corner(1, (x0 + tx) * cos - (y0 + ty) * sin + shiftX, (x0 + tx) * sin + (y0 + ty) * cos + shiftY, z0, 1, 0, shade);
    soft.corner(2, (x1 + tx) * cos - (y1 + ty) * sin + shiftX, (x1 + tx) * sin + (y1 + ty) * cos + shiftY, z1, 1, 1, shade);
    soft.corner(3, (x1 - tx) * cos - (y1 - ty) * sin + shiftX, (x1 - tx) * sin + (y1 - ty) * cos + shiftY, z1, 0, 1, shade);
    soft.quad();
  }
}

// ---------------------------------------------------------------------------
// Crates: boxes tumbling toward the viewer on a spiral, through dust. A face
// is a bright frame and a brace over planks left almost clear, so a crate
// reads as an open frame and never as a slab; it fades before it fills a corner.

const CUBE_CORNERS = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
const CUBE_FACES = [0, 1, 2, 3, 5, 4, 7, 6, 4, 0, 3, 7, 1, 5, 6, 2, 3, 2, 6, 7, 4, 5, 1, 0];
const CRATE_COUNT = 44;
const CRATE_DEPTH = 16;
const turned = new Float32Array(24);
// Where the light comes from, and the same for the gleam: up, left and behind the viewer.
const LIGHT_X = -0.45, LIGHT_Y = 0.7, LIGHT_Z = -0.55;

function crate(solid: Batch, cx: number, cy: number, cz: number, half: number, tiltX: number, tiltY: number, tint: number, bright: number, seed: number): void {
  const ca = Math.cos(tiltX), sa = Math.sin(tiltX), cb = Math.cos(tiltY), sb = Math.sin(tiltY);
  for (let i = 0; i < 8; i++) {
    const x = CUBE_CORNERS[i * 3]!, y = CUBE_CORNERS[i * 3 + 1]!, z = CUBE_CORNERS[i * 3 + 2]!;
    const y1 = y * ca - z * sa, z1 = y * sa + z * ca;
    turned[i * 3] = cx + (x * cb + z1 * sb) * half;
    turned[i * 3 + 1] = cy + y1 * half;
    turned[i * 3 + 2] = cz + (-x * sb + z1 * cb) * half;
  }
  solid.material(TEX.crate, tint, seed);
  for (let f = 0; f < 6; f++) {
    const a = CUBE_FACES[f * 4]! * 3, b = CUBE_FACES[f * 4 + 1]! * 3, c = CUBE_FACES[f * 4 + 2]! * 3, d = CUBE_FACES[f * 4 + 3]! * 3;
    const mx = (turned[a]! + turned[c]!) / 2, my = (turned[a + 1]! + turned[c + 1]!) / 2, mz = (turned[a + 2]! + turned[c + 2]!) / 2;
    const nx = (mx - cx) / half, ny = (my - cy) / half, nz = (mz - cz) / half;
    // A face turned away from the eye.
    if (nx * mx + ny * my + nz * mz >= 0) continue;
    // A gleam where the face mirrors the light into the eye: it flashes as the crate turns.
    const far = Math.hypot(mx, my, mz) || 1;
    let hx = LIGHT_X - mx / far, hy = LIGHT_Y - my / far, hz = LIGHT_Z - mz / far;
    const hl = Math.hypot(hx, hy, hz) || 1;
    hx /= hl; hy /= hl; hz /= hl;
    const gleam = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 18) * 0.5;
    const lit = (0.36 + 0.72 * Math.max(0, nx * LIGHT_X + ny * LIGHT_Y + nz * LIGHT_Z) + gleam) * bright;
    solid.corner(0, turned[a]!, turned[a + 1]!, turned[a + 2]!, 0, 0, lit * 1.15);
    solid.corner(1, turned[b]!, turned[b + 1]!, turned[b + 2]!, 1, 0, lit * 1.15);
    solid.corner(2, turned[c]!, turned[c + 1]!, turned[c + 2]!, 1, 1, lit * 0.8);
    solid.corner(3, turned[d]!, turned[d + 1]!, turned[d + 2]!, 0, 1, lit * 0.8);
    solid.quad();
  }
}

function crates({ solid, soft, time, leanX, leanY }: Frame): void {
  const shiftX = -leanX * 0.5, shiftY = leanY * 0.25;

  // Far lights that twinkle, the ground the crates cross.
  for (let k = 0; k < 70; k++) {
    const twinkle = 0.55 + 0.45 * Math.sin(time * (1 + hash(k, 5, 7) * 2) + k);
    soft.material(TEX.glow, k % 5 === 0 ? TINT.accent : TINT.text);
    soft.sprite((hash(k, 1, 7) - 0.5) * 30 + shiftX * 0.4, (hash(k, 3, 7) - 0.5) * 18 + shiftY * 0.4, 13.5 + hash(k, 2, 7) * 2, 0.06 + hash(k, 6, 7) * 0.08, (0.35 + 0.5 * hash(k, 4, 7)) * twinkle);
  }

  for (let i = 0; i < CRATE_COUNT; i++) {
    const z = wrap(hash(i, 1, 5) * CRATE_DEPTH - time * (0.8 + hash(i, 2, 5) * 0.5), CRATE_DEPTH) + 0.5;
    const fog = Math.pow(Math.max(0, 1 - z / (CRATE_DEPTH * 0.85)), 1.5) * clamp((z - 1.5) / 2.1);
    if (fog <= 0.01) continue;
    const angle = hash(i, 3, 5) * TAU + time * 0.06 + z * 0.16, reach = 1.35 + hash(i, 4, 5) * 2.1;
    const x = Math.cos(angle) * reach + shiftX, y = Math.sin(angle) * reach * 0.78 + shiftY, half = 0.26 + hash(i, 5, 5) * 0.3;
    const tint = i % 4 === 0 ? TINT.accent : i % 7 === 0 ? TINT.blend : TINT.text;
    if (tint !== TINT.text) {
      // A coloured crate glows a little: the halo sits behind it.
      soft.material(TEX.glow, tint);
      soft.sprite(x, y, z + half, half * 3.6, 0.26 * fog);
    }
    crate(solid, x, y, z, half, time * (0.3 + hash(i, 6, 5) * 0.7) + i, time * (0.25 + hash(i, 7, 5) * 0.6) + i * 2, tint, 0.9 * fog, i);
  }

  // Dust carried by the same current, soft and large when it brushes the eye.
  for (let k = 0; k < 36; k++) {
    const z = wrap(hash(k, 1, 8) * CRATE_DEPTH - time * (1.3 + hash(k, 2, 8) * 1.2), CRATE_DEPTH) + 0.35;
    const fade = Math.pow(Math.max(0, 1 - z / (CRATE_DEPTH * 0.8)), 1.3) * clamp((z - 0.35) / 1.2);
    const angle = hash(k, 3, 8) * TAU + z * 0.12, reach = 0.5 + hash(k, 4, 8) * 3.2;
    soft.material(TEX.glow, k % 4 === 0 ? TINT.accent : TINT.text);
    soft.sprite(Math.cos(angle) * reach + shiftX, Math.sin(angle) * reach * 0.8 + shiftY, z, 0.025 + hash(k, 5, 8) * 0.02, 0.5 * fade);
  }
}

// ---------------------------------------------------------------------------
// Glyphs: the tube written in characters, with streams racing to its far end.

const GLYPH_RINGS = 30;
const GLYPH_SIDES = 34;
const GLYPH_GAP = 0.44;
/** The height of a character in its atlas cell, as a share of the cell. */
export const GLYPH_INK = 0.7;
const GLYPH_STREAM = 34;

function glyphs({ soft, time, leanX, leanY, focal }: Frame): void {
  const run = time * 0.7, part = run % 1, base = Math.floor(run);
  const hereX = pathX(run * 0.5), hereY = pathY(run * 0.5);
  const roll = Math.sin(time * 0.09) * 0.1;
  const cos = Math.cos(roll), sin = Math.sin(roll);
  const shiftX = -leanX * 0.4, shiftY = leanY * 0.2;
  for (let k = GLYPH_RINGS - 1; k >= -1; k--) {
    const z = 0.7 + (k - part) * GLYPH_GAP;
    if (z < 0.08) continue;
    const turns = k + base, cx = pathX(turns * 0.5) - hereX, cy = pathY(turns * 0.5) - hereY;
    const fog = Math.max(0, 1 - z / 13) * clamp(z * 0.9);
    // A character keeps a readable size far away and stops growing up close.
    // The atlas draws it at GLYPH_INK of its cell, so the square is that much larger.
    const half = (clamp((0.084 * focal) / z, 7, 26) * z) / focal / 2 / GLYPH_INK;
    for (let s = 0; s < GLYPH_SIDES; s++) {
      const angle = (s / GLYPH_SIDES) * TAU + turns * 0.04;
      const px = cx + Math.cos(angle) * 1.05, py = cy + Math.sin(angle) * 1.05;
      const x = px * cos - py * sin + shiftX, y = px * sin + py * cos + shiftY;
      // Each side carries a stream: a head, lit in the accent, and nine rings of trail.
      const head = time * (1.6 + hash(s, 0, 9) * 3) + hash(s, 1, 9) * GLYPH_STREAM;
      const behind = wrap(head - turns, GLYPH_STREAM);
      const trail = behind < 9 ? 1 - behind / 9 : 0;
      const hot = behind < 1 ? 1 - behind : behind > GLYPH_STREAM - 1 ? behind - (GLYPH_STREAM - 1) : 0;
      const glyph = Math.floor(hash(s, turns, Math.floor(time * (trail ? 5 : 0.3) + s)) * GLYPHS.length);
      if (hot > 0) {
        soft.material(TEX.glow, TINT.accent);
        soft.sprite(x, y, z, half * 2.6, 0.4 * hot * fog);
      }
      soft.material(TEX.glyph, trail ? TINT.blend : TINT.text, glyph);
      soft.sprite(x, y, z, half, Math.min(1, (0.3 + 0.65 * trail) * (1 - hot) * fog));
      if (hot > 0) {
        soft.material(TEX.glyph, TINT.accent, glyph);
        soft.sprite(x, y, z, half, Math.min(1, hot * fog));
      }
    }
  }
}

export const SCENES: Record<SceneId, Scene> = {
  tunnel: { pixel: soften, focal: wideFocal, calm: 0.75, levels: 63, draw: tunnel },
  crates: { pixel: soften, focal: wideFocal, calm: 0.8, levels: 63, draw: crates },
  glyphs: { pixel: () => 0, focal: (width, height) => Math.max(width * 0.32, height * 0.36), calm: 0.75, levels: 0, draw: glyphs }
};
