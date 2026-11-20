import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dilate, feather, subtract, threshold, maskToLayer } from '../js/mask.js';

const mk = (w, h, arr) => ({ width: w, height: h, data: Float32Array.from(arr ?? new Array(w * h).fill(0)) });

test('dilate radius 1 grows a point to 3x3', () => {
  const m = mk(5, 5); m.data[12] = 1;
  const d = dilate(m, 1);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const inside = Math.abs(x - 2) <= 1 && Math.abs(y - 2) <= 1;
    assert.equal(d.data[y * 5 + x], inside ? 1 : 0);
  }
});

test('subtract clamps at zero', () => {
  const r = subtract(mk(3, 1, [1, 0.5, 0]), mk(3, 1, [0.3, 0.7, 0]));
  assert.ok(Math.abs(r.data[0] - 0.7) < 1e-6);
  assert.equal(r.data[1], 0); assert.equal(r.data[2], 0);
});

test('threshold', () => {
  assert.deepEqual([...threshold(mk(3, 1, [0.2, 0.5, 0.9])).data], [0, 1, 1]);
});

test('feather keeps size and smooths an edge', () => {
  const m = mk(10, 1, [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  const f = feather(m, 1);
  assert.equal(f.data.length, 10);
  assert.ok(f.data[4] > 0 && f.data[4] < 1);
  assert.equal(f.data[0], 0); assert.equal(f.data[9], 1);
});

test('maskToLayer sets alpha only', () => {
  const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
  const out = maskToLayer(rgba, mk(2, 1, [1, 0.5]));
  assert.deepEqual([...out], [10, 20, 30, 255, 40, 50, 60, 128]);
});
