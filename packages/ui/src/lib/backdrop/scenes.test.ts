import { expect, test } from 'vitest';
import { Batch, STRIDE, TEX, TINT } from './batch';
import { turnHue, wrap } from './math';
import { GLYPHS, SCENES, type Frame, type SceneId } from './scenes';

const IDS: SceneId[] = ['glyphs', 'crates', 'tunnel'];

function drawn(id: SceneId, time: number, lean = 0): Frame {
  const frame: Frame = { solid: new Batch(), soft: new Batch(), time, leanX: lean, leanY: lean, focal: SCENES[id].focal(1400, 900) };
  SCENES[id].draw(frame);
  return frame;
}

test('every scene fills whole triangles of finite numbers, in materials the shader knows', () => {
  const textures = Object.values(TEX) as number[];
  const tints = Object.values(TINT) as number[];
  for (const id of IDS) {
    for (const time of [0, 3, 61.7, 3600]) {
      const { solid, soft } = drawn(id, time, 1);
      expect(solid.count + soft.count, `${id} at ${time}`).toBeGreaterThan(300);
      for (const batch of [solid, soft]) {
        expect(batch.count % 3).toBe(0);
        const used = batch.data.subarray(0, batch.count * STRIDE);
        expect(used.every(Number.isFinite), `${id} at ${time}`).toBe(true);
        for (let vertex = 0; vertex < batch.count; vertex++) {
          expect(textures).toContain(used[vertex * STRIDE + 6]);
          expect(tints).toContain(used[vertex * STRIDE + 7]);
        }
      }
    }
  }
});

test('a scene is a function of its time: the still frame of reduced motion is the same every time', () => {
  for (const id of IDS) {
    const once = drawn(id, 3), again = drawn(id, 3);
    expect(again.solid.count).toBe(once.solid.count);
    expect(again.soft.count).toBe(once.soft.count);
    expect(again.soft.data.subarray(0, again.soft.count * STRIDE)).toEqual(once.soft.data.subarray(0, once.soft.count * STRIDE));
  }
});

// The second frame also samples the maximum unsigned 32-bit hash.
test.each([12.3, 515720.9])('the glyph scene names only characters the atlas holds at %s seconds', (time) => {
  const { soft } = drawn('glyphs', time);
  for (let vertex = 0; vertex < soft.count; vertex++) {
    if (soft.data[vertex * STRIDE + 6] !== TEX.glyph) continue;
    const cell = soft.data[vertex * STRIDE + 8]!;
    expect(Number.isInteger(cell) && cell >= 0 && cell < GLYPHS.length).toBe(true);
  }
});

test('a batch grows past its first size instead of dropping triangles', () => {
  const batch = new Batch(6);
  for (let i = 0; i < 10; i++) batch.sprite(i, 0, 1, 0.5, 1);
  expect(batch.count).toBe(60);
  expect(batch.data[59 * STRIDE]).toBe(8.5);
});

test('the second colour is the accent turned toward blue, and a grey stays grey', () => {
  const [red, green, blue] = turnHue([168, 85, 247], -70);
  expect(blue).toBeGreaterThan(red);
  expect(blue).toBeGreaterThan(green);
  expect(green).toBeGreaterThan(red);
  expect(turnHue([128, 128, 128], -70)).toEqual([128, 128, 128]);
  expect(wrap(-1, 34)).toBe(33);
});
