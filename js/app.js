import { createEditor } from './editor.js';
import { loadImageFile } from './image-load.js';
import { initVision } from './vision.js';
import { gestureDelta, pickLargestFace } from './geometry.js';
import { feather, maskToLayer } from './mask.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
const ctx = view.getContext('2d');
const editor = createEditor();

const ui = {
  mode: 'move',
  eraseSize: 20,
  faceImage: null,   // loaded face photo
  styleImage: null,  // loaded hairstyle photo
  eyeTap: null,      // { target: 'base'|'layer', image, points: [] }
  stroke: null,      // eraser points (photo coords) of the stroke in progress
  multiTouch: false, // a second finger joined the current interaction
};
window.__hairApp = { editor };

// ---------- status ----------
function setStatus(msg, isError = false) {
  const el = $('status');
  if (!msg) { el.hidden = true; return; }
  el.textContent = msg; el.hidden = false;
  el.classList.toggle('error', isError);
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------- drawing ----------
function displayImage() {
  if (ui.eyeTap) return ui.eyeTap.image;
  return editor.state.base ?? null;
}

function sizeCanvas(img) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssW = $('stage').clientWidth;
  const cssH = (cssW * img.height) / img.width;
  const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
  // Only touch the canvas size when it changes: resizing reallocates and clears it.
  if (view.width !== w || view.height !== h) {
    view.style.height = `${cssH}px`;
    view.width = w; view.height = h;
  }
}

function draw() {
  const img = displayImage();
  $('placeholder').hidden = !!img;
  if (!img) { view.width = 0; view.style.height = '0px'; return; }
  sizeCanvas(img);
  const k = view.width / img.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
  if (ui.eyeTap) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.drawImage(ui.eyeTap.image.canvas, 0, 0);
    ctx.fillStyle = '#e07a5f';
    for (const p of ui.eyeTap.points) { ctx.beginPath(); ctx.arc(p.x, p.y, 6 / k * (window.devicePixelRatio || 1), 0, Math.PI * 2); ctx.fill(); }
    return;
  }
  editor.render(ctx, [k, 0, 0, k, 0, 0]);
  if (ui.stroke && ui.stroke.length) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.strokeStyle = 'rgba(224,122,95,.55)';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = ui.eraseSize * 2 * photoPerCss();
    ctx.beginPath();
    ui.stroke.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (ui.stroke.length === 1) ctx.lineTo(ui.stroke[0].x + 0.01, ui.stroke[0].y);
    ctx.stroke();
  }
}

let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

async function refreshFill() {
  if (editor.state.base && editor.state.layer && editor.needsFill()) {
    const showStatus = editor.state.removeHair && $('status').hidden;
    if (showStatus) { setStatus('仕上げています…'); await nextFrame(); }
    editor.refreshFill();
    if (showStatus) setStatus(null);
  }
  requestDraw();
}

function updateControls() {
  const ready = !!(editor.state.base && editor.state.layer) && !ui.eyeTap;
  $('tools').setAttribute('aria-disabled', String(!ready));
  $('btn-save').disabled = !ready;
}

// ---------- eye tap fallback ----------
function startEyeTap(target, image, which) {
  ui.eyeTap = { target, image, points: [] };
  $('eyetap').hidden = false;
  $('eyetap-msg').textContent = `${which}の顔が見つかりませんでした。画面の左側にある目をタップしてください`;
  updateControls();
  requestDraw();
}

function cancelEyeTap() {
  ui.eyeTap = null;
  $('eyetap').hidden = true;
}

function finishEyeTap(eyes) {
  const { target } = ui.eyeTap;
  ui.eyeTap = null;
  $('eyetap').hidden = true;
  if (eyes) {
    if (target === 'base') editor.setBaseEyes(eyes); else editor.setLayerEyes(eyes);
  }
  updateControls();
  refreshFill();
}

function onEyeTap(p) {
  const t = ui.eyeTap;
  t.points.push(p);
  if (t.points.length === 1) {
    $('eyetap-msg').textContent = 'もう片方の目をタップしてください';
    requestDraw();
    return;
  }
  const [a, b] = t.points;
  finishEyeTap(a.x <= b.x ? { left: a, right: b } : { left: b, right: a });
}

$('eyetap-skip').addEventListener('click', () => finishEyeTap(null));

// ---------- loading photos ----------
async function analyze(image, label) {
  const vision = await initVision((m) => setStatus(m));
  setStatus(`${label}を解析しています…`);
  await nextFrame();
  const hair = vision.segmentHair(image.canvas);
  const face = pickLargestFace(vision.detectFaces(image.canvas));
  return { hair, eyes: face ? { left: face.left, right: face.right } : null };
}

const hairAmount = (mask) => mask.data.reduce((s, v) => s + v, 0) / mask.data.length;

async function onFacePicked(file) {
  try {
    setStatus('顔写真を読み込んでいます…');
    const image = await loadImageFile(file);
    const { hair, eyes } = await analyze(image, '顔写真');
    ui.faceImage = image;
    cancelEyeTap();
    editor.setBase(image, hair);
    if (eyes) editor.setBaseEyes(eyes);
    $('pick-face').classList.add('done'); $('state-face').textContent = '選択済み';
    setStatus(null);
    if (!eyes) startEyeTap('base', image, '顔写真');
    else await refreshFill();
  } catch (e) {
    console.error(e);
    setStatus(errorText(e), true);
  }
  updateControls();
}

async function onStylePicked(file) {
  try {
    setStatus('髪型写真を読み込んでいます…');
    const image = await loadImageFile(file);
    const { hair, eyes } = await analyze(image, '髪型写真');
    ui.styleImage = image;
    if (hairAmount(hair) < 0.01) {
      setStatus('髪型写真から髪が見つかりませんでした。別の写真を選んでください', true);
      return;
    }
    const layer = { width: image.width, height: image.height, rgba: maskToLayer(image.rgba, feather(hair, 2)) };
    cancelEyeTap();
    editor.setLayer(layer, eyes);
    $('pick-style').classList.add('done'); $('state-style').textContent = '選択済み';
    setStatus(null);
    if (!eyes) startEyeTap('layer', image, '髪型写真');
    else await refreshFill();
  } catch (e) {
    console.error(e);
    setStatus(errorText(e), true);
  } finally {
    updateControls();
  }
}

function errorText(e) {
  if (String(e?.message || '').includes('画像を読み込めません')) return e.message;
  return '画像認識を読み込めませんでした。通信状況を確認して、もう一度写真を選んでください';
}

$('file-face').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) onFacePicked(f); e.target.value = ''; });
$('file-style').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) onStylePicked(f); e.target.value = ''; });

// ---------- pointer input ----------
const pointers = new Map();

function photoPerCss() {
  const img = displayImage();
  return img ? img.width / view.getBoundingClientRect().width : 1;
}
function toPhoto(e) {
  const r = view.getBoundingClientRect();
  const s = photoPerCss();
  return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s };
}

view.addEventListener('pointerdown', (e) => {
  if (ui.eyeTap) { onEyeTap(toPhoto(e)); return; }
  if (!editor.state.base || !editor.state.layer) return;
  try { view.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
  if (pointers.size === 0) {
    ui.multiTouch = false;
    if (ui.mode === 'move') editor.pushHistory();
    else ui.stroke = [toPhoto(e)];
  } else if (!ui.multiTouch) {
    // A second finger: pinch/rotate in any mode, and drop a partial eraser stroke.
    ui.multiTouch = true;
    if (ui.mode === 'erase') { ui.stroke = null; editor.pushHistory(); }
  }
  pointers.set(e.pointerId, toPhoto(e));
  requestDraw();
});

view.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const prev = new Map(pointers);
  const cur = toPhoto(e);
  pointers.set(e.pointerId, cur);
  if (ui.mode === 'erase' && !ui.multiTouch) {
    if (ui.stroke) ui.stroke.push(cur);
  } else if (pointers.size === 1) {
    const p = prev.get(e.pointerId);
    editor.applyGesture([1, 0, 0, 1, cur.x - p.x, cur.y - p.y]);
  } else {
    const ids = [...pointers.keys()].slice(0, 2);
    if (!ids.includes(e.pointerId)) return;
    editor.applyGesture(gestureDelta(prev.get(ids[0]), prev.get(ids[1]), pointers.get(ids[0]), pointers.get(ids[1])));
  }
  requestDraw();
});

function endPointer(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size > 0) return;
  if (ui.mode === 'erase' && ui.stroke) {
    editor.addStroke(ui.stroke, ui.eraseSize * photoPerCss());
    ui.stroke = null;
  } else {
    editor.dropHistoryIfUnchanged();
  }
  ui.multiTouch = false;
  refreshFill();
}
view.addEventListener('pointerup', endPointer);
view.addEventListener('pointercancel', endPointer);
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------- tools ----------
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  ui.mode = b.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
  $('sizes').hidden = ui.mode !== 'erase';
}));
document.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
  ui.eraseSize = Number(b.dataset.size);
  document.querySelectorAll('[data-size]').forEach((x) => x.classList.toggle('on', x === b));
}));
$('btn-flip').addEventListener('click', () => { editor.toggleFlip(); refreshFill(); });
$('btn-undo').addEventListener('click', () => { editor.undo(); refreshFill(); });
$('btn-reset').addEventListener('click', () => { editor.reset(); refreshFill(); });
$('remove-hair').addEventListener('change', (e) => { editor.state.removeHair = e.target.checked; refreshFill(); });

// ---------- save ----------
function dataUrlToBlob(url) {
  const [head, b64] = url.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: head.match(/:(.*?);/)[1] });
}

$('btn-save').addEventListener('click', async () => {
  const { width, height } = editor.state.base;
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  editor.render(c.getContext('2d'));
  // Synchronous encoding keeps the tap's user activation, which iOS requires for share().
  const url = c.toDataURL('image/jpeg', 0.92);
  const file = new File([dataUrlToBlob(url)], 'hairstyle.jpg', { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  $('saved-img').src = url;
  $('saved').hidden = false;
});
$('saved-close').addEventListener('click', () => { $('saved').hidden = true; });

window.addEventListener('resize', requestDraw);
updateControls();
draw();
