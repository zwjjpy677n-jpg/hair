import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillHoles } from '../js/fill.js';

function solid(w, h, [r, g, b]) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) a.set([r, g, b, 255], i * 4);
  return a;
}
const hole = (w, h, fn) => {
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = fn(x, y) ? 1 : 0;
  return { width: w, height: h, data: d };
};

test('empty hole mask returns identical pixels', () => {
  const img = solid(16, 16, [1, 2, 3]); img[0] = 99;
  const out = fillHoles(img, 16, 16, hole(16, 16, () => false));
  assert.deepEqual([...out], [...img]);
});

test('uniform color fills uniformly', () => {
  const w = 40, h = 40, img = solid(w, h, [200, 100, 50]);
  const m = hole(w, h, (x, y) => x >= 15 && x < 25 && y >= 15 && y < 25);
  for (let i = 0; i < w * h; i++) if (m.data[i]) img.set([0, 0, 0, 255], i * 4);
  const out = fillHoles(img, w, h, m);
  for (let i = 0; i < w * h; i++) if (m.data[i]) {
    assert.ok(Math.abs(out[i * 4] - 200) <= 1 && Math.abs(out[i * 4 + 1] - 100) <= 1 && Math.abs(out[i * 4 + 2] - 50) <= 1, `pixel ${i}: ${out.slice(i * 4, i * 4 + 3)}`);
  }
});

test('two colors: hole edges lean toward neighbors', () => {
  const w = 60, h = 30, img = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.set(x < 30 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * w + x) * 4);
  const m = hole(w, h, (x) => x >= 20 && x < 40);
  const out = fillHoles(img, w, h, m);
  const at = (x, y) => out.slice((y * w + x) * 4, (y * w + x) * 4 + 3);
  const L = at(20, 15), R = at(39, 15);
  assert.ok(L[0] > L[2], `left ${L}`);
  assert.ok(R[2] > R[0], `right ${R}`);
});

test('input is not mutated and works on large image', () => {
  const w = 512, h = 512, img = solid(w, h, [10, 20, 30]);
  const copy = img.slice();
  const m = hole(w, h, (x, y) => (x - 256) ** 2 + (y - 256) ** 2 < 150 ** 2);
  const t = performance.now();
  fillHoles(img, w, h, m);
  console.log(`fillHoles 512x512: ${(performance.now() - t).toFixed(0)}ms`);
  assert.deepEqual(img, copy);
});
