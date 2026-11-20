import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  multiply, invert, applyToPoint, similarityFromEyes, flipAround,
  gestureDelta, pickLargestFace, scaledSize, eyeCentersFromLandmarks,
} from '../js/geometry.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const closePt = (p, q) => { close(p.x, q.x); close(p.y, q.y); };

test('similarityFromEyes maps eyes and interior points', () => {
  const m = similarityFromEyes({ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 100, y: 200 }, { x: 140, y: 200 });
  closePt(applyToPoint(m, { x: 10, y: 10 }), { x: 100, y: 200 });
  closePt(applyToPoint(m, { x: 30, y: 10 }), { x: 140, y: 200 });
  closePt(applyToPoint(m, { x: 20, y: 20 }), { x: 120, y: 220 });
});

test('similarityFromEyes handles rotation', () => {
  const m = similarityFromEyes({ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 0, y: 0 }, { x: 0, y: 20 });
  closePt(applyToPoint(m, { x: 10, y: 10 }), { x: 0, y: 0 });
  closePt(applyToPoint(m, { x: 30, y: 10 }), { x: 0, y: 20 });
});

test('invert gives identity when multiplied', () => {
  const m = similarityFromEyes({ x: 3, y: 7 }, { x: 30, y: 12 }, { x: -5, y: 40 }, { x: 60, y: 90 });
  const id = multiply(m, invert(m));
  [1, 0, 0, 1, 0, 0].forEach((v, i) => close(id[i], v));
});

test('flip keeps eyes aligned after swapping left/right', () => {
  const f = flipAround(100);
  closePt(applyToPoint(f, { x: 30, y: 40 }), { x: 70, y: 40 });
  closePt(applyToPoint(f, { x: 70, y: 40 }), { x: 30, y: 40 });
  const dstL = { x: 200, y: 300 }, dstR = { x: 260, y: 310 };
  // after flip, the original right eye (70) is at 30 => it is now the left eye
  const flippedL = applyToPoint(f, { x: 70, y: 40 });
  const flippedR = applyToPoint(f, { x: 30, y: 40 });
  const sim = similarityFromEyes(flippedL, flippedR, dstL, dstR);
  const total = multiply(sim, f);
  closePt(applyToPoint(total, { x: 70, y: 40 }), dstL);
  closePt(applyToPoint(total, { x: 30, y: 40 }), dstR);
});

test('gestureDelta: translation only', () => {
  const d = gestureDelta({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 });
  [1, 0, 0, 1, 5, 0].forEach((v, i) => close(d[i], v));
});

test('gestureDelta: scale x2 around midpoint', () => {
  const d = gestureDelta({ x: 40, y: 50 }, { x: 60, y: 50 }, { x: 30, y: 50 }, { x: 70, y: 50 });
  closePt(applyToPoint(d, { x: 50, y: 50 }), { x: 50, y: 50 });
  closePt(applyToPoint(d, { x: 60, y: 50 }), { x: 70, y: 50 });
});

test('pickLargestFace', () => {
  const a = { left: {}, right: {}, box: { width: 10, height: 10 } };
  const b = { left: {}, right: {}, box: { width: 30, height: 20 } };
  assert.equal(pickLargestFace([a, b]), b);
  assert.equal(pickLargestFace([]), null);
});

test('scaledSize', () => {
  assert.deepEqual(scaledSize(4032, 3024), { width: 1024, height: 768 });
  assert.deepEqual(scaledSize(3024, 4032), { width: 768, height: 1024 });
  assert.deepEqual(scaledSize(800, 600), { width: 800, height: 600 });
});

test('eyeCentersFromLandmarks', () => {
  const lm = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  lm[33] = { x: 0.2, y: 0.5 }; lm[133] = { x: 0.3, y: 0.5 };
  lm[362] = { x: 0.7, y: 0.5 }; lm[263] = { x: 0.8, y: 0.5 };
  const e = eyeCentersFromLandmarks(lm, 1000, 500);
  closePt(e.left, { x: 250, y: 250 });
  closePt(e.right, { x: 750, y: 250 });
});
