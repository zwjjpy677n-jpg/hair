// Hole filling via a multi-resolution pyramid with diffusion.

function makeLevel(w, h) {
  return { w, h, rgb: new Float32Array(w * h * 3), known: new Uint8Array(w * h) };
}

function downsample(L) {
  const w = Math.ceil(L.w / 2), h = Math.ceil(L.h / 2);
  const out = makeLevel(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const sx = 2 * x + dx, sy = 2 * y + dy;
      if (sx >= L.w || sy >= L.h) continue;
      const i = sy * L.w + sx;
      if (!L.known[i]) continue;
      r += L.rgb[i * 3]; g += L.rgb[i * 3 + 1]; b += L.rgb[i * 3 + 2]; n++;
    }
    if (n) {
      const o = y * w + x;
      out.rgb[o * 3] = r / n; out.rgb[o * 3 + 1] = g / n; out.rgb[o * 3 + 2] = b / n;
      out.known[o] = 1;
    }
  }
  return out;
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function neighborAvg(L, x, y, onlyKnown) {
  let r = 0, g = 0, b = 0, n = 0;
  for (const [dx, dy] of N4) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) continue;
    const j = ny * L.w + nx;
    if (onlyKnown && !L.known[j]) continue;
    r += L.rgb[j * 3]; g += L.rgb[j * 3 + 1]; b += L.rgb[j * 3 + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

function fillCoarsest(L) {
  for (;;) {
    const next = L.known.slice();
    let changed = false, remaining = false;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x;
      if (L.known[i]) continue;
      const v = neighborAvg(L, x, y, true);
      if (v) { L.rgb.set(v, i * 3); next[i] = 1; changed = true; } else remaining = true;
    }
    L.known = next;
    if (!remaining || !changed) return;
  }
}

function sampleBilinear(L, fx, fy, out) {
  const x = Math.min(L.w - 1, Math.max(0, fx)), y = Math.min(L.h - 1, Math.max(0, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(L.w - 1, x0 + 1), y1 = Math.min(L.h - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  for (let c = 0; c < 3; c++) {
    const v00 = L.rgb[(y0 * L.w + x0) * 3 + c], v10 = L.rgb[(y0 * L.w + x1) * 3 + c];
    const v01 = L.rgb[(y1 * L.w + x0) * 3 + c], v11 = L.rgb[(y1 * L.w + x1) * 3 + c];
    out[c] = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  }
  return out;
}

/**
 * Fill pixels where hole > 0.5 from their surroundings.
 * Returns a new Uint8ClampedArray; input is not modified.
 */
export function fillHoles(rgba, width, height, hole) {
  const out = new Uint8ClampedArray(rgba);
  const holes = [];
  for (let i = 0; i < width * height; i++) if (hole.data[i] > 0.5) holes.push(i);
  if (holes.length === 0) return out;

  const top = makeLevel(width, height);
  for (let i = 0; i < width * height; i++) {
    top.rgb[i * 3] = rgba[i * 4]; top.rgb[i * 3 + 1] = rgba[i * 4 + 1]; top.rgb[i * 3 + 2] = rgba[i * 4 + 2];
    top.known[i] = hole.data[i] > 0.5 ? 0 : 1;
  }
  if (holes.length === width * height) return out; // nothing to sample from

  const levels = [top];
  while (Math.min(levels.at(-1).w, levels.at(-1).h) > 8) levels.push(downsample(levels.at(-1)));
  fillCoarsest(levels.at(-1));

  const tmp = [0, 0, 0];
  for (let li = levels.length - 2; li >= 0; li--) {
    const L = levels[li], C = levels[li + 1];
    const unknown = [];
    for (let i = 0; i < L.w * L.h; i++) if (!L.known[i]) unknown.push(i);
    for (const i of unknown) {
      const x = i % L.w, y = (i - x) / L.w;
      L.rgb.set(sampleBilinear(C, (x + 0.5) / 2 - 0.5, (y + 0.5) / 2 - 0.5, tmp), i * 3);
    }
    for (let it = 0; it < 8; it++) {
      for (const i of unknown) {
        const x = i % L.w, y = (i - x) / L.w;
        const v = neighborAvg(L, x, y, false);
        if (v) L.rgb.set(v, i * 3);
      }
    }
    L.known.fill(1);
  }

  for (const i of holes) {
    out[i * 4] = top.rgb[i * 3]; out[i * 4 + 1] = top.rgb[i * 3 + 1]; out[i * 4 + 2] = top.rgb[i * 3 + 2];
  }
  return out;
}
