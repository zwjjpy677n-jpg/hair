// Usage: node tests/e2e/smoke.mjs <face.jpg> <style.jpg> [mediapipe-package-dir] [screenshot.png]
// Opens the app (served at http://localhost:8000) in iPhone 13 emulation, picks both photos,
// waits for processing and checks that a composite was drawn without errors.
// If a mediapipe package dir is given (npm pack of @mediapipe/tasks-vision@0.10.14),
// requests to cdn.jsdelivr.net are served from it (for sandboxes that block the CDN).
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [face, style, mpDir, shot = 'smoke.png'] = process.argv.slice(2);
if (!face || !style) { console.error('usage: smoke.mjs face.jpg style.jpg [mpdir] [shot.png]'); process.exit(2); }

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/^(INFO|[IW]\d{4})[: ]/.test(m.text())) errors.push(m.text()); });

if (mpDir) {
  await page.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.split('@0.10.14/')[1];
    const body = await readFile(path.join(mpDir, rel));
    const type = rel.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
    await route.fulfill({ body, contentType: type, headers: { 'access-control-allow-origin': '*' } });
  });
}

await page.goto('http://localhost:8000/');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

async function waitIdle() {
  await page.waitForFunction(() => {
    const s = document.getElementById('status');
    return s.hidden || s.classList.contains('error');
  }, null, { timeout: 90000 });
  // ignore transient states between steps
  await page.waitForTimeout(300);
  await page.waitForFunction(() => document.getElementById('status').hidden || document.getElementById('status').classList.contains('error'), null, { timeout: 90000 });
}

await page.setInputFiles('#file-face', face);
await waitIdle();
await page.setInputFiles('#file-style', style);
await waitIdle();

const result = await page.evaluate(() => {
  const s = document.getElementById('status');
  const v = document.getElementById('view');
  const d = v.getContext('2d').getImageData(0, 0, v.width, v.height).data;
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < d.length; i += 40) { sum += d[i]; sum2 += d[i] * d[i]; n++; }
  const mean = sum / n;
  return {
    statusError: !s.hidden && s.classList.contains('error') ? s.textContent : null,
    eyeTap: !document.getElementById('eyetap').hidden,
    saveEnabled: !document.getElementById('btn-save').disabled,
    variance: sum2 / n - mean * mean,
    size: [v.width, v.height],
  };
});
await page.screenshot({ path: shot });
await browser.close();

console.log(JSON.stringify({ ...result, overflow, errors }, null, 2));
const ok = !result.statusError && !result.eyeTap && result.saveEnabled && result.variance > 0 && !overflow && errors.length === 0;
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(ok ? 0 : 1);
