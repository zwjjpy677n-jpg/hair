// 2x3 affine matrices in canvas setTransform order: [a, b, c, d, e, f]
// x' = a*x + c*y + e ; y' = b*x + d*y + f

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/** m1 ∘ m2 (apply m2 first, then m1) */
export function multiply(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error('singular matrix');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function applyToPoint(m, p) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Similarity transform (translate/scale/rotate) mapping srcL->dstL and srcR->dstR */
export function similarityFromEyes(srcL, srcR, dstL, dstR) {
  const sx = srcR.x - srcL.x, sy = srcR.y - srcL.y;
  const dx = dstR.x - dstL.x, dy = dstR.y - dstL.y;
  const den = sx * sx + sy * sy;
  if (den < 1e-12) throw new Error('degenerate eyes');
  // complex division: (dx + i dy) / (sx + i sy)
  const a = (dx * sx + dy * sy) / den;
  const b = (dy * sx - dx * sy) / den;
  // [a -b; b a]
  const e = dstL.x - (a * srcL.x - b * srcL.y);
  const f = dstL.y - (b * srcL.x + a * srcL.y);
  return [a, b, -b, a, e, f];
}

/** Horizontal mirror: x -> width - x */
export function flipAround(width) {
  return [-1, 0, 0, 1, width, 0];
}

/** Matrix mapping the previous two-finger positions to the current ones */
export function gestureDelta(prevA, prevB, curA, curB) {
  return similarityFromEyes(prevA, prevB, curA, curB);
}

export function pickLargestFace(faces) {
  if (!faces || faces.length === 0) return null;
  let best = faces[0];
  for (const f of faces) {
    if (f.box.width * f.box.height > best.box.width * best.box.height) best = f;
  }
  return best;
}

export function scaledSize(w, h, maxSide = 1024) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

function avg(p, q, width, height) {
  return { x: ((p.x + q.x) / 2) * width, y: ((p.y + q.y) / 2) * height };
}

/** Eye centers in pixels from MediaPipe face landmarks (normalized). `left` is the one on the image's left. */
export function eyeCentersFromLandmarks(landmarks, width, height) {
  const e1 = avg(landmarks[33], landmarks[133], width, height);
  const e2 = avg(landmarks[362], landmarks[263], width, height);
  return e1.x <= e2.x ? { left: e1, right: e2 } : { left: e2, right: e1 };
}
