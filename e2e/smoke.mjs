// End-to-end smoke test: rebuilds the three kinds of logo the app was designed
// around, on a desktop and a phone viewport, and checks what gets exported.
//
//   npm run build && npm run e2e
//
// Needs Playwright with Chromium available (`npm i -D playwright && npx playwright install chromium`).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}
const { chromium, devices } = pw;

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env.E2E_SHOTS || join(here, 'shots');
mkdirSync(shots, { recursive: true });
const PORT = 4179;
const URL = `http://localhost:${PORT}/`;

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures++;
};

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

/** Screen position of a document point. */
const toScreen = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const v = window.__lc.ui().view;
    const r = document.querySelector('.stage-svg').getBoundingClientRect();
    return { x: r.left + px * v.k + v.x, y: r.top + py * v.k + v.y };
  }, [x, y]);

const state = (page) =>
  page.evaluate(() => {
    const d = window.__lc.doc();
    return { shapes: d.shapes.length, guides: d.guides.length, refs: d.refs.length, groups: Object.keys(d.groups).length, selection: window.__lc.ui().selection.length };
  });

async function fresh(browser, phone) {
  const ctx = await browser.newContext(phone ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__lc && window.__lc.ui().stage.w > 0);
  return { ctx, page, errors };
}

/** Add an outline through the UI. On phones the add tray has to be opened first. */
async function add(page, phone, name) {
  const b = page.getByRole('button', { name, exact: true });
  if (phone && !(await b.isVisible().catch(() => false))) await page.getByRole('button', { name: 'Add', exact: true }).click();
  await b.click();
}

/** Drag from one document point to another with the mouse (works under touch emulation too). */
async function drag(page, from, to) {
  const a = await toScreen(page, from[0], from[1]);
  const b = await toScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

async function clickDoc(page, x, y) {
  const p = await toScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Put the selected outline's centre at a document point by dragging it there. */
async function moveSelectionTo(page, x, y) {
  const c = await page.evaluate(() => {
    const d = window.__lc.doc();
    const id = window.__lc.ui().selection[0];
    const g = d.guides.find((q) => q.id === id);
    if (g.type === 'ellipse' || g.type === 'rect') return [g.cx, g.cy];
    if (g.type === 'line') return [(g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2];
    const pts = g.pts;
    return [pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length];
  });
  // The selected thing moves when dragged from anywhere inside it, whatever else is on top there.
  return drag(page, c, [x, y]);
}

// ---------------------------------------------------------------------------

async function photoToLogo(browser, phone) {
  console.log(`\nPhoto → logo (${phone ? 'phone' : 'desktop'})`);
  const { ctx, page, errors } = await fresh(browser, phone);
  // A stand-in photo, drawn in the page.
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const g = c.getContext('2d');
    g.fillStyle = '#8f9aa0';
    g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#222';
    g.beginPath();
    g.ellipse(300, 260, 170, 90, 0, 0, 7);
    g.fill();
    g.beginPath();
    g.arc(470, 190, 60, 0, 7);
    g.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  if (phone) await page.getByRole('button', { name: 'Add', exact: true }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Photo', exact: true }).click()]);
  await chooser.setFiles({ name: 'cat.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForFunction(() => window.__lc.doc().refs.length === 1);
  check((await state(page)).refs === 1, 'photo placed');

  // Body, head, and a ground line.
  await add(page, phone, 'Circle');
  await moveSelectionTo(page, 470, 540);
  await add(page, phone, 'Circle');
  await moveSelectionTo(page, 640, 430);
  await add(page, phone, 'Line');
  await moveSelectionTo(page, 512, 600);
  check((await state(page)).guides === 3, 'three outlines over the photo');

  // Color: body, overlap and head; drag across to merge.
  await page.getByRole('button', { name: 'Color 1', exact: true }).click();
  await page.waitForTimeout(150);
  await clickDoc(page, 380, 500);
  await clickDoc(page, 560, 480);
  await clickDoc(page, 720, 390);
  let s = await state(page);
  check(s.shapes === 1, `areas above the line merged into one shape (got ${s.shapes})`);
  await page.getByRole('button', { name: /outlines/ }).click();
  await page.screenshot({ path: join(shots, `photo-${phone ? 'phone' : 'desktop'}.png`) });
  const svg = await page.evaluate(() => window.__lc.svg());
  check(/<path /.test(svg) && / A?\d|A\d/.test(svg) && svg.includes('A'), 'export contains true arcs');
  check(!svg.includes('<image'), 'the photo is not exported');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

async function geometric(browser, phone) {
  console.log(`\nGeometric construction (${phone ? 'phone' : 'desktop'})`);
  const { ctx, page, errors } = await fresh(browser, phone);
  await add(page, phone, 'Circle');
  await moveSelectionTo(page, 512, 512);
  await add(page, phone, 'Line');
  await moveSelectionTo(page, 512, 400);
  // A family of parallel lines: duplicate once, place it, then Repeat.
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await moveSelectionTo(page, 512, 456);
  const repeat = page.getByRole('button', { name: /^Repeat/ });
  await repeat.click();
  await repeat.click();
  await repeat.click();
  const ys = await page.evaluate(() => window.__lc.doc().guides.filter((g) => g.type === 'line').map((g) => Math.round(g.y0)));
  const gaps = ys.slice(1).map((y, i) => y - ys[i]);
  check(ys.length === 5 && gaps.every((g) => Math.abs(g - gaps[0]) <= 1), `Repeat made evenly spaced lines (${ys.join(', ')})`);

  await page.getByRole('button', { name: 'Color 2', exact: true }).click();
  await page.waitForTimeout(150);
  // every other band inside the circle
  const mid = (i) => ys[i] + gaps[0] / 2;
  await clickDoc(page, 512, mid(0));
  await clickDoc(page, 512, mid(2));
  await page.getByRole('button', { name: 'Color 1', exact: true }).click();
  await clickDoc(page, 512, ys[0] - 30);
  const s = await state(page);
  check(s.shapes === 3, `three separate colored bands (got ${s.shapes})`);
  await page.screenshot({ path: join(shots, `geometric-${phone ? 'phone' : 'desktop'}.png`) });
  const withLines = await page.evaluate(() => window.__lc.svg({ guides: true }));
  check(withLines.includes('<g fill="none"'), 'export can include the construction lines');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

async function wordmark(browser, phone) {
  console.log(`\nWordmark (${phone ? 'phone' : 'desktop'})`);
  const { ctx, page, errors } = await fresh(browser, phone);
  await add(page, phone, 'Text');
  await page.getByLabel('Text', { exact: true }).fill('bird');
  await page.getByRole('button', { name: 'Add to canvas' }).click();
  await page.waitForFunction(() => window.__lc.doc().shapes.length === 4);
  let s = await state(page);
  check(s.shapes === 4 && s.groups === 1 && s.selection === 4, 'four letters, one word, selected together');

  // Tap the word again: just that letter.
  const d = await page.evaluate(() => {
    const doc = window.__lc.doc();
    const pts = [];
    for (const ring of doc.shapes[3].rings) for (const e of ring) pts.push(e.c.k === 'L' ? [e.c.x0, e.c.y0] : e.c.k === 'C' ? [e.c.x0, e.c.y0] : [e.c.cx, e.c.cy]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  const stem = [d.x1 - (d.x1 - d.x0) * 0.1, d.y0 + (d.y1 - d.y0) * 0.2];
  await page.keyboard.press('Escape');
  await clickDoc(page, stem[0], stem[1]);
  s = await state(page);
  check(s.selection === 4, 'first tap selects the whole word');
  await clickDoc(page, stem[0], stem[1]);
  s = await state(page);
  check(s.selection === 1, 'second tap selects the letter');

  // A small circle over the top-left of the d's bowl, then erase what it covers: the bird's head.
  await page.keyboard.press('Escape');
  await add(page, phone, 'Circle');
  const w = d.x1 - d.x0;
  const h = d.y1 - d.y0;
  // Shrink it with its corner handle (corners scale evenly), then drag it into place.
  const c0 = await page.evaluate(() => {
    const g = window.__lc.doc().guides.at(-1);
    return { cx: g.cx, cy: g.cy, r: g.rx };
  });
  await drag(page, [c0.cx + c0.r, c0.cy + c0.r], [c0.cx - c0.r + 68, c0.cy - c0.r + 68]);
  const r1 = await page.evaluate(() => window.__lc.doc().guides.at(-1).rx);
  check(Math.abs(r1 - 34) < 2, `corner handle resized the circle evenly (radius ${r1.toFixed(1)})`);
  await moveSelectionTo(page, d.x0 + w * 0.3, d.y1 - h * 0.62);
  const before = await page.evaluate(() => JSON.stringify(window.__lc.doc().shapes[3].rings).length);
  await page.getByRole('button', { name: 'Erase', exact: true }).click();
  await page.waitForTimeout(150);
  // a spot on the bowl's ring that the circle covers
  await clickDoc(page, d.x0 + w * 0.42 - 28, d.y1 - h * 0.36 - 28);
  const after = await page.evaluate(() => {
    const doc = window.__lc.doc();
    return { n: doc.shapes.length, len: JSON.stringify(doc.shapes[doc.shapes.length - 1].rings).length, pristine: Object.values(doc.groups)[0]?.text?.pristine };
  });
  check(after.n === 4 && after.len !== before, 'the circle cut a piece out of the letter');
  check(after.pristine === false, 'a cut word is no longer offered for retyping');
  await page.getByRole('button', { name: /outlines/ }).click();
  await page.screenshot({ path: join(shots, `wordmark-${phone ? 'phone' : 'desktop'}.png`) });
  const svg = await page.evaluate(() => window.__lc.svg());
  check((svg.match(/<path /g) || []).length === 4 && svg.includes('C'), 'export has four letter paths with curves');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

async function touch(browser) {
  console.log('\nTouch gestures (phone)');
  const { ctx, page, errors } = await fresh(browser, true);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await page.getByRole('button', { name: 'Color 1', exact: true }).click();
  await page.waitForTimeout(150);
  const c = await page.evaluate(() => {
    const g = window.__lc.doc().guides[0];
    const v = window.__lc.ui().view;
    const r = document.querySelector('.stage-svg').getBoundingClientRect();
    return { x: r.left + g.cx * v.k + v.x, y: r.top + g.cy * v.k + v.y };
  });
  const cdp = await ctx.newCDPSession(page);
  const touchEv = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p[0], y: p[1], id })) });
  // One finger lands on the circle (would color it), then a second arrives: that is a pinch, nothing gets colored.
  const k0 = await page.evaluate(() => window.__lc.ui().view.k);
  await touchEv('touchStart', [[c.x, c.y]]);
  await touchEv('touchStart', [[c.x, c.y], [c.x + 60, c.y]]);
  await touchEv('touchMove', [[c.x - 40, c.y], [c.x + 100, c.y]]);
  await touchEv('touchEnd', []);
  await page.waitForTimeout(100);
  const k1 = await page.evaluate(() => window.__lc.ui().view.k);
  check((await state(page)).shapes === 0, 'a pinch that starts on an area colors nothing');
  check(k1 > k0 * 1.5, `the pinch zoomed in (${k0.toFixed(2)} → ${k1.toFixed(2)})`);
  // A single tap colors.
  const c2 = await page.evaluate(() => {
    const g = window.__lc.doc().guides[0];
    const v = window.__lc.ui().view;
    const r = document.querySelector('.stage-svg').getBoundingClientRect();
    return { x: r.left + g.cx * v.k + v.x, y: r.top + g.cy * v.k + v.y };
  });
  await page.touchscreen.tap(c2.x, c2.y);
  await page.waitForTimeout(100);
  check((await state(page)).shapes === 1, 'a tap colors the area');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  check((await state(page)).shapes === 0, 'undo brings it back');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

// ---------------------------------------------------------------------------

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', cwd: join(here, '..') });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  for (const phone of [false, true]) {
    await photoToLogo(browser, phone);
    await geometric(browser, phone);
    await wordmark(browser, phone);
  }
  await touch(browser);
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser?.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
