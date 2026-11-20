import { IDENTITY, multiply, invert, applyToPoint, similarityFromEyes, flipAround } from './geometry.js';
import { dilate, subtract, threshold } from './mask.js';
import { fillHoles } from './fill.js';

const zeros = (w, h) => ({ width: w, height: h, data: new Float32Array(w * h) });
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

export function createEditor() {
  const state = {
    base: null, baseHair: null, baseEyes: null,
    layer: null, layerEyes: null,
    autoTransform: [...IDENTITY], transform: [...IDENTITY],
    flipped: false, strokes: [], removeHair: true,
  };
  let history = [];
  let eraseCache = null; // { count, mask: Uint8Array }
  let filled = null; // rgba of base with holes filled
  let filledKey = null;
  let baseCanvas = null; // canvas built from `filled`, rebuilt only when it changes
  let layerCanvasCache = null;

  function fillKey() {
    return [state.base, state.baseHair, state.layer, state.removeHair, state.flipped, state.strokes, ...state.transform];
  }
  const sameKey = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

  // Reference points on the layer used for alignment and flipping.
  function refEyes() {
    if (state.layerEyes) return state.layerEyes;
    const { width: w, height: h } = state.layer;
    return { left: { x: w * 0.4, y: h / 2 }, right: { x: w * 0.6, y: h / 2 } };
  }

  function computeAuto() {
    if (!state.base || !state.layer) return [...IDENTITY];
    if (state.baseEyes && state.layerEyes) {
      return similarityFromEyes(state.layerEyes.left, state.layerEyes.right, state.baseEyes.left, state.baseEyes.right);
    }
    const s = (state.base.width * 0.8) / state.layer.width;
    return [s, 0, 0, s, state.base.width / 2 - (s * state.layer.width) / 2, state.base.height / 2 - (s * state.layer.height) / 2];
  }

  function resetEdits() {
    state.autoTransform = computeAuto();
    state.transform = [...state.autoTransform];
    state.flipped = false;
    state.strokes = [];
    history = [];
    eraseCache = null;
    layerCanvasCache = null;
  }

  function effectiveTransform() {
    if (!state.layer) return [...state.transform];
    return state.flipped ? multiply(state.transform, flipAround(state.layer.width)) : [...state.transform];
  }

  function snapshot() {
    return { transform: [...state.transform], flipped: state.flipped, strokes: state.strokes };
  }

  function pushHistory() {
    history.push(snapshot());
    if (history.length > 50) history.shift();
  }

  function eraseMask() {
    const { width: w, height: h } = state.layer;
    if (eraseCache && eraseCache.strokes === state.strokes) return eraseCache.mask;
    const m = new Uint8Array(w * h);
    const stamp = (cx, cy, r) => {
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1;
      }
    };
    for (const { points, radius } of state.strokes) {
      for (let i = 0; i < points.length; i++) {
        const p = points[i], q = points[i + 1];
        stamp(p.x, p.y, radius);
        if (!q) continue;
        const steps = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / Math.max(1, radius / 2));
        for (let s = 1; s < steps; s++) stamp(p.x + ((q.x - p.x) * s) / steps, p.y + ((q.y - p.y) * s) / steps, radius);
      }
    }
    eraseCache = { strokes: state.strokes, mask: m };
    return m;
  }

  function layerAlphaInBase() {
    const { width: W, height: H } = state.base;
    const out = zeros(W, H);
    if (!state.layer) return out;
    const { width: w, height: h, rgba } = state.layer;
    const inv = invert(effectiveTransform());
    const erased = eraseMask();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = applyToPoint(inv, { x: x + 0.5, y: y + 0.5 });
      const lx = Math.floor(p.x), ly = Math.floor(p.y);
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;
      const li = ly * w + lx;
      if (erased[li]) continue;
      out.data[y * W + x] = rgba[li * 4 + 3] / 255;
    }
    return out;
  }

  function holeMask() {
    const { width: W, height: H } = state.base;
    if (!state.removeHair || !state.baseHair) return zeros(W, H);
    return threshold(subtract(dilate(state.baseHair, 6), dilate(layerAlphaInBase(), 2)));
  }

  /** Recompute the base image with the original hair filled in. Returns false if nothing changed. */
  function refreshFill() {
    if (!state.base) return false;
    const key = fillKey();
    if (filled && sameKey(key, filledKey)) return false;
    const { width: W, height: H, rgba } = state.base;
    filled = state.layer && state.removeHair ? fillHoles(rgba, W, H, holeMask()) : rgba;
    filledKey = key;
    baseCanvas = null;
    return true;
  }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }

  function layerCanvas() {
    if (layerCanvasCache && layerCanvasCache.strokes === state.strokes) return layerCanvasCache.canvas;
    const { width: w, height: h, rgba } = state.layer;
    const data = new Uint8ClampedArray(rgba);
    const erased = eraseMask();
    for (let i = 0; i < w * h; i++) if (erased[i]) data[i * 4 + 3] = 0;
    const c = makeCanvas(w, h);
    c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
    layerCanvasCache = { strokes: state.strokes, canvas: c };
    return c;
  }

  /** Draw the composite in base-image pixel coordinates onto ctx (with an optional outer transform). */
  function render(ctx, outer = IDENTITY) {
    if (!state.base) return;
    const { width: W, height: H } = state.base;
    if (!filled) refreshFill();
    if (!baseCanvas) {
      baseCanvas = makeCanvas(W, H);
      baseCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(filled), W, H), 0, 0);
    }
    ctx.save();
    ctx.setTransform(...outer);
    ctx.drawImage(baseCanvas, 0, 0);
    if (state.layer) {
      ctx.setTransform(...multiply(outer, effectiveTransform()));
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(layerCanvas(), 0, 0);
    }
    ctx.restore();
  }

  return {
    state,
    setBase(image, hairMask) {
      state.base = image; state.baseHair = hairMask; state.baseEyes = null;
      filled = null; resetEdits();
    },
    setBaseEyes(eyes) {
      state.baseEyes = eyes;
      filled = null; resetEdits();
    },
    setLayer(image, eyes) {
      state.layer = image; state.layerEyes = eyes;
      filled = null; resetEdits();
    },
    setLayerEyes(eyes) {
      state.layerEyes = eyes;
      filled = null; resetEdits();
    },
    pushHistory,
    /** Drop the last undo entry if the state equals it (e.g. a tap without movement). */
    dropHistoryIfUnchanged() {
      const last = history.at(-1);
      if (!last) return;
      const same = last.flipped === state.flipped && last.strokes === state.strokes
        && last.transform.every((v, i) => v === state.transform[i]);
      if (same) history.pop();
    },
    applyGesture(delta) {
      state.transform = multiply(delta, state.transform);
    },
    toggleFlip() {
      if (!state.layer) return;
      pushHistory();
      const eyes = refEyes();
      const cur = effectiveTransform();
      const pL = applyToPoint(cur, state.flipped ? eyes.right : eyes.left);
      const pR = applyToPoint(cur, state.flipped ? eyes.left : eyes.right);
      const nextFlipped = !state.flipped;
      const F = nextFlipped ? flipAround(state.layer.width) : IDENTITY;
      // the eye that ends up on the left of the (possibly flipped) layer
      const a = applyToPoint(F, nextFlipped ? eyes.right : eyes.left);
      const b = applyToPoint(F, nextFlipped ? eyes.left : eyes.right);
      state.transform = similarityFromEyes(a, b, pL, pR);
      state.flipped = nextFlipped;
    },
    addStroke(points, radius) {
      if (!state.layer || points.length === 0) return;
      pushHistory();
      const eff = effectiveTransform();
      const inv = invert(eff);
      state.strokes = [...state.strokes, { points: points.map((p) => applyToPoint(inv, p)), radius: radius / scaleOf(eff) }];
    },
    effectiveTransform,
    undo() {
      const s = history.pop();
      if (!s) return;
      state.transform = s.transform; state.flipped = s.flipped; state.strokes = s.strokes;
      eraseCache = null; layerCanvasCache = null;
    },
    reset() {
      pushHistory();
      state.transform = [...state.autoTransform]; state.flipped = false; state.strokes = [];
    },
    layerAlphaInBase,
    holeMask,
    refreshFill,
    /** True if refreshFill() would recompute. */
    needsFill() { return !!state.base && !(filled && sameKey(fillKey(), filledKey)); },
    render,
  };
}
