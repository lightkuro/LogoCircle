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

async function fresh(browser, phone, { starter = false } = {}) {
  const ctx = await browser.newContext(phone ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } });
  // A first visit loads a starter example; most checks want an empty canvas instead.
  if (!starter) await ctx.addInitScript(() => localStorage.setItem('lc.seen', '1'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__lc && window.__lc.ui().stage.w > 0);
  return { ctx, page, errors };
}

const GROUPS = { Line: 'Lines', Curve: 'Lines', Draw: 'Lines', Square: 'Shapes', Triangle: 'Shapes', Polygon: 'Shapes', Star: 'Shapes' };

/** Add an outline (or pick a tool) through the dock. Some live behind a group button. */
async function add(page, _phone, name) {
  const group = GROUPS[name];
  if (!group) return page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: group, exact: true }).hover();
  await page.waitForTimeout(320);
  await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
}

/** Put the color in hand for coloring areas (with nothing selected, or it would color the selection instead). */
async function pickColor(page, n) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: `Color ${n}`, exact: true }).click();
  await page.waitForTimeout(150);
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
  await pickColor(page, 1);
  await clickDoc(page, 380, 500);
  await clickDoc(page, 560, 480);
  await clickDoc(page, 720, 390);
  let s = await state(page);
  check(s.shapes === 1, `areas above the line merged into one shape (got ${s.shapes})`);
  // The fill follows when an outline is moved: nudge the head and the shape must change with it.
  const before = await page.evaluate(() => window.__lc.svg());
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(() => {
    const d = window.__lc.doc();
    window.__lc.ui().select([d.guides[1].id]);
  });
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  const after = await page.evaluate(() => window.__lc.svg());
  s = await state(page);
  check(s.shapes === 1 && after !== before, 'moving an outline reshapes the fill that follows it');
  await page.keyboard.press('Escape');
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

  await pickColor(page, 2);
  // every other band inside the circle
  const mid = (i) => ys[i] + gaps[0] / 2;
  await clickDoc(page, 512, mid(0));
  await clickDoc(page, 512, mid(2));
  await page.getByRole('button', { name: 'Color 1', exact: true }).click();
  await clickDoc(page, 512, ys[0] - 30);
  let s = await state(page);
  check(s.shapes === 3, `three separate colored bands (got ${s.shapes})`);
  // Cut straight down through everything: each band falls into two pieces.
  await page.getByRole('button', { name: 'Cut', exact: true }).click();
  await drag(page, [512, 300], [512, 720]);
  s = await state(page);
  const cuts = await page.evaluate(() => window.__lc.doc().guides.filter((g) => g.type === 'line' && g.cut).length);
  check(s.shapes === 6 && cuts === 1, `a cut splits the three bands into six pieces and leaves a cut line (got ${s.shapes}, ${cuts})`);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
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
  await page.waitForTimeout(450); // a quick double-click would open the word for retyping instead
  await clickDoc(page, stem[0], stem[1]);
  s = await state(page);
  check(s.selection === 1, 'second tap selects the letter');
  // …and a quick double-click does open it for retyping
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const sp = await toScreen(page, stem[0], stem[1]);
  await page.mouse.dblclick(sp.x, sp.y);
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__lc.ui().sheet === 'text' && !!window.__lc.ui().textTarget), 'double-click opens the word for retyping');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(400);

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
  await page.keyboard.press('Escape');
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
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await pickColor(page, 1);
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
  // Holding still and then dragging draws a selection box.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+0');
  const stage = await page.evaluate(() => {
    const r = document.querySelector('.stage-svg').getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  const from = [stage.x + 30, stage.y + 190];
  await touchEv('touchStart', [from]);
  await page.waitForTimeout(650);
  for (let i = 1; i <= 8; i++) await touchEv('touchMove', [[from[0] + i * 40, from[1] + i * 45]]);
  await touchEv('touchEnd', []);
  await page.waitForTimeout(150);
  check((await state(page)).selection === 1, 'holding still, then dragging, box-selects');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

/** Mouse controls, select modes, grouping, drawing and the smaller tools (desktop). */
async function controls(browser) {
  console.log('\nMouse controls, select modes and tools (desktop)');
  const { ctx, page, errors } = await fresh(browser, false);
  const btn = (name) => page.getByRole('button', { name, exact: true });
  const ui = () =>
    page.evaluate(() => {
      const u = window.__lc.ui();
      return { tool: u.tool, sel: u.selection.length, view: u.view, mode: u.selectMode, brush: u.brushWidth };
    });
  const doc = () => page.evaluate(() => window.__lc.doc());
  const pick = async (group, item) => {
    await btn(group).hover();
    await page.waitForTimeout(320);
    await page.getByRole('menuitem', { name: new RegExp(`^${item}`) }).click();
  };
  /** Drag through a list of document points. */
  const stroke = async (pts) => {
    const first = await toScreen(page, pts[0][0], pts[0][1]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const q of pts.slice(1)) {
      const s = await toScreen(page, q[0], q[1]);
      await page.mouse.move(s.x, s.y, { steps: 4 });
    }
    await page.mouse.up();
  };

  // Panning and selecting
  let v0 = (await ui()).view;
  await drag(page, [100, 100], [200, 160]);
  let v1 = (await ui()).view;
  check(Math.abs(v1.x - v0.x) > 30 && Math.abs(v1.y - v0.y) > 20, 'dragging empty canvas with the left button pans');
  await page.keyboard.press('Control+0');
  await btn('Circle').click();
  await btn('Circle').click();
  await page.keyboard.press('Escape');
  await page.keyboard.down('Shift');
  await drag(page, [150, 150], [900, 900]);
  await page.keyboard.up('Shift');
  check((await ui()).sel === 2, 'Shift-drag box-selects');
  await page.keyboard.press('Control+g');
  let d = await doc();
  check(d.guides.every((g) => g.group) && Object.keys(d.groups).length === 1, 'Ctrl+G groups outlines');
  await page.keyboard.press('Escape');
  const g0 = d.guides[0];
  await clickDoc(page, g0.cx - g0.rx * Math.SQRT1_2, g0.cy - g0.ry * Math.SQRT1_2);
  check((await ui()).sel === 2, 'clicking one member selects the whole group');
  await page.keyboard.press('Control+Shift+g');
  check(Object.keys((await doc()).groups).length === 0, 'Ctrl+Shift+G ungroups');
  await page.keyboard.press('Escape');
  await pick('Select', 'Lasso');
  await stroke([[150, 150], [900, 150], [900, 900], [150, 900], [150, 160]]);
  check((await ui()).sel === 2, 'the lasso selects what it surrounds');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  check((await ui()).mode === 'move', 'Esc returns to moving things');
  await pick('Select', 'Pan');
  v0 = (await ui()).view;
  await drag(page, [g0.cx, g0.cy], [g0.cx + 60, g0.cy + 40]);
  v1 = (await ui()).view;
  d = await doc();
  check(Math.abs(v1.x - v0.x) > 10 && d.guides[0].cx === g0.cx, 'Pan pans even when the drag starts on something');
  await pick('Select', 'Move');
  await page.keyboard.press('Control+0');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');

  // Draw and Brush
  await pick('Lines', 'Draw');
  const wave = [];
  for (let i = 0; i <= 30; i++) wave.push([250 + i * 16, 500 + Math.sin(i / 4) * 120]);
  await stroke(wave);
  d = await doc();
  const curve = d.guides.at(-1);
  check(curve?.type === 'curve' && curve.pts.length >= 3 && curve.pts.length <= 14, `Draw turns a wobbly line into a smooth curve with few points (${curve?.pts?.length})`);
  await btn('Done').click();
  check((await ui()).tool === 'arrange', 'Done leaves the tool');
  await btn('Brush').click();
  check((await page.getByRole('slider', { name: 'Brush size' }).getAttribute('max')) === '60', 'the brush slider tops out at 60');
  await page.getByLabel('Brush size value').fill('90');
  await page.getByLabel('Brush size value').press('Enter');
  check((await ui()).brush === 90, 'a bigger brush size can be typed');
  await page.getByLabel('Brush size value').fill('20');
  await page.getByLabel('Brush size value').press('Enter');
  await drag(page, [300, 250], [700, 300]);
  d = await doc();
  check(d.shapes.length === 1 && d.shapes[0].fill === 0, 'the brush paints a stroke in Classic');
  await btn('Brush').click();
  check((await ui()).tool === 'arrange', 'clicking the active tool again switches it off');

  // Coloring a selection, ordering, thickness, kept rotation
  await btn('Circle').click();
  await btn('Color 2').click();
  d = await doc();
  check(d.shapes.length === 2 && Boolean(d.shapes[1].from?.area), 'clicking a color with a closed outline selected fills it');
  const top = d.shapes[1].id;
  await page.evaluate((id) => window.__lc.ui().select([id]), top);
  const centre = await toScreen(page, d.guides.at(-1).cx, d.guides.at(-1).cy);
  await page.mouse.click(centre.x, centre.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Send to back' }).click();
  check((await doc()).shapes[0].id === top, 'right-click → Send to back reorders');
  await page.keyboard.press('Escape');
  await pick('Lines', 'Line');
  await page.waitForTimeout(500);
  const chip = btn('Thickness');
  const x0 = (await chip.boundingBox()).x;
  await chip.click();
  await page.waitForTimeout(400); // let the popover finish opening before measuring it
  const numBox = async () => (await page.getByLabel('Thickness value').boundingBox()).x;
  const n0 = await numBox();
  await page.getByLabel('Thickness value').fill('30');
  await page.getByLabel('Thickness value').press('Enter');
  await page.waitForTimeout(200);
  const x1 = (await chip.boundingBox()).x;
  const n1 = await numBox();
  check(Math.abs(x1 - x0) < 0.5 && Math.abs(n1 - n0) < 0.5, `the Thickness control stays put going from thin to thick (${x0.toFixed(1)} → ${x1.toFixed(1)}, ${n0.toFixed(1)} → ${n1.toFixed(1)})`);
  check((await doc()).guides.at(-1).width === 30, 'the line is now 30 thick');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await pick('Shapes', 'Triangle');
  const knob = await page.evaluate(() => {
    const r = document.querySelector('.handle-rot').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(knob.x, knob.y);
  await page.mouse.down();
  await page.mouse.move(knob.x + 90, knob.y + 30, { steps: 6 });
  await page.mouse.up();
  const tri = (await doc()).guides.at(-1);
  check(Math.abs(tri.rot || 0) > 0.2, 'a turned triangle remembers its angle');
  await page.keyboard.press('Escape');
  await clickDoc(page, tri.pts[0].x, tri.pts[0].y);
  const frame = await page.evaluate(() =>
    document
      .querySelector('.sel-frame')
      .getAttribute('points')
      .split(' ')
      .map((p) => p.split(',').map(Number)),
  );
  check(Math.abs(Math.atan2(frame[1][1] - frame[0][1], frame[1][0] - frame[0][0]) - tri.rot) < 0.02, 'selecting it again shows the box still turned with it');

  // Examples keep to their own colors
  for (const name of ['Leaf', 'Sunset', 'Fish', 'Orbit', 'moon']) {
    await btn('Menu').click();
    await page.getByRole('button', { name: /^Examples/ }).click();
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
    await page.waitForFunction((n) => window.__lc.doc().name === n, name);
    const ex = await doc();
    const used = new Set(ex.shapes.map((sh) => sh.fill));
    check(ex.shapes.length > 0 && [...used].every((f) => Number.isInteger(f) && f < ex.palette.length) && used.size === ex.palette.length, `the ${name} example uses each of its ${ex.palette.length} colors`);
  }
  await page.screenshot({ path: join(shots, 'controls-desktop.png') });
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

async function firstVisit(browser, phone) {
  console.log(`\nFirst visit, colors and export frame (${phone ? 'phone' : 'desktop'})`);
  const { ctx, page, errors } = await fresh(browser, phone, { starter: true });
  await page.waitForFunction(() => window.__lc.doc().shapes.length >= 3, null, { timeout: 15000 }).catch(() => {});
  let d = await page.evaluate(() => {
    const doc = window.__lc.doc();
    return { shapes: doc.shapes.length, word: Object.values(doc.groups)[0]?.text?.value, colors: doc.palette.length };
  });
  check(d.shapes >= 3 && d.word === 'default' && d.colors === 2, `starts with a small example and two colors (${d.shapes} shapes, "${d.word}", ${d.colors} colors)`);

  // Colors: add up to four, never more in Classic; remove one again.
  const addBtn = page.getByRole('button', { name: 'Add a color', exact: true });
  await addBtn.click();
  await page.keyboard.press('Escape');
  await addBtn.click();
  await page.keyboard.press('Escape');
  const n = await page.evaluate(() => window.__lc.doc().palette);
  check(n.length === 4 && n[2] === '#000000' && !(await addBtn.isVisible().catch(() => false)), `Classic stops at four colors, the third starts black (${n.join(' ')})`);
  await page.getByRole('button', { name: 'Color 4', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove color' }).click();
  check((await page.evaluate(() => window.__lc.doc().palette.length)) === 3, 'right-click on a color removes it');

  // Select an outline and click a color: it is colored directly, as a ring once it has thickness.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await page.getByRole('button', { name: 'Thickness' }).click();
  await page.getByLabel('Thickness value').fill('40');
  await page.getByLabel('Thickness value').press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Color 1', exact: true }).click();
  d = await page.evaluate(() => {
    const doc = window.__lc.doc();
    const s = doc.shapes[0];
    return { n: doc.shapes.length, rings: s?.rings.length, tool: window.__lc.ui().tool, radii: s?.rings.map((r) => Math.round(r[0].c.rx)).sort((a, b) => a - b), r: Math.round(doc.guides[0].rx) };
  });
  check(d.n === 1 && d.rings === 2 && d.tool === 'arrange' && d.radii[0] === d.r - 40 && d.radii[1] === d.r, `a thick circle colors as a ring that thickens inward (${d.radii} of ${d.r})`);

  // The export frame can be moved and resized.
  const sp = await toScreen(page, 100, 100);
  await page.mouse.click(sp.x, sp.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /Adjust the export frame/ }).click();
  await drag(page, [1024, 1024], [900, 700]);
  await page.getByRole('button', { name: '16:9', exact: true }).click();
  const b = await page.evaluate(() => window.__lc.doc().artboard);
  check(Math.abs(b.w / b.h - 16 / 9) < 0.02 && b.w !== 1024, `the export frame resizes and takes a 16:9 shape (${b.w} × ${b.h})`);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const svg = await page.evaluate(() => window.__lc.svg());
  check(svg.includes(`viewBox="${b.x} ${b.y} ${b.w} ${b.h}"`), 'the export uses that frame');
  await page.screenshot({ path: join(shots, `first-${phone ? 'phone' : 'desktop'}.png`) });
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
    await firstVisit(browser, phone);
  }
  await controls(browser);
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
