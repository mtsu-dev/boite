/*
 * The scenes behind the empty new thread screen: line art on the theme's own
 * ground, thin strokes, points and characters, each built around the middle of
 * the screen where the heading and the composer sit, and dark enough to stay
 * behind them. A scene is a function of the time alone, so the motion is as
 * smooth as the screen refreshes and a still frame can be drawn at any moment
 * for a device that asked for reduced motion.
 *
 * Brightness is opacity: a scene draws in the theme's text colour and accent
 * over whatever ground the theme has.
 */

import { markFeature } from '@boite/contracts';
import { Batch, TEX, TINT } from './batch';
import { clamp, hash, TAU, wrap } from './math';

markFeature('boite-feature:draft-backdrop');

export type SceneId = 'tunnel' | 'glyphs' | 'relief' | 'crates';

export interface Frame {
  /** The triangles of the frame, each laid over the ones before it. */
  batch: Batch;
  /** Seconds since the scene began. */
  time: number;
  /** Where the pointer leans the view, each from -1 to 1 and eased. */
  leanX: number;
  leanY: number;
  /** Distance from the eye to the picture plane, in CSS pixels. */
  focal: number;
  /** The screen, in CSS pixels. */
  width: number;
  height: number;
  /** Eight sets of four numbers for a texture that fills the screen: what its shader reads. */
  data: Float32Array;
}

export interface Scene {
  focal(width: number, height: number): number;
  /** How much the oval around the heading is quietened. */
  calm: number;
  draw(frame: Frame): void;
}

// ---------------------------------------------------------------------------
// Tunnel: a tube of thin rings flown through, its far end held behind the
// middle of the screen while the tube bends on the way there. One ring in
// eight is a gate in the accent, and lights race down the lines toward the end.

const TUNNEL_RINGS = 38;
const TUNNEL_SIDES = 36;
const TUNNEL_GAP = 0.5;
const TUNNEL_RADIUS = 1.3;
const TUNNEL_REACH = 16;
/** How far down the tube the eye looks: the last rings bright enough to be seen. */
export const TUNNEL_AIM = 10;
const TUNNEL_STREAM = 46;
const ringA = new Float32Array((TUNNEL_SIDES + 1) * 2);
const ringB = new Float32Array((TUNNEL_SIDES + 1) * 2);

/** The line the tube winds along, by rings down it. */
const bendX = (ring: number) => Math.sin(ring * 0.105) * 0.5 + Math.sin(ring * 0.27) * 0.12;
const bendY = (ring: number) => Math.cos(ring * 0.083) * 0.34;

function tunnel({ batch, time, leanX, leanY }: Frame): void {
  const run = time * 0.9, part = run % 1, base = Math.floor(run);
  const depth = (k: number) => 0.3 + (k - part) * TUNNEL_GAP;
  const fog = (z: number) => Math.pow(clamp(1 - z / TUNNEL_REACH), 1.7) * clamp((z - 0.3) / 0.7);
  const hereX = bendX(run), hereY = bendY(run);
  // The eye looks at the last rings to be seen, so that end stays put and the bends show on the way. It aims at a depth, not at
  // a ring: a ring would be another one each time the nearest passes, and the whole picture would step sideways.
  const end = run + (TUNNEL_AIM - 0.3) / TUNNEL_GAP;
  const aimX = (bendX(end) - hereX) / TUNNEL_AIM, aimY = (bendY(end) - hereY) / TUNNEL_AIM;
  const shiftX = -leanX * 0.1, shiftY = leanY * 0.06;

  const ring = (into: Float32Array, k: number) => {
    const turns = k + base, z = depth(k);
    const cx = bendX(turns) - hereX - aimX * z + shiftX, cy = bendY(turns) - hereY - aimY * z + shiftY;
    for (let s = 0; s <= TUNNEL_SIDES; s++) {
      const around = (s / TUNNEL_SIDES) * TAU;
      // A wall that swells and narrows a little, so no two rings are the same circle.
      const radius = TUNNEL_RADIUS * (1 + 0.07 * Math.sin(around * 3 + turns * 0.55) + 0.05 * Math.sin(around * 5 - turns * 0.38));
      const angle = around + turns * 0.03;
      into[s * 2] = cx + Math.cos(angle) * radius;
      into[s * 2 + 1] = cy + Math.sin(angle) * radius;
    }
  };

  let far = ringA, near = ringB;
  ring(far, TUNNEL_RINGS);
  for (let k = TUNNEL_RINGS - 1; k >= 0; k--) {
    ring(near, k);
    const turns = k + base, zNear = depth(k), zFar = zNear + TUNNEL_GAP;
    const fogNear = fog(zNear), fogFar = fog(zFar);
    const gate = turns % 8 === 0;
    for (let s = 0; s < TUNNEL_SIDES; s++) {
      const ax = near[s * 2]!, ay = near[s * 2 + 1]!, bx = near[s * 2 + 2]!, by = near[s * 2 + 3]!;
      if (gate) {
        batch.stroke(TEX.beam, TINT.accent, ax, ay, zNear, bx, by, zNear, 12, 0.2 * fogNear);
        batch.stroke(TEX.line, TINT.accent, ax, ay, zNear, bx, by, zNear, 1.5, 0.7 * fogNear);
      } else {
        batch.stroke(TEX.line, TINT.text, ax, ay, zNear, bx, by, zNear, 1, 0.2 * fogNear);
      }
      if (s % 3 !== 0) continue;
      const dx = far[s * 2]!, dy = far[s * 2 + 1]!;
      batch.stroke(TEX.line, TINT.text, ax, ay, zNear, dx, dy, zFar, 1, 0.12 * fogNear, 0.12 * fogFar);
      batch.dot(gate ? TINT.accent : TINT.text, ax, ay, zNear, 1.2, (gate ? 0.9 : 0.3) * fogNear);
      // A light racing to the far end along this line, its trail behind it.
      if (hash(s, 1, 4) < 0.45) continue;
      const behind = wrap(time * (5 + hash(s, 2, 4) * 7) + hash(s, 3, 4) * TUNNEL_STREAM - turns, TUNNEL_STREAM);
      if (behind >= 7) continue;
      const trail = 1 - behind / 7, before = Math.max(0, trail - 1 / 7);
      batch.stroke(TEX.line, behind < 2 ? TINT.accent : TINT.blend, ax, ay, zNear, dx, dy, zFar, 1.5, 0.8 * before * fogNear, 0.8 * trail * fogFar);
    }
    const swap = far; far = near; near = swap;
  }
}

// ---------------------------------------------------------------------------
// Crates: a belt of small wire boxes turning slowly around the middle of the
// screen, on faint orbits, in a dust that draws the belt's oval.

const CRATE_COUNT = 30;
const CRATE_AWAY = 14;
const CUBE_CORNERS = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
const CUBE_EDGES = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
const turned = new Float32Array(24);
const ORBITS = [0.74, 1, 1.27];
const ORBIT_STEPS = 96;

function crates({ batch, time, leanX, leanY, focal, width, height }: Frame): void {
  // The belt reaches most of the way to the sides, and is tilted to stand as tall as the screen lets it.
  const across = Math.min(width * 0.45, 640);
  const radius = (across * CRATE_AWAY) / focal;
  const tilt = Math.asin(clamp((height * 0.31) / across, 0.3, 0.9)) + 0.04 * Math.sin(time * 0.07) + leanY * 0.05;
  const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
  const roll = 0.07 * Math.sin(time * 0.05) + leanX * 0.04;
  const cosR = Math.cos(roll), sinR = Math.sin(roll);
  // The near side of a tilted ring looks larger than the far one: this much of it is taken back, so its oval sits on the middle.
  const lean = (radius * sinT * radius * cosT) / (CRATE_AWAY * CRATE_AWAY - radius * radius * cosT * cosT);
  let px = 0, py = 0, pz = 0;
  /** A place on the belt, by its share of the radius, its angle and its height off the plane. */
  const place = (share: number, angle: number, lift: number) => {
    const x = Math.cos(angle) * share * radius, back = Math.sin(angle) * share * radius;
    pz = CRATE_AWAY + back * cosT - lift * sinT;
    const y = lift * cosT + back * sinT + lean * pz;
    px = x * cosR - y * sinR; py = x * sinR + y * cosR;
  };
  /** The far side of the belt is dimmer than the near one. */
  const lit = (z: number) => 1 - 0.72 * clamp((z - CRATE_AWAY + radius) / (2 * radius));

  for (const share of ORBITS) {
    place(share, 0, 0);
    for (let step = 1; step <= ORBIT_STEPS; step++) {
      const fx = px, fy = py, fz = pz;
      place(share, (step / ORBIT_STEPS) * TAU, 0);
      batch.stroke(TEX.line, TINT.text, fx, fy, fz, px, py, pz, 1, 0.11 * lit(fz), 0.11 * lit(pz));
    }
  }

  for (let k = 0; k < 420; k++) {
    const share = 0.5 + hash(k, 1, 8) * 1.05;
    place(share, hash(k, 2, 8) * TAU + (time * 0.05) / Math.pow(share, 1.5), (hash(k, 3, 8) - 0.5) * hash(k, 4, 8) * radius * 0.16);
    batch.dot(k % 6 === 0 ? TINT.accent : TINT.text, px, py, pz, 0.7 + hash(k, 5, 8) * 0.8, (0.16 + 0.4 * hash(k, 6, 8)) * lit(pz));
  }

  for (let i = 0; i < CRATE_COUNT; i++) {
    const share = 0.7 + hash(i, 1, 5) * 0.62;
    place(share, hash(i, 2, 5) * TAU + (time * 0.06) / Math.pow(share, 1.5), (hash(i, 3, 5) - 0.5) * radius * 0.2);
    const cx = px, cy = py, cz = pz, light = lit(cz);
    const half = ((8 + hash(i, 4, 5) * 17) * CRATE_AWAY) / focal;
    const tint = i % 4 === 0 ? TINT.accent : i % 7 === 0 ? TINT.blend : TINT.text;
    const tiltX = time * (0.12 + hash(i, 6, 5) * 0.3) + i, tiltY = time * (0.1 + hash(i, 7, 5) * 0.26) + i * 2;
    const ca = Math.cos(tiltX), sa = Math.sin(tiltX), cb = Math.cos(tiltY), sb = Math.sin(tiltY);
    for (let c = 0; c < 8; c++) {
      const x = CUBE_CORNERS[c * 3]!, y = CUBE_CORNERS[c * 3 + 1]!, z = CUBE_CORNERS[c * 3 + 2]!;
      const y1 = y * ca - z * sa, z1 = y * sa + z * ca;
      turned[c * 3] = cx + (x * cb + z1 * sb) * half;
      turned[c * 3 + 1] = cy + y1 * half;
      turned[c * 3 + 2] = cz + (-x * sb + z1 * cb) * half;
    }
    if (tint !== TINT.text) {
      batch.material(TEX.glow, tint);
      batch.sprite(cx, cy, cz, half * 3.2, 0.13 * light);
    }
    const bright = (tint === TINT.text ? 0.4 : 0.8) * light;
    for (let e = 0; e < 12; e++) {
      const a = CUBE_EDGES[e * 2]! * 3, b = CUBE_EDGES[e * 2 + 1]! * 3;
      // The edges of the far half are fainter, which is enough to read the box as a solid.
      const back = turned[a + 2]! + turned[b + 2]! > cz * 2;
      batch.stroke(TEX.line, tint, turned[a]!, turned[a + 1]!, turned[a + 2]!, turned[b]!, turned[b + 1]!, turned[b + 2]!, 1.2, bright * (back ? 0.38 : 1));
    }
  }
}

// ---------------------------------------------------------------------------
// Relief: the contour lines of a few hills that drift around a summit held
// under the middle of the screen, one line in four in the accent. The shader
// draws the lines; the hills are worked out here.

const HILLS = 7;

/** How fast the hills around come back away from the summit, as the shader counts it, and how much they may weigh on it. */
export const RELIEF_FADE = 3;
const RELIEF_CROWD = 0.4;

function relief({ batch, time, width, height, leanX, leanY, data }: Frame): void {
  const size = Math.sqrt(width * height);
  // One wide rise the lines ring; the others wander around it.
  data[0] = 0; data[1] = 0; data[2] = size * 0.56; data[3] = 1.7;
  for (let i = 1; i < HILLS; i++) {
    const around = hash(i, 1, 11) * TAU + time * (0.011 + hash(i, 2, 11) * 0.014) * (i % 2 ? 1 : -1);
    const reach = 0.24 + 0.3 * hash(i, 3, 11) + 0.06 * Math.sin(time * 0.05 + i);
    data[i * 4] = Math.cos(around) * reach * width * 1.05;
    data[i * 4 + 1] = Math.sin(around * 1.3 + i) * reach * height * 1.05;
    data[i * 4 + 2] = size * (0.17 + 0.15 * hash(i, 4, 11));
    data[i * 4 + 3] = (0.3 + 0.3 * hash(i, 5, 11) + 0.1 * Math.sin(time * 0.09 + i * 2)) * (i % 3 === 0 ? -1 : 1);
  }
  // The shader fades the hills around out toward the summit, which keeps it under the composer as long as they
  // weigh less there than the wide rise bends: a crowd of them is lowered together.
  let crowd = 0;
  for (let i = 1; i < HILLS; i++) crowd += data[i * 4 + 3]! * Math.exp(-(data[i * 4]! ** 2 + data[i * 4 + 1]! ** 2) / data[i * 4 + 2]! ** 2);
  const lower = crowd > RELIEF_CROWD ? RELIEF_CROWD / crowd : 1;
  for (let i = 0; i < HILLS; i++) {
    data[i * 4] = data[i * 4]! - leanX * 14;
    data[i * 4 + 1] = data[i * 4 + 1]! + leanY * 10;
    if (i > 0) data[i * 4 + 3] = data[i * 4 + 3]! * lower;
  }
  // The lines creep outward from the summits; four of them make a whole turn of the accent.
  data[28] = wrap(-time * 0.045, 4);
  batch.screen(TEX.contour, width, height);
}

// ---------------------------------------------------------------------------
// Glyphs: a tunnel drawn in characters, as a terminal would draw one. The
// grid of characters stands still and upright; what moves is the picture they
// shade, rushing out from the middle, and streams of code falling into it.

/** The characters the renderer lays in its atlas: nine that shade from light to dense, then ten of code. */
export const GLYPHS = '.:-=+*#%@01<>[]{}/\\';
export const GLYPH_SHADES = 9;

function glyphs({ batch, time, width, height, data }: Frame): void {
  // Each as an angle already folded, so an hour in the picture is as fine as its first second.
  data[0] = wrap(time * 0.5, TAU * 4);
  data[1] = wrap(time * 0.11, TAU);
  data[2] = wrap(time * 0.23, TAU);
  data[3] = wrap(time * 0.015, TAU);
  data[4] = wrap(time, 4096);
  data[5] = Math.floor(wrap(time * 7, 4096));
  batch.screen(TEX.ascii, width, height);
}

export const SCENES: Record<SceneId, Scene> = {
  tunnel: { focal: (width, height) => Math.max(width, height) * 0.45, calm: 0.7, draw: tunnel },
  glyphs: { focal: () => 1, calm: 0.8, draw: glyphs },
  relief: { focal: () => 1, calm: 0.6, draw: relief },
  crates: { focal: (width, height) => Math.max(width, height) * 3, calm: 0.5, draw: crates }
};
