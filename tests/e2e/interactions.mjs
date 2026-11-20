// Usage: node tests/e2e/interactions.mjs <face.jpg> <style-with-face.jpg> <style-hair-no-face.jpg> [mediapipe-package-dir]
// Checks: (1) re-picking a photo during eye-tap mode ends eye-tap; (2) a second finger in erase mode cancels the stroke.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const [face, style, noFace, mpDir] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
if (mpDir) {
  await page.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.split('@0.10.14/')[1];
    await route.fulfill({ body: await readFile(path.join(mpDir, rel)), contentType: rel.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
}
await page.goto('http://localhost:8000/');
const idle = () => page.waitForFunction(() => {
  const s = document.getElementById('status'); return s.hidden || s.classList.contains('error');
}, null, { timeout: 90000 }).then(() => page.waitForTimeout(400));

const checks = {};
await page.setInputFiles('#file-face', face); await idle();
await page.setInputFiles('#file-style', noFace); await idle();
checks.eyeTapShownForNoFace = await page.isVisible('#eyetap');
await page.setInputFiles('#file-style', style); await idle();
checks.eyeTapClearedAfterRepick = !(await page.isVisible('#eyetap'));
checks.saveEnabledAfterRepick = await page.isEnabled('#btn-save');

// Two-finger interaction in erase mode
console.log('pre-erase checks', JSON.stringify(checks));
await page.click('[data-mode="erase"]', { timeout: 5000 });
const box = await page.locator('#view').boundingBox();
await page.evaluate(({ x, y, w, h }) => {
  const v = document.getElementById('view');
  const fire = (type, id, px, py) => v.dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: x + px * w, clientY: y + py * h, bubbles: true, isPrimary: id === 1, pointerType: 'touch',
  }));
  fire('pointerdown', 1, 0.3, 0.3);
  fire('pointerdown', 2, 0.7, 0.3);
  fire('pointermove', 2, 0.75, 0.35);
  fire('pointerup', 1, 0.3, 0.3);
  fire('pointermove', 2, 0.8, 0.6);
  fire('pointerup', 2, 0.8, 0.6);
}, { x: box.x, y: box.y, w: box.width, h: box.height });
await page.waitForTimeout(300);
checks.noStrokeFromTwoFingers = await page.evaluate(() => window.__hairApp.editor.state.strokes.length === 0);
await browser.close();

console.log(JSON.stringify({ checks, errors }, null, 2));
const ok = Object.values(checks).every(Boolean) && errors.length === 0;
console.log(ok ? 'INTERACTIONS PASS' : 'INTERACTIONS FAIL');
process.exit(ok ? 0 : 1);
