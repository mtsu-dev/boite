import { expect, test } from 'vitest';
import { Batch, STRIDE, TEX, TINT } from './batch';
import { themeTints, wrap } from './math';
import { SCENES, type Frame, type SceneId } from './scenes';

const IDS: SceneId[] = ['tunnel', 'glyphs', 'relief', 'crates'];
const WIDTH = 1400, HEIGHT = 900;

function drawn(id: SceneId, time: number, lean = 0): Frame {
  const batch = new Batch();
  const frame: Frame = { batch, time, leanX: lean, leanY: lean, focal: SCENES[id].focal(WIDTH, HEIGHT), width: WIDTH, height: HEIGHT, data: new Float32Array(32) };
  batch.focal = frame.focal;
  SCENES[id].draw(frame);
  return frame;
}

test('every scene fills whole triangles of finite numbers, in materials the shader knows', () => {
  const textures = Object.values(TEX) as number[];
  const tints = Object.values(TINT) as number[];
  for (const id of IDS) {
    for (const time of [0, 3, 61.7, 3600]) {
      const { batch, data } = drawn(id, time, 1);
      expect(batch.count, `${id} at ${time}`).toBeGreaterThan(0);
      expect(batch.count % 3).toBe(0);
      const used = batch.data.subarray(0, batch.count * STRIDE);
      expect(used.every(Number.isFinite), `${id} at ${time}`).toBe(true);
      expect(data.every(Number.isFinite), `${id} at ${time}`).toBe(true);
      for (let vertex = 0; vertex < batch.count; vertex++) {
        expect(textures).toContain(used[vertex * STRIDE + 6]);
        expect(tints).toContain(used[vertex * STRIDE + 7]);
      }
    }
  }
});

test('a scene is a function of its time: the still frame of reduced motion is the same every time', () => {
  for (const id of IDS) {
    const once = drawn(id, 3), again = drawn(id, 3);
    expect(again.batch.count).toBe(once.batch.count);
    expect(again.batch.data.subarray(0, again.batch.count * STRIDE)).toEqual(once.batch.data.subarray(0, once.batch.count * STRIDE));
    expect(again.data).toEqual(once.data);
  }
});

// The tunnel's far end followed its bends to a corner of the screen, away from the words it is drawn behind.
test('the tunnel ends behind the middle of the screen, however it bends on the way', () => {
  for (const time of [0, 3, 21.9, 61.7, 900]) {
    const { batch, focal } = drawn('tunnel', time);
    let farthest = 0;
    for (let vertex = 0; vertex < batch.count; vertex++) farthest = Math.max(farthest, batch.data[vertex * STRIDE + 2]!);
    let x = 0, y = 0, count = 0;
    for (let vertex = 0; vertex < batch.count; vertex++) {
      const z = batch.data[vertex * STRIDE + 2]!;
      if (z < farthest - 0.01) continue;
      x += (batch.data[vertex * STRIDE]! / z) * focal; y += (batch.data[vertex * STRIDE + 1]! / z) * focal; count++;
    }
    expect(count).toBeGreaterThan(30);
    expect(Math.hypot(x / count, y / count), `at ${time}`).toBeLessThan(4);
  }
});

test('the contours rise from under the middle of the screen', () => {
  const { data } = drawn('relief', 61.7);
  expect(Math.hypot(data[0]!, data[1]!)).toBe(0);
  // The middle rise is the tallest and the widest, so the lines ring it.
  for (let hill = 1; hill < 7; hill++) {
    expect(Math.abs(data[hill * 4 + 3]!)).toBeLessThan(data[3]!);
    expect(data[hill * 4 + 2]!).toBeLessThan(data[2]!);
  }
});

test('a stroke is as wide on screen at any depth, and stops at the eye instead of wrapping behind it', () => {
  const batch = new Batch();
  batch.focal = 500;
  for (const z of [0.5, 4, 30]) {
    batch.reset();
    batch.stroke(TEX.line, TINT.text, -1, 0.2, z, 1, 0.2, z, 3, 1);
    const across = ((batch.data[STRIDE + 1]! - batch.data[1]!) / z) * batch.focal;
    expect(Math.abs(across)).toBeCloseTo(5);
  }
  batch.reset();
  batch.stroke(TEX.line, TINT.text, 0, 0, -2, 1, 1, 2, 1, 0, 1);
  expect(batch.count).toBe(6);
  for (let vertex = 0; vertex < 6; vertex++) expect(batch.data[vertex * STRIDE + 2]).toBeGreaterThan(0);
  expect(batch.data.subarray(0, 6 * STRIDE).every(Number.isFinite)).toBe(true);
  // Cut at the eye, the stroke starts with the shade it had there, not the shade of the end left behind.
  expect(batch.data[5]).toBeCloseTo(0.5125);
  batch.reset();
  batch.stroke(TEX.line, TINT.text, 0, 0, -2, 1, 1, -1, 1, 1);
  batch.dot(TINT.accent, 0, 0, -1, 2, 1);
  expect(batch.count).toBe(0);
});

test('a batch grows past its first size instead of dropping triangles', () => {
  const batch = new Batch(6);
  for (let i = 0; i < 10; i++) batch.sprite(i, 0, 1, 0.5, 1);
  expect(batch.count).toBe(60);
  expect(batch.data[59 * STRIDE]).toBe(8.5);
});

test('a scene draws only in the theme: its text colour, its accent and a mix of the two', () => {
  const text: [number, number, number] = [236, 236, 241], accent: [number, number, number] = [168, 85, 247];
  const tints = themeTints(text, accent);
  expect(tints[0]).toEqual(text);
  expect(tints[1]).toEqual(accent);
  // On the line from the text colour to the accent, channel by channel: no hue of its own.
  for (const tint of tints) {
    const share = (tint[0] - text[0]) / (accent[0] - text[0]);
    expect(share).toBeGreaterThanOrEqual(0);
    expect(share).toBeLessThanOrEqual(1);
    for (let channel = 1; channel < 3; channel++) expect(tint[channel]).toBeCloseTo(text[channel]! + (accent[channel]! - text[channel]!) * share);
  }
  expect(wrap(-1, 34)).toBe(33);
});
