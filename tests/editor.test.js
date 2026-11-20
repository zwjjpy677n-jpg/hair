import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../js/editor.js';
import { applyToPoint } from '../js/geometry.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const closePt = (p, q) => { close(p.x, q.x); close(p.y, q.y); };

function img(w, h, alphaFn = () => 255) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set([100, 80, 60, alphaFn(x, y)], (y * w + x) * 4);
  return { width: w, height: h, rgba };
}
const mask = (w, h, fn) => {
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = fn(x, y) ? 1 : 0;
  return { width: w, height: h, data: d };
};

const BASE_EYES = { left: { x: 15, y: 20 }, right: { x: 25, y: 20 } };
const LAYER_EYES = { left: { x: 15, y: 20 }, right: { x: 25, y: 20 } };

function setup({ baseHair, layerAlpha } = {}) {
  const ed = createEditor();
  ed.setBase(img(40, 40), baseHair ?? mask(40, 40, () => false));
  ed.setBaseEyes(BASE_EYES);
  ed.setLayer(img(40, 40, layerAlpha ?? (() => 255)), LAYER_EYES);
  return ed;
}

test('setLayer aligns layer eyes onto base eyes', () => {
  const ed = setup();
  closePt(applyToPoint(ed.effectiveTransform(), LAYER_EYES.left), BASE_EYES.left);
  closePt(applyToPoint(ed.effectiveTransform(), LAYER_EYES.right), BASE_EYES.right);
});

test('toggleFlip keeps eyes on base eyes', () => {
  const ed = setup();
  ed.toggleFlip();
  assert.equal(ed.state.flipped, true);
  const m = ed.effectiveTransform();
  // after flipping, the original right eye sits on the base's left eye
  closePt(applyToPoint(m, LAYER_EYES.right), BASE_EYES.left);
  closePt(applyToPoint(m, LAYER_EYES.left), BASE_EYES.right);
});

test('eraser strokes follow the layer when it moves', () => {
  const ed = setup();
  ed.addStroke([{ x: 10, y: 10 }], 2);
  assert.equal(ed.layerAlphaInBase().data[10 * 40 + 10], 0);
  ed.applyGesture([1, 0, 0, 1, 5, 0]);
  const a = ed.layerAlphaInBase();
  assert.equal(a.data[10 * 40 + 15], 0);
  assert.ok(a.data[10 * 40 + 10] > 0.9);
});

test('holeMask: covered hair is 0, exposed hair is 1', () => {
  // layer only covers the top half (y < 20); base hair spans the full height on the left
  const ed = setup({
    baseHair: mask(40, 40, (x) => x < 8),
    layerAlpha: (x, y) => (y < 20 ? 255 : 0),
  });
  const h = ed.holeMask();
  assert.equal(h.data[5 * 40 + 3], 0);
  assert.equal(h.data[35 * 40 + 3], 1);
  assert.equal(h.data[35 * 40 + 30], 0); // no hair there
});

test('removeHair=false gives empty hole mask', () => {
  const ed = setup({ baseHair: mask(40, 40, () => true), layerAlpha: () => 0 });
  ed.state.removeHair = false;
  assert.ok(ed.holeMask().data.every((v) => v === 0));
});

test('setLayer again resets edits and history', () => {
  const ed = setup();
  ed.toggleFlip();
  ed.addStroke([{ x: 1, y: 1 }], 2);
  ed.setLayer(img(40, 40), LAYER_EYES);
  assert.equal(ed.state.flipped, false);
  assert.equal(ed.state.strokes.length, 0);
  const before = [...ed.effectiveTransform()];
  ed.undo();
  assert.deepEqual([...ed.effectiveTransform()], before);
  assert.equal(ed.state.flipped, false);
});

test('undo reverts a flip', () => {
  const ed = setup();
  ed.toggleFlip();
  ed.undo();
  assert.equal(ed.state.flipped, false);
  closePt(applyToPoint(ed.effectiveTransform(), LAYER_EYES.left), BASE_EYES.left);
});

test('reset restores auto position', () => {
  const ed = setup();
  ed.applyGesture([2, 0, 0, 2, 3, 4]);
  ed.addStroke([{ x: 1, y: 1 }], 2);
  ed.reset();
  closePt(applyToPoint(ed.effectiveTransform(), LAYER_EYES.left), BASE_EYES.left);
  assert.equal(ed.state.strokes.length, 0);
});

test('without eyes the layer is centered at 0.8x base width', () => {
  const ed = createEditor();
  ed.setBase(img(100, 100), mask(100, 100, () => false));
  ed.setLayer(img(50, 50), null);
  const m = ed.effectiveTransform();
  closePt(applyToPoint(m, { x: 25, y: 25 }), { x: 50, y: 50 });
  closePt(applyToPoint(m, { x: 50, y: 25 }), { x: 90, y: 50 });
});

test('erase cache does not go stale after reset and a new stroke', () => {
  const ed = setup();
  ed.addStroke([{ x: 10, y: 10 }], 2);
  ed.layerAlphaInBase();
  ed.reset();
  ed.addStroke([{ x: 30, y: 30 }], 2);
  const a = ed.layerAlphaInBase();
  assert.ok(a.data[10 * 40 + 10] > 0.9);
  assert.equal(a.data[30 * 40 + 30], 0);
});

test('refreshFill skips work when nothing changed', () => {
  const ed = setup({ baseHair: mask(40, 40, (x) => x < 8) });
  assert.equal(ed.refreshFill(), true);
  assert.equal(ed.refreshFill(), false);
  ed.applyGesture([1, 0, 0, 1, 1, 0]);
  assert.equal(ed.refreshFill(), true);
  ed.state.removeHair = false;
  assert.equal(ed.refreshFill(), true);
  ed.toggleFlip();
  assert.equal(ed.refreshFill(), true);
  assert.equal(ed.refreshFill(), false);
});

test('a gesture that changes nothing leaves no undo entry', () => {
  const ed = setup();
  ed.toggleFlip();
  ed.pushHistory(); // gesture start
  ed.dropHistoryIfUnchanged(); // gesture ended without movement
  ed.undo();
  assert.equal(ed.state.flipped, false);
});
