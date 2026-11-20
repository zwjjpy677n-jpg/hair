// Mask: { width, height, data: Float32Array } with values in 0..1, row-major.

const make = (w, h) => ({ width: w, height: h, data: new Float32Array(w * h) });

function sepPass(src, w, h, r, horizontal, reduce) {
  const out = new Float32Array(w * h);
  const [n, m] = horizontal ? [h, w] : [w, h];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const lo = Math.max(0, j - r), hi = Math.min(m - 1, j + r);
      out[horizontal ? i * w + j : j * w + i] = reduce(src, lo, hi, (k) => (horizontal ? i * w + k : k * w + i), j, m);
    }
  }
  return out;
}

const maxReduce = (src, lo, hi, idx) => {
  let v = 0;
  for (let k = lo; k <= hi; k++) if (src[idx(k)] > v) v = src[idx(k)];
  return v;
};

/** Square-neighborhood max filter. */
export function dilate(mask, radius) {
  const { width: w, height: h } = mask;
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return { width: w, height: h, data: mask.data.slice() };
  const a = sepPass(mask.data, w, h, r, true, maxReduce);
  return { width: w, height: h, data: sepPass(a, w, h, r, false, maxReduce) };
}

function boxBlur(data, w, h, r) {
  // clamp-to-edge box blur using running sums
  const pass = (src, horizontal) => {
    const out = new Float32Array(w * h);
    const [n, m] = horizontal ? [h, w] : [w, h];
    const at = (i, k) => src[horizontal ? i * w + Math.min(m - 1, Math.max(0, k)) : Math.min(m - 1, Math.max(0, k)) * w + i];
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += at(i, k);
      for (let j = 0; j < m; j++) {
        out[horizontal ? i * w + j : j * w + i] = sum / (2 * r + 1);
        sum += at(i, j + r + 1) - at(i, j - r);
      }
    }
    return out;
  };
  return pass(pass(data, true), false);
}

/** Soften edges: box blur applied twice. */
export function feather(mask, radius) {
  const { width: w, height: h } = mask;
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return { width: w, height: h, data: mask.data.slice() };
  return { width: w, height: h, data: boxBlur(boxBlur(mask.data, w, h, r), w, h, r) };
}

export function subtract(a, b) {
  const out = make(a.width, a.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = Math.max(0, a.data[i] - b.data[i]);
  return out;
}

export function threshold(mask, t = 0.5) {
  const out = make(mask.width, mask.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = mask.data[i] >= t ? 1 : 0;
  return out;
}

/** Copy of rgba with alpha = mask * 255. */
export function maskToLayer(rgba, mask) {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < mask.data.length; i++) out[i * 4 + 3] = Math.round(mask.data[i] * 255);
  return out;
}
