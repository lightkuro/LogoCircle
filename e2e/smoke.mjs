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
const PORT = Number(process.env.E2E_PORT) || 4179;
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

const GROUPS = { Circle: 'Shapes', Square: 'Shapes', Triangle: 'Shapes', Polygon: 'Shapes', Star: 'Shapes', Line: 'Lines', Curve: 'Lines', Draw: 'Lines', Brush: 'Lines' };

/** Add an outline (or pick a tool) through the dock. Some live behind a group button. */
async function add(page, _phone, name) {
  const group = GROUPS[name];
  if (!group) return page.getByRole('button', { name, exact: true }).click();
  return fromGroup(page, group, name);
}

/** Open one of the dock's groups (hovering does it) and choose from its list. `item` can be a path, as in 'Import photo/Choose photo'. */
async function fromGroup(page, group, item) {
  await page.getByRole('button', { name: group, exact: true }).hover();
  await page.waitForTimeout(320);
  for (const step of item.split('/')) {
    const name = new RegExp(`^${step}`);
    // a switch in the list (Cut lines, Sticky points) is a checkbox item; a plain item wins when both match
    const plain = page.getByRole('menuitem', { name });
    await ((await plain.count()) ? plain : page.getByRole('menuitemcheckbox', { name })).first().click();
  }
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
  // The photo is under More, which offers a file or the clipboard.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), fromGroup(page, 'More', 'Import photo/Choose photo')]);
  await chooser.setFiles({ name: 'cat.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForFunction(() => window.__lc.doc().refs.length === 1);
  check((await state(page)).refs === 1, 'photo placed');
  check((await page.getByRole('toolbar', { name: 'Photo' }).count()) === 1, 'its settings show straight away');
  await page.keyboard.press('Escape');

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
  // On a phone Repeat is one of the Options; on a desktop it is in the Repeat list in the bar.
  for (let i = 0; i < 3; i++) {
    if (phone) await page.getByRole('button', { name: 'Options', exact: true }).click();
    else await page.getByRole('button', { name: 'Repeat', exact: true }).hover();
    await page.getByRole('button', { name: /^Repeat, same spacing/ }).click();
    await page.waitForTimeout(phone ? 250 : 120);
  }
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
  await fromGroup(page, 'Cut', 'Cut');
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
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('bird');
  await page.getByRole('button', { name: /^Add( to canvas)?$/ }).click();
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
  await fromGroup(page, 'Cut', 'Erase');
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
  await add(page, true, 'Circle');
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
  await pick('Shapes', 'Circle');
  await page.keyboard.press('o'); // and once by its key
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
  await pick('Lines', 'Brush');
  check((await page.getByRole('slider', { name: 'Brush size' }).getAttribute('max')) === '60', 'the brush slider tops out at 60');
  await page.getByLabel('Brush size value').fill('90');
  await page.getByLabel('Brush size value').press('Enter');
  check((await ui()).brush === 90, 'a bigger brush size can be typed');
  await page.getByLabel('Brush size value').fill('20');
  await page.getByLabel('Brush size value').press('Enter');
  await drag(page, [300, 250], [700, 300]);
  d = await doc();
  check(d.shapes.length === 1 && d.shapes[0].fill === 0, 'the brush paints a stroke in Classic');
  await pick('Lines', 'Brush');
  check((await ui()).tool === 'arrange', 'choosing the active tool again switches it off');

  // Coloring a selection, ordering, thickness, kept rotation
  await pick('Shapes', 'Circle');
  await btn('Color 2').click();
  d = await doc();
  check(d.shapes.length === 2 && Boolean(d.shapes[1].from?.area), 'clicking a color with a closed outline selected fills it');
  const top = d.shapes[1].id;
  await page.evaluate((id) => window.__lc.ui().select([id]), top);
  const centre = await toScreen(page, d.guides.at(-1).cx, d.guides.at(-1).cy);
  await page.mouse.click(centre.x, centre.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Order/ }).hover();
  await page.getByRole('menuitem', { name: 'Send to back' }).click();
  check((await doc()).shapes[0].id === top, 'right-click → Order → Send to back reorders');
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
  for (const name of ['Leaf', 'Fish', 'Orbit', 'moon']) {
    // the question mark in the top bar (its popover has a button of the same name)
    await page.locator('.chrome-top').getByRole('button', { name: 'Help' }).click();
    await page.getByRole('button', { name: 'Examples', exact: true }).click();
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

/** Corner rounding, trimming, the mouse scheme, settings and the three-dots menu (desktop). */
async function refinements(browser) {
  console.log('\nCorners, trimming, settings (desktop)');
  const { ctx, page, errors } = await fresh(browser, false);
  const btn = (name) => page.getByRole('button', { name, exact: true });
  const doc = () => page.evaluate(() => window.__lc.doc());
  const ui = () =>
    page.evaluate(() => {
      const u = window.__lc.ui();
      return { tool: u.tool, sel: u.selection.length, view: u.view, menu: !!u.menu, sheet: u.sheet };
    });
  const mouseDrag = async (a, b, button) => {
    const p = await toScreen(page, a[0], a[1]);
    const q = await toScreen(page, b[0], b[1]);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button });
    await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
    await page.mouse.move(q.x, q.y, { steps: 4 });
    await page.mouse.up({ button });
  };

  // One corner of a square, by right-clicking it; then the amount, with the slider's number.
  await add(page, false, 'Square');
  let sq = (await doc()).guides.at(-1);
  const corner = await toScreen(page, sq.cx + sq.w / 2, sq.cy - sq.h / 2);
  await page.mouse.click(corner.x, corner.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Round this corner' }).click();
  sq = (await doc()).guides.at(-1);
  check(Array.isArray(sq.radii) && sq.radii[1] > 0 && sq.radii[0] === 0 && sq.radii[2] === 0 && sq.radii[3] === 0, `right-click → Round this corner rounds only that corner (${JSON.stringify(sq.radii)})`);
  await page.getByLabel('Corner rounding value').fill('25');
  await page.getByLabel('Corner rounding value').press('Enter');
  check((await doc()).guides.at(-1).radii[1] === 25, 'the amount of rounding can be set');
  await btn('Done').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');

  // Cut: clicking a piece of an outline removes just that piece.
  await add(page, false, 'Circle');
  await moveSelectionTo(page, 512, 512);
  await add(page, false, 'Line');
  await moveSelectionTo(page, 512, 512);
  await page.keyboard.press('Escape');
  const before = await doc();
  const ln = before.guides.find((g) => g.type === 'line');
  const circle = before.guides.find((g) => g.type === 'ellipse');
  check(ln.x0 < circle.cx - circle.rx && ln.x1 > circle.cx + circle.rx, 'the line crosses the whole circle');
  await fromGroup(page, 'Cut', 'Cut');
  const mid = await toScreen(page, 512, 512);
  await page.mouse.move(mid.x - 3, mid.y);
  await page.mouse.move(mid.x, mid.y);
  check((await page.locator('.trim-hot').count()) === 1, 'hovering shows the piece that would go');
  await page.mouse.click(mid.x, mid.y);
  let d = await doc();
  const lines = d.guides.filter((g) => g.type === 'line');
  check(lines.length === 2 && d.guides.some((g) => g.type === 'ellipse'), `clicking the line inside the circle leaves its two outer pieces (${lines.length})`);
  const top = await toScreen(page, circle.cx, circle.cy - circle.ry);
  await page.mouse.click(top.x, top.y);
  d = await doc();
  check(d.guides.filter((g) => g.type === 'edges').length === 1 && !d.guides.some((g) => g.type === 'ellipse'), 'clicking half of the circle leaves the other half');
  check(d.trimmed?.length === 2 && (await page.locator('.trimmed').count()) === 0, 'what was removed is kept, out of sight');
  // Show cut lines: the removed pieces come back as dots, and a click on one brings it back.
  await btn('Cut lines').click();
  check((await page.locator('.trimmed').count()) === 1, 'Show cut lines shows them dotted');
  await page.mouse.move(mid.x - 3, mid.y);
  await page.mouse.move(mid.x, mid.y);
  check((await page.locator('.restore-hot').count()) === 1, 'hovering a dotted piece shows it would come back');
  await page.mouse.click(mid.x, mid.y);
  d = await doc();
  check(d.trimmed?.length === 1 && d.guides.filter((g) => g.type === 'line').length === 3, 'clicking it brings the piece back as a line');
  await btn('Done').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');

  // A polygon: its sides stretch it, and new points come from the menu.
  await add(page, false, 'Polygon');
  let poly = (await doc()).guides.at(-1);
  const xs0 = poly.pts.map((p) => p.x);
  const right = Math.max(...xs0);
  const midY = (Math.min(...poly.pts.map((p) => p.y)) + Math.max(...poly.pts.map((p) => p.y))) / 2;
  check(poly.pts.length === 6 && new Set(poly.pts.map((p, i) => Math.round(Math.hypot(poly.pts[(i + 1) % 6].x - p.x, poly.pts[(i + 1) % 6].y - p.y)))).size === 1, 'a new polygon is a regular hexagon');
  await drag(page, [right, midY], [right + 120, midY]);
  poly = (await doc()).guides.at(-1);
  check(poly.pts.length === 6 && Math.max(...poly.pts.map((p) => p.x)) > right + 60, 'dragging its side stretches it, with no point added');
  const ea = poly.pts[0];
  const eb = poly.pts[1];
  const onEdge = await toScreen(page, (ea.x + eb.x) / 2, (ea.y + eb.y) / 2);
  await page.mouse.click(onEdge.x, onEdge.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Add a point here' }).click();
  check((await doc()).guides.at(-1).pts.length === 7, 'right-click on a side: Add a point here');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');

  // Sticky points: a corner brought near another corner lands exactly on it.
  await page.evaluate(() => window.__lc.ui().set({ snap: false }));
  await fromGroup(page, 'More', 'Sticky points');
  check(await page.evaluate(() => window.__lc.ui().stickyPoints), 'Sticky points can be switched on from More');
  await add(page, false, 'Square');
  await moveSelectionTo(page, 300, 300);
  await add(page, false, 'Square');
  const a = (await doc()).guides[0];
  let b = (await doc()).guides[1];
  // put b's top-left corner a few units off a's bottom-right corner
  const target = { x: a.cx + a.w / 2 + 5, y: a.cy + a.h / 2 + 4 };
  await drag(page, [b.cx, b.cy], [target.x + b.w / 2, target.y + b.h / 2]);
  b = (await doc()).guides[1];
  check(Math.abs(b.cx - b.w / 2 - (a.cx + a.w / 2)) < 0.01 && Math.abs(b.cy - b.h / 2 - (a.cy + a.h / 2)) < 0.01, 'with Sticky points on, the corners meet exactly');
  await fromGroup(page, 'More', 'Sticky points');
  await page.evaluate(() => window.__lc.ui().set({ snap: true }));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');

  // The right mouse button: a click opens the menu, a drag box-selects.
  await add(page, false, 'Circle');
  await page.keyboard.press('Escape');
  await mouseDrag([100, 100], [950, 950], 'right');
  let u = await ui();
  check(u.sel === 1 && !u.menu, 'dragging with the right button box-selects, with no menu');
  await page.keyboard.press('Escape');
  const empty = await toScreen(page, 60, 60);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  check((await ui()).menu, 'a right-click still opens the menu');
  await page.keyboard.press('Escape');

  // The background color: from More it opens above More, with a preview of the logo.
  await fromGroup(page, 'More', 'Background color');
  const bg = await page.getByRole('dialog', { name: 'Background color' }).boundingBox();
  const moreBtn = await btn('More').boundingBox();
  check(bg.y + bg.height <= moreBtn.y && Math.abs(bg.x + bg.width / 2 - (moreBtn.x + moreBtn.width / 2)) < bg.width / 2, 'Background color opens by the More button');
  check((await page.getByRole('img', { name: 'Preview' }).count()) === 1, 'with a preview of the logo on that background');
  await page.keyboard.press('Escape');
  // The hue strip runs from red to pink: red at one end only.
  await btn('Color 1').click();
  await btn('Color 1').click();
  const ends = await page.evaluate(() => {
    const bgi = getComputedStyle(document.querySelector('.picker2-strip')).backgroundImage;
    const stops = bgi.match(/rgb\([^)]+\)/g);
    return [stops[0], stops[stops.length - 1]];
  });
  check(ends[0] !== ends[1], `the hue strip does not end where it starts (${ends.join(' to ')})`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Settings: reached from the menu; keys can be changed; the mouse buttons can be swapped.
  await btn('Menu').click();
  check((await page.getByRole('button', { name: /^Examples/ }).count()) === 0 && (await page.getByRole('button', { name: /^How it works/ }).count()) <= 1, 'the menu no longer lists the help pages');
  const privacy = page.getByRole('link', { name: 'Privacy & terms' });
  check((await privacy.getAttribute('href')) === '/privacy', 'the menu links to Privacy & terms');
  const res = await page.request.get(`${URL}privacy`);
  check(res.ok() && (await res.text()).includes('Terms of use'), 'and that page is there');
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.getByRole('button', { name: /^Shortcut for Circle/ }).click();
  await page.keyboard.press('k');
  await page.getByRole('radio', { name: /Left drag box-selects/ }).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__lc.ui().sheet === null);
  await page.waitForTimeout(300);
  const n0 = (await doc()).guides.length;
  await page.keyboard.press('o');
  check((await doc()).guides.length === n0, 'after rebinding, the old key does nothing');
  await page.keyboard.press('k');
  check((await doc()).guides.length === n0 + 1, 'and the new key adds a circle');
  await page.keyboard.press('Escape');
  await mouseDrag([100, 100], [950, 950], 'left');
  check((await ui()).sel === 2, 'with the buttons swapped, a left drag box-selects');
  await page.keyboard.press('Escape');
  const v0 = (await ui()).view;
  await mouseDrag([100, 100], [300, 250], 'right');
  check(Math.abs((await ui()).view.x - v0.x) > 30, 'and a right drag moves the view');
  await page.evaluate(() => window.__lc.ui().set({ sheet: 'settings' }));
  await page.getByRole('switch', { name: 'Tool names' }).click();
  check((await page.locator('.dock .tool > span').first().isVisible()) === false && (await page.locator('.dock .tool[aria-label="Text"]').count()) === 1, 'Tool names off leaves icons only, still named for screen readers');
  await page.getByRole('switch', { name: 'Tool names' }).click();
  await page.getByRole('radio', { name: 'Mobile' }).click();
  check((await page.evaluate(() => document.documentElement.dataset.layout)) === 'phone', 'Layout: Mobile gives the phone interface on a big screen');
  await page.getByRole('button', { name: 'Reset all settings' }).click();
  check((await page.evaluate(() => document.documentElement.dataset.layout)) === 'desktop', 'Reset all settings undoes it');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__lc.ui().sheet === null);
  await page.waitForTimeout(300);

  // The three dots: Save, and back to the default design (which Undo reverses).
  await btn('More options').click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
  check(true, 'Save confirms that the logo is stored');
  const mine = (await doc()).guides.length;
  await btn('More options').click();
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await page.waitForFunction(() => Object.values(window.__lc.doc().groups).some((g) => g.text?.value === 'default'));
  check(true, 'Reset brings the default design back');
  await page.keyboard.press('Control+z');
  check((await doc()).guides.length === mine && !(await doc()).shapes.length, 'and Undo returns what was there');
  await page.screenshot({ path: join(shots, 'refinements-desktop.png') });
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

/** The phone layout: one bar of tools, colors at the side, the text panel on the lower half. */
async function phoneLayout(browser) {
  console.log('\nPhone layout and text panel');
  const { ctx, page, errors } = await fresh(browser, true);
  const btn = (name) => page.getByRole('button', { name, exact: true });
  const vh = page.viewportSize().height;
  const tools = await page.getByRole('toolbar', { name: 'Tools' }).boundingBox();
  const last = await btn('More').boundingBox();
  const select = await btn('Select').boundingBox();
  check(Math.abs(last.x + last.width - (tools.x + tools.width)) < 12 && select.x < last.x, 'More sits at the right end, just after Select');
  check((await page.locator('.tool-caret').count()) === 3, 'only Shapes, Lines and Cut carry an arrow');
  check((await page.getByRole('toolbar').count()) === 2, 'with nothing selected there is one bar of tools and the colors at the side');
  const strip = await page.getByRole('toolbar', { name: 'Colors' }).boundingBox();
  check(strip.x < 20 && strip.height > strip.width * 2, 'the colors run down the left edge');
  await btn('Hide colors').click();
  check((await page.getByRole('toolbar', { name: 'Colors' }).count()) === 0, 'and fold away');
  await btn('Show colors').click();

  // Text: half the screen at most, more on request, and "Test" when nothing is typed.
  await btn('Text').click();
  await page.waitForTimeout(600);
  const panel = page.getByRole('dialog', { name: 'Add text' });
  check((await panel.boundingBox()).height <= vh * 0.51, 'the text panel takes at most half the screen');
  check(await page.evaluate(() => document.activeElement?.tagName !== 'INPUT'), 'without calling up the keyboard');
  // Each setting is a page of its own, usable at half height.
  check((await page.getByRole('group', { name: 'Fonts' }).count()) === 1, 'it opens on the fonts');
  await page.getByRole('radio', { name: 'Size' }).click();
  const sizeBox = await page.getByRole('slider', { name: 'Size' }).boundingBox();
  const spacingBox = await page.getByRole('slider', { name: 'Letter spacing' }).boundingBox();
  const panelBox = await panel.boundingBox();
  check(sizeBox.y + sizeBox.height <= panelBox.y + panelBox.height && spacingBox.y + spacingBox.height <= panelBox.y + panelBox.height, 'Size shows both sliders without scrolling or growing the panel');
  const h0 = (await page.getByLabel('Preview').boundingBox()).height;
  await page.getByLabel('Size value').fill('460');
  await page.getByLabel('Size value').press('Enter');
  await page.waitForTimeout(150);
  check((await page.getByLabel('Preview').boundingBox()).height > h0 * 1.2, 'the preview shows the size as it changes');
  await page.getByRole('radio', { name: 'Color' }).click();
  check((await page.getByRole('group', { name: 'Color' }).count()) === 1, 'Color is a page too');
  // More room for fonts is there when wanted.
  await page.getByRole('radio', { name: 'Font' }).click();
  await btn('Make the panel bigger').click();
  await page.waitForTimeout(500);
  check((await panel.boundingBox()).height > vh * 0.85, 'the panel opens up to show more fonts at once');
  const y0 = (await page.getByLabel('Preview').boundingBox()).y;
  await page.locator('.txp-body').evaluate((el) => el.scrollTo(0, 900));
  await page.waitForTimeout(150);
  check(Math.abs((await page.getByLabel('Preview').boundingBox()).y - y0) < 1, 'the preview stays in place while the fonts scroll');
  await btn('Add').click();
  await page.waitForFunction(() => window.__lc.ui().sheet === null);
  check((await page.evaluate(() => Object.values(window.__lc.doc().groups)[0]?.text?.value)) === 'Test', 'adding with nothing typed places the word Test');
  await page.waitForTimeout(450);

  // A selection: a couple of buttons, the rest under Options. A tool: its hint at the top, Done at the bottom.
  const bar = page.getByRole('toolbar', { name: 'Selection' });
  check((await bar.getByRole('button').count()) <= 3, 'a selection shows at most three buttons');
  const barBox = await bar.boundingBox();
  check(barBox.x >= 0 && barBox.x + barBox.width <= page.viewportSize().width, 'and its bar fits the screen without scrolling');
  await page.keyboard.press('Escape');
  await fromGroup(page, 'Cut', 'Cut');
  const hint = await page.locator('.hint-pill').boundingBox();
  const done = await btn('Done').boundingBox();
  check(hint.y < vh * 0.25 && done.y > vh * 0.6, 'a tool puts its hint at the top and Done at the bottom');
  check(/^Tap /.test(await page.locator('.hint-pill').innerText()), 'the hint speaks of tapping, not clicking');
  await btn('Done').click();

  // The background color, from More: its panel stays clear of the bars above and below.
  await btn('More').click();
  await page.getByRole('menuitem', { name: 'Background color' }).click();
  const bgPanel = await page.getByRole('dialog', { name: 'Background color' }).boundingBox();
  const topBars = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.chrome-top > *')].map((e) => e.getBoundingClientRect().bottom)));
  const dockTop = (await page.getByRole('toolbar', { name: 'Tools' }).boundingBox()).y;
  check(bgPanel.y >= topBars && bgPanel.y + bgPanel.height <= dockTop, `the background color panel sits between the bars (${Math.round(bgPanel.y)} to ${Math.round(bgPanel.y + bgPanel.height)})`);
  check((await page.evaluate(() => window.__lc.doc().paper)) === '#f5f1e8', 'a new logo starts on the paper color');
  await page.keyboard.press('Escape');
  // The Cut menu: the cut-lines switch first, shown by its eye.
  await btn('Cut').click();
  const cutItems = await page.getByRole('menu', { name: 'Cut' }).locator('.menu-item').allInnerTexts();
  check(cutItems[0]?.trim() === 'Cut lines' && cutItems.length === 3, `Cut lines comes first in the Cut menu (${cutItems.map((t) => t.trim()).join(', ')})`);
  await page.keyboard.press('Escape');
  // The color sets, in their order and names.
  await btn('Color 1').click();
  await btn('Color 1').click();
  await page.getByRole('button', { name: 'Sets' }).click();
  const sets = await page.getByRole('group', { name: 'Color sets' }).locator('.menu-item').allInnerTexts();
  check(sets.join(',') === 'Soft,Coffee,Pear,Cars,Deer,Taco,Soda,Burger', `the color sets (${sets.join(', ')})`);
  const setsPanel = await page.getByRole('dialog', { name: 'Color 1' }).boundingBox();
  const lowBars = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.chrome-bottom > *')].map((e) => e.getBoundingClientRect().top)));
  check(setsPanel.y >= topBars && setsPanel.y + setsPanel.height <= lowBars, 'with the sets open, the panel still clears the bars');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // The question mark: three steps, then Guide and Examples.
  await btn('Help').click();
  const helpButtons = await page.locator('.pop').filter({ hasText: 'Simply:' }).getByRole('button').allInnerTexts();
  check(helpButtons.join(',') === 'Guide,Examples', `help offers Guide, then Examples (${helpButtons.join(', ')})`);
  await page.keyboard.press('Escape');

  // Photo lives under More, in Import photo, with a way to paste one.
  await btn('More').click();
  await page.getByRole('menuitem', { name: 'Import photo' }).click();
  check((await page.getByRole('menuitem', { name: 'Choose photo' }).count()) === 1 && (await page.getByRole('menuitem', { name: 'Paste photo' }).count()) === 1, 'More, Import photo offers choosing or pasting a photo');
  await page.keyboard.press('Escape');
  await btn('More options').click();
  check((await page.getByRole('button', { name: 'Redo' }).count()) === 1 && (await page.getByRole('button', { name: 'Export' }).count()) === 1, 'the three dots hold Redo, Save and Export');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join(shots, 'phone-layout.png') });
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

/** A phone on its side: controls down both edges, the canvas at full height between them. */
async function sideways(browser) {
  console.log('\nPhone on its side');
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__lc && window.__lc.ui().stage.w > 0);
  await page.waitForTimeout(500);
  const btn = (name) => page.getByRole('button', { name, exact: true });
  const vw = page.viewportSize().width;
  const vh = page.viewportSize().height;
  check((await page.evaluate(() => document.documentElement.dataset.layout)) === 'side', 'turned sideways, the phone gets the side layout');
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('.chrome-top > *, .side-left > *, .side-right > *, .chrome-bottom > *')].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, r: r.right, b: r.bottom };
    }),
  );
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1) overlaps++;
    }
  check(boxes.length >= 5 && overlaps === 0, `no two controls overlap (${boxes.length} groups)`);
  const board = await page.evaluate(() => {
    const d = window.__lc.doc().artboard;
    const v = window.__lc.ui().view;
    const left = document.querySelector('.side-left').getBoundingClientRect().right;
    const right = document.querySelector('.side-right').getBoundingClientRect().left;
    return { x: (d.x ?? 0) * v.k + v.x, y: (d.y ?? 0) * v.k + v.y, w: d.w * v.k, h: d.h * v.k, left, right };
  });
  check(board.x >= board.left && board.x + board.w <= board.right, 'the canvas sits between the two columns of controls');
  check(board.h > vh * 0.85, `and gets nearly the full height (${Math.round(board.h)} of ${vh})`);
  const select = await btn('Select').boundingBox();
  check(select.x > board.x + board.w, 'Select is on the right, with the zoom');
  check((await page.getByRole('button', { name: 'Zoom in' }).count()) === 1, 'the zoom buttons are there');
  await btn('More').click();
  const item = page.getByRole('menuitem', { name: 'Import photo' });
  check((await item.count()) === 1, 'Photo is under More');
  const ib = await item.boundingBox();
  const onTop = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[role=menuitem]')?.textContent, [ib.x + ib.width / 2, ib.y + ib.height / 2]);
  check(onTop === 'Import photo', 'the list opens over everything beside it');
  check(ib.y + ib.height <= vh, 'and stays on screen');
  await page.keyboard.press('Escape');
  await btn('Text').click();
  await page.waitForTimeout(500);
  const panel = await page.getByRole('dialog', { name: 'Add text' }).boundingBox();
  check(panel.x < 60 && panel.height > vh * 0.8 && panel.width < vw * 0.6, 'the text panel runs down the left side');
  await page.getByRole('radio', { name: 'Size' }).click();
  const slider = await page.getByRole('slider', { name: 'Letter spacing' }).boundingBox();
  check(slider.y + slider.height <= panel.y + panel.height, 'and its sliders fit');
  await btn('Close').click();
  await page.waitForTimeout(400);
  // Turning the phone upright brings back the bar along the bottom.
  await page.setViewportSize({ width: 390, height: 664 });
  await page.waitForTimeout(400);
  const dock = await page.getByRole('toolbar', { name: 'Tools' }).boundingBox();
  check((await page.evaluate(() => document.documentElement.dataset.layout)) === 'phone' && dock.y > 664 * 0.7 && dock.width > dock.height, 'turned upright, the tools go back along the bottom');
  await page.screenshot({ path: join(shots, 'sideways-upright.png') });
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

async function firstVisit(browser, phone) {
  console.log(`\nFirst visit, colors and export frame (${phone ? 'phone' : 'desktop'})`);
  const { ctx, page, errors } = await fresh(browser, phone, { starter: true });
  await page.waitForFunction(() => window.__lc.doc().shapes.length >= 3, null, { timeout: 15000 }).catch(() => {});
  let d = await page.evaluate(() => {
    const doc = window.__lc.doc();
    return { shapes: doc.shapes.length, words: Object.values(doc.groups).map((g) => g.text?.value), colors: doc.palette.length };
  });
  check(d.shapes >= 3 && d.words.includes('default') && d.words.includes('Create your logo with LogoCircle') && d.colors === 2, `starts with a small example, a line on top and two colors (${d.shapes} shapes, ${JSON.stringify(d.words)}, ${d.colors} colors)`);

  // Colors: a new one only exists once a color is picked for it; up to four in Classic; remove one again.
  const addBtn = page.getByRole('button', { name: 'Add color', exact: true });
  await addBtn.click();
  const newPanel = page.getByRole('dialog', { name: 'New color' });
  check((await newPanel.locator('.basic-dot[data-active]').count()) === 0 && (await newPanel.getByLabel('Hex color').inputValue()) === '#2a9d55', 'a new color starts on green, with nothing marked as chosen');
  check((await newPanel.getByRole('button', { name: /^Sets/ }).count()) === 1 && (await newPanel.getByRole('button', { name: 'Remove color' }).count()) === 0, 'the new color panel has Sets (and nothing to remove)');
  await page.keyboard.press('Escape');
  check((await page.evaluate(() => window.__lc.doc().palette.length)) === 2, 'opening Add and leaving adds nothing');
  await addBtn.click();
  await page.getByRole('dialog', { name: 'New color' }).getByRole('button', { name: '#000000' }).click();
  await page.keyboard.press('Escape');
  await addBtn.click();
  await page.getByRole('dialog', { name: 'New color' }).getByRole('button', { name: '#e5383b' }).click();
  await page.keyboard.press('Escape');
  const n = await page.evaluate(() => window.__lc.doc().palette);
  check(n.length === 4 && n[2] === '#000000' && n[3] === '#e5383b' && !(await addBtn.isVisible().catch(() => false)), `picking a color adds it, up to four in Classic (${n.join(' ')})`);
  await page.getByRole('button', { name: 'Color 4', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove color' }).click();
  check((await page.evaluate(() => window.__lc.doc().palette.length)) === 3, 'right-click on a color removes it');

  // Select an outline and click a color: it is colored directly, as a ring once it has thickness.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await add(page, phone, 'Circle');
  // On a phone, thickness is one of the Options; on a desktop it has its own button.
  await page.getByRole('button', { name: phone ? 'Options' : 'Thickness', exact: true }).click();
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
  await page.getByRole('menuitem', { name: 'Frame size' }).click();
  await drag(page, [1024, 1024], [900, 700]);
  if (phone) {
    // On a phone the frame's size and shapes are behind one button.
    await page.getByRole('button', { name: 'Frame size and shape' }).click();
    await page.getByRole('button', { name: 'Wide 16 : 9' }).click();
    await page.keyboard.press('Escape');
  } else await page.getByRole('button', { name: '16:9', exact: true }).click();
  const b = await page.evaluate(() => window.__lc.doc().artboard);
  check(Math.abs(b.w / b.h - 16 / 9) < 0.02 && b.w !== 1024, `the export frame resizes and takes a 16:9 shape (${b.w} × ${b.h})`);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const svg = await page.evaluate(() => window.__lc.svg());
  check(svg.includes(`viewBox="${b.x} ${b.y} ${b.w} ${b.h}"`), 'the export uses that frame');
  await page.screenshot({ path: join(shots, `first-${phone ? 'phone' : 'desktop'}.png`) });
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

async function desktopBar(browser) {
  console.log('\nDesktop bar: opening out, pins, instant hovers');
  const { ctx, page, errors } = await fresh(browser, false);
  const btn = (name) => page.getByRole('button', { name, exact: true });
  const has = async (name) => (await btn(name).count()) === 1;
  // Hovering shows a list at once, with no animation.
  await btn('More').hover();
  await page.waitForTimeout(30);
  const more = page.getByRole('menu', { name: 'More' });
  check((await more.count()) === 1 && (await more.evaluate((el) => getComputedStyle(el).animationName)) === 'none', 'hovering a tool button shows its list at once, unanimated');
  const bg = await btn('Text').evaluate((el) => getComputedStyle(el).transitionProperty);
  check(!bg.includes('background'), `tool buttons change on hover without a fade (${bg})`);
  await page.mouse.move(700, 300);

  // The tab at the end opens the bar out: Cut first, then the shapes, then the lines.
  check((await has('Shapes')) && !(await has('Circle')), 'the bar starts compact');
  await btn('Expand bar').click();
  await page.mouse.move(700, 300);
  check((await has('Circle')) && (await has('Square')) && (await has('Triangle')) && (await has('Line')) && (await has('Draw')) && (await has('Erase')), 'expanded: shapes, lines and Erase get buttons of their own');
  await btn('Shapes').hover();
  check((await page.getByRole('menuitem', { name: /^Polygon/ }).count()) === 1 && (await page.getByRole('menuitem', { name: /^Circle/ }).count()) === 0, 'Polygon and Star stay in the Shapes list');
  await btn('Cut').hover();
  check((await page.getByRole('menuitemcheckbox', { name: /^Cut lines/ }).count()) === 1, 'Cut lines stays in a list on Cut');
  await btn('Cut').click();
  check((await page.evaluate(() => window.__lc.ui().tool)) === 'cut', 'a click on Cut picks Cut straight away');
  await page.keyboard.press('Escape');
  await page.mouse.move(700, 300);

  // Right-click a tool to pin it or take it off.
  await btn('Circle').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin from bar' }).click();
  check(!(await has('Circle')), 'right-click, Unpin from bar: Circle goes back in the list');
  await btn('Shapes').hover();
  await page.getByRole('menuitem', { name: /^Star/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin to bar' }).click();
  await page.mouse.move(700, 300);
  check(await has('Star'), 'right-click in a list, Pin to bar: Star gets a button');

  // The same choice in Settings.
  await btn('Menu').click();
  await page.getByRole('button', { name: /^Settings/ }).click();
  const polygon = page.getByRole('group', { name: 'Shapes' }).getByRole('button', { name: 'Polygon' });
  check((await polygon.getAttribute('aria-pressed')) === 'false', 'Settings lists the tools for the expanded bar');
  await polygon.click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__lc.ui().sheet === null);
  await page.waitForTimeout(300); // the panel fades out
  check(await has('Polygon'), 'and pinning one there gives it a button');

  // Dragging the tab: back to compact, then just the first group.
  const drag = async (dx) => {
    const t = await page.getByRole('button', { name: /^(Fold|Expand) bar$/ }).boundingBox();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2 + dx / 2, t.y + t.height / 2, { steps: 4 });
    await page.mouse.move(t.x + t.width / 2 + dx, t.y + t.height / 2, { steps: 4 });
    await page.mouse.up();
  };
  await drag(-600);
  check((await has('Expand bar')) && !(await has('Erase')), 'dragging the tab left folds the bar');
  await drag(40);
  check((await has('Erase')) && !(await has('Triangle')), 'dragging it a little way opens out just Cut');

  // Kept for next time; and a narrow screen opens out only what fits.
  await page.reload({ waitUntil: 'networkidle' });
  check((await has('Erase')) && !(await has('Triangle')), 'the bar is the same after a reload');
  await page.setViewportSize({ width: 1100, height: 800 });
  await btn('Fold bar').click();
  await btn('Expand bar').click();
  await page.mouse.move(500, 300);
  const dock = await page.getByRole('toolbar', { name: 'Tools' }).boundingBox();
  const zoom = await page.locator('.zoom-control').boundingBox();
  check((await has('Erase')) && !(await has('Triangle')) && dock.x + dock.width < zoom.x, 'on a narrower screen only what fits opens out, clear of the zoom');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: join(shots, 'desktop-bar.png') });
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

async function shapesAndMenus(browser) {
  console.log('\nCorners, lines, Move, grouped menus, patterns, fillets');
  const { ctx, page, errors } = await fresh(browser, false);
  const guides = () => page.evaluate(() => window.__lc.doc().guides);
  const menuItems = () => page.locator('.ctx-menu:not(.ctx-sub) .menu-item').allTextContents();

  // A triangle's corners sit under the stretch handles: they still show, and right-click rounds one.
  await add(page, false, 'Triangle');
  await page.mouse.move(700, 120);
  check((await page.locator('.handle-pt-ring').count()) === 3, "a triangle's corners show as rings around the stretch handles");
  const tri = (await guides())[0].pts;
  const bl = tri.reduce((a, p) => (p.y > a.y || (p.y === a.y && p.x < a.x) ? p : a));
  const c = await toScreen(page, bl.x, bl.y);
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Round this corner' }).click();
  check((await page.getByRole('toolbar', { name: 'Corner rounding' }).count()) === 1, 'right-click a triangle corner: Round this corner');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Long menus keep related choices together, beside them on hover.
  await page.mouse.click(c.x + 20, c.y - 2);
  const side = await toScreen(page, (tri[0].x + bl.x) / 2, (tri[0].y + bl.y) / 2);
  await page.mouse.click(side.x, side.y, { button: 'right' });
  const main = await menuItems();
  check(!main.some((t) => t.startsWith('Flip sideways')) && main.some((t) => t.startsWith('Flip')), 'the right-click menu groups the flips');
  await page.getByRole('menuitem', { name: /^Flip/ }).first().hover();
  check((await page.locator('.ctx-sub .menu-item').allTextContents()).some((t) => t.startsWith('Flip sideways')), 'and shows them beside it on hover');
  await page.keyboard.press('Escape');

  // Move: only moving and turning, and a little room around a small thing to grab it.
  await page.mouse.click(side.x, side.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Move' }).click();
  check((await page.locator('.handle-box').count()) === 0 && (await page.locator('.handle-rot').count()) === 1, 'Move: no resize handles, just the knob for turning');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');

  // Lines: a knob to turn them, and flat ends when thick.
  await add(page, false, 'Line');
  check((await page.locator('.handle-rot').count()) === 1, 'a line has a knob to turn it');
  const knob = await page.locator('.handle-rot').boundingBox();
  const l0 = (await guides()).find((g) => g.type === 'line');
  const mid = await toScreen(page, (l0.x0 + l0.x1) / 2, (l0.y0 + l0.y1) / 2);
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.mouse.move(mid.x + 120, mid.y - 120, { steps: 6 });
  await page.mouse.up();
  const l1 = (await guides()).find((g) => g.type === 'line');
  check(Math.abs(l1.y1 - l1.y0) > 50, 'dragging the knob turns the line');
  await page.getByRole('button', { name: 'Thickness' }).click();
  await page.getByRole('slider', { name: 'Thickness' }).focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('radio', { name: 'Flat ends' }).click();
  check((await guides()).find((g) => g.type === 'line').ends === 'flat', 'a thick line can have flat ends');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Repeat: same spacing, or a pattern.
  await add(page, false, 'Circle');
  const n0 = (await guides()).length;
  await page.getByRole('button', { name: 'Repeat', exact: true }).hover();
  await page.getByRole('button', { name: /^Pattern/ }).click();
  check((await guides()).length === n0 + 3 && (await page.getByRole('toolbar', { name: 'Pattern' }).count()) === 1, 'Pattern: four in a row straight away');
  await page.getByRole('radio', { name: 'Circle' }).click();
  check((await guides()).length === n0 + 7, 'around a circle: eight');
  await page.getByRole('radio', { name: 'Grid' }).click();
  check((await guides()).length === n0 + 8, 'a grid: three by three');
  await page.keyboard.press('Escape');
  check((await guides()).length === n0 && (await page.getByRole('toolbar', { name: 'Pattern' }).count()) === 0, 'Esc takes the pattern away');
  await page.getByRole('button', { name: 'Repeat', exact: true }).hover();
  await page.getByRole('button', { name: /^Pattern/ }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  check((await guides()).length === n0 + 3, 'Done keeps it');
  await page.keyboard.press('Control+z');
  check((await guides()).length === n0, 'as one undo step');
  await page.screenshot({ path: join(shots, 'pattern.png') });

  // A fillet where two lines meet.
  await page.evaluate(() => {
    const d = window.__lc.doc();
    window.__lc.ui().set({ selection: [] });
    const g = [
      { id: 'fa', type: 'line', x0: 200, y0: 300, x1: 500, y1: 300, width: 0 },
      { id: 'fb', type: 'line', x0: 500, y0: 300, x1: 500, y1: 600, width: 0 },
    ];
    window.__lc.commit({ ...d, guides: g });
  });
  const corner = await toScreen(page, 494, 306);
  await page.mouse.click(corner.x, corner.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Round this crossing' }).click();
  check((await page.getByRole('toolbar', { name: 'Round crossing' }).count()) === 1, 'right-click where two lines meet: Round this crossing');
  await page.getByRole('slider', { name: 'Radius' }).focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const fl = await guides();
  const a = fl.find((g) => g.id === 'fa');
  check(fl.some((g) => g.type === 'edges') && a && a.x1 < 495, `an arc joins them and the lines stop where it starts (${a && a.x1.toFixed(1)})`);
  await page.screenshot({ path: join(shots, 'fillet.png') });
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

async function mirrorAndPicking(browser) {
  console.log('\nMirror copy, one at a time, hold and drag');
  // Mirror copy, with a mouse.
  {
    const { ctx, page, errors } = await fresh(browser, false);
    const b = await page.evaluate(() => window.__lc.doc().artboard);
    const cx = (b.x ?? 0) + b.w / 2;
    const cy = (b.y ?? 0) + b.h / 2;
    await add(page, false, 'Circle');
    await moveSelectionTo(page, cx - 200, cy - 150);
    const g0 = await page.evaluate(() => window.__lc.doc().guides[0]);
    await fromGroup(page, 'More', 'Mirror copy');
    check((await page.evaluate(() => window.__lc.ui().tool)) === 'mirror', 'Mirror copy is a tool under More');
    check((await page.locator('.mirror-centre').count()) === 1, "the frame's centre lines are offered to mirror across");
    // the vertical centre line, away from the middle so it is not the horizontal one
    const at = await toScreen(page, cx, cy + 300);
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(60);
    check((await page.locator('.mirror-ghost').count()) === 1, 'pointing at a line previews the copy');
    await page.mouse.click(at.x, at.y);
    let gs = await page.evaluate(() => window.__lc.doc().guides);
    const copy = gs[1];
    check(gs.length === 2 && Math.abs(copy.cx - (2 * cx - g0.cx)) < 0.01 && Math.abs(copy.cy - g0.cy) < 0.01, `clicking the centre line adds a copy mirrored across it (${copy?.cx?.toFixed(1)}, ${copy?.cy?.toFixed(1)})`);
    check((await state(page)).selection === 2, 'the copy joins the selection');
    // across the other centre line: four
    const at2 = await toScreen(page, cx + 350, cy);
    await page.mouse.click(at2.x, at2.y);
    check((await state(page)).guides === 4, 'mirroring again across the other way makes four');
    // a line drawn just for this
    await page.keyboard.press('Escape');
    check((await page.evaluate(() => window.__lc.ui().tool)) === 'arrange', 'Escape puts the tool down');
    await page.keyboard.press('Escape');
    await clickDoc(page, cx - 200 + g0.rx, cy - 150);
    await page.keyboard.press('m');
    check((await page.evaluate(() => window.__lc.ui().tool)) === 'mirror', 'M picks up Mirror copy');
    await drag(page, [cx - 500, cy + 100], [cx + 500, cy + 100]);
    gs = await page.evaluate(() => window.__lc.doc().guides);
    const last = gs[gs.length - 1];
    check(gs.length === 5 && Math.abs(last.cy - (2 * (cy + 100) - (cy - 150))) < 0.5, 'dragging draws a line of its own to mirror across');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('m');
    check((await page.evaluate(() => window.__lc.ui().tool)) === 'arrange', 'with nothing selected, there is nothing to mirror');
    await page.screenshot({ path: join(shots, 'mirror.png') });
    check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
    await ctx.close();
  }

  // One at a time, on a phone: each tap adds, like Shift-click.
  {
    const { ctx, page, errors } = await fresh(browser, true);
    const b = await page.evaluate(() => window.__lc.doc().artboard);
    const cx = (b.x ?? 0) + b.w / 2;
    const cy = (b.y ?? 0) + b.h / 2;
    await add(page, true, 'Circle');
    await moveSelectionTo(page, cx - 200, cy);
    await add(page, true, 'Square');
    await moveSelectionTo(page, cx + 200, cy);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('menuitem', { name: /^One at a time/ }).click();
    const tap = async (x, y) => {
      const p = await toScreen(page, x, y);
      await page.touchscreen.tap(p.x, p.y);
      await page.waitForTimeout(80);
      return (await state(page)).selection;
    };
    const circle = await page.evaluate(() => window.__lc.doc().guides[0]);
    const square = await page.evaluate(() => window.__lc.doc().guides[1]);
    check((await tap(circle.cx + circle.rx, circle.cy)) === 1, 'one at a time: the first tap selects');
    check((await tap(square.cx + square.w / 2, square.cy)) === 2, 'the next tap adds to the selection');
    check((await page.getByRole('status').or(page.locator('.hint-pill')).first().textContent())?.includes('2 selected'), 'the hint counts what is selected');
    check((await tap(circle.cx + circle.rx, circle.cy)) === 1, 'tapping a selected piece takes it away again');
    check((await tap(cx, cy + 400)) === 1, 'a tap on empty canvas keeps the selection');
    check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
    await ctx.close();
  }

  // Hold and drag to pick, with a finger and with a mouse.
  for (const phone of [true, false]) {
    const { ctx, page, errors } = await fresh(browser, phone);
    // switched on in Settings, and kept for the next visit
    await page.evaluate(() => localStorage.setItem('lc.settings', JSON.stringify({ slidePick: true })));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__lc && window.__lc.ui().stage.w > 0);
    const button = await page.getByRole('button', { name: 'Shapes', exact: true }).boundingBox();
    const from = { x: button.x + button.width / 2, y: button.y + button.height / 2 };
    if (phone) {
      const cdp = await ctx.newCDPSession(page);
      const touchEv = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p[0], y: p[1], id })) });
      await touchEv('touchStart', [[from.x, from.y]]);
      await page.waitForTimeout(120);
      const item = await page.getByRole('menuitem', { name: /^Triangle/ }).boundingBox();
      const to = { x: item.x + item.width / 2, y: item.y + item.height / 2 };
      await touchEv('touchMove', [[from.x, from.y - 20]]);
      await touchEv('touchMove', [[to.x, to.y]]);
      await page.waitForTimeout(60);
      check((await page.locator('.menu-item[data-hot]').textContent())?.startsWith('Triangle'), 'hold and drag: the choice under the finger lights up');
      await touchEv('touchEnd', []);
      // Resting on a heading folds it out; letting go away from the list picks nothing.
      const more = await page.getByRole('button', { name: 'More', exact: true }).boundingBox();
      const m = { x: more.x + more.width / 2, y: more.y + more.height / 2 };
      await touchEv('touchStart', [[m.x, m.y]]);
      await page.waitForTimeout(120);
      const head = await page.getByRole('menuitem', { name: /^Import photo/ }).boundingBox();
      await touchEv('touchMove', [[m.x, m.y - 20]]);
      await touchEv('touchMove', [[head.x + head.width / 2, head.y + head.height / 2]]);
      await page.waitForTimeout(500);
      check((await page.getByRole('menuitem', { name: /^Choose photo/ }).count()) === 1, 'resting on Import photo folds out its choices');
      await touchEv('touchMove', [[40, 300]]);
      await touchEv('touchEnd', []);
      await page.waitForTimeout(100);
      check((await page.getByRole('menu', { name: 'More' }).count()) === 0, 'letting go away from the list closes it');
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.waitForTimeout(120);
      const item = await page.getByRole('menuitem', { name: /^Triangle/ }).boundingBox();
      await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2, { steps: 6 });
      await page.mouse.up();
    }
    await page.waitForTimeout(150);
    const g = await page.evaluate(() => window.__lc.doc().guides);
    check(g.length === 1 && g[0].type === 'poly' && g[0].pts.length === 3, `hold and drag on ${phone ? 'a phone' : 'a desktop'}: letting go on Triangle adds a triangle`);
    check((await page.getByRole('menu', { name: 'Shapes' }).count()) === 0, 'and the list closes');
    // a plain tap still just opens the list
    if (phone) {
      await page.getByRole('button', { name: 'Shapes', exact: true }).tap();
      await page.waitForTimeout(120);
      check((await page.getByRole('menu', { name: 'Shapes' }).count()) === 1, 'a plain tap still opens the list');
    }
    check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
    await ctx.close();
  }
}

async function help(browser) {
  console.log('\nHelp popover and Guide');
  const { ctx, page, errors } = await fresh(browser, false);
  const btn = (name) => page.getByRole('button', { name, exact: true });
  const popWidth = async () => {
    await btn('Help').click();
    await page.waitForTimeout(350);
    const w = (await page.locator('.help-pop').boundingBox()).width;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    return w;
  };
  const wide = await popWidth();
  await page.setViewportSize({ width: 1024, height: 800 });
  const narrow = await popWidth();
  check(wide > narrow + 60, `the help popover grows with the screen (${Math.round(narrow)} → ${Math.round(wide)} px)`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await btn('Help').click();
  await page.waitForTimeout(350);
  check((await page.getByRole('img', { name: 'Add shapes, trim, color areas' }).count()) === 1, 'it shows the idea as a picture');
  check((await btn('Guide').locator('svg').count()) === 1 && (await btn('Examples').locator('svg').count()) === 1, 'Guide and Examples have icons');
  await page.screenshot({ path: join(shots, 'help-popover.png') });
  await btn('Guide').click();
  await page.waitForTimeout(400);
  const guide = page.getByRole('dialog', { name: 'Guide' });
  check((await guide.getByRole('img', { name: /^Animation/ }).count()) === 1, 'the Guide opens on a short animation');
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.hiw-anim')).length);
  check(running >= 8, `and it plays (${running} parts moving)`);
  // Its right edge drags it wider; the width is kept for next time.
  const before = (await guide.boundingBox()).width;
  const edge = await guide.locator('.panel-edge').boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 150, edge.y + edge.height / 2, { steps: 5 });
  await page.mouse.move(edge.x + edge.width / 2 + 300, edge.y + edge.height / 2, { steps: 5 });
  await page.mouse.up();
  const after = (await guide.boundingBox()).width;
  check(Math.abs(after - before - 300) < 12, `dragging the Guide's edge widens it (${Math.round(before)} → ${Math.round(after)} px)`);
  const side = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.guide-tables > div')].map((d) => d.getBoundingClientRect());
    return t.length === 2 && Math.abs(t[0].top - t[1].top) < 2 && t[1].left > t[0].right;
  });
  check(side, 'when wide, the mouse and keyboard tables sit side by side');
  await page.screenshot({ path: join(shots, 'help-guide-wide.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await btn('Help').click();
  await page.waitForTimeout(300);
  await btn('Guide').click();
  await page.waitForTimeout(400);
  check(Math.abs((await guide.boundingBox()).width - after) < 2, 'and stays that wide when opened again');
  await guide.locator('.panel-edge').dblclick();
  await page.waitForTimeout(100);
  check(Math.abs((await guide.boundingBox()).width - before) < 2, 'a double-click on the edge puts it back');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

async function textDesktop(browser) {
  console.log('\nText on a desktop: live on the canvas, lands on click-off');
  const { page, ctx, errors } = await fresh(browser, false);
  const btn = (name) => page.getByRole('button', { name, exact: true });
  const shapes = () => page.evaluate(() => window.__lc.doc().shapes.length);
  const field = () => page.getByRole('textbox', { name: 'Text', exact: true });
  const panel = page.getByRole('dialog', { name: 'Add text' });
  // a spot on the canvas away from the panel and the word
  const off = async () => {
    const v = page.viewportSize();
    await page.mouse.click(v.width - 120, 160);
    await page.waitForTimeout(500);
  };

  await btn('Text').click();
  await page.waitForTimeout(400);
  await field().fill('Logo');
  await page.waitForTimeout(600);
  check((await page.locator('.text-preview').count()) === 1 && (await shapes()) === 0, 'the word shows on the canvas while typing, not yet in the logo');
  await off();
  check((await shapes()) === 4 && (await page.locator('.text-preview').count()) === 0, 'clicking the canvas puts the word down');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  check((await shapes()) === 0, 'as one undo step');

  await btn('Text').click();
  await page.waitForTimeout(400);
  await field().fill('Nope');
  await page.waitForTimeout(500);
  await panel.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(400);
  check((await shapes()) === 0 && (await page.locator('.text-preview').count()) === 0, 'X cancels: nothing added');
  await btn('Text').click();
  await page.waitForTimeout(400);
  await field().fill('Nope');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check((await shapes()) === 0, 'Esc cancels too');

  // Size, spacing and color stay in view while the fonts scroll; the edge drags the panel wider.
  await btn('Text').click();
  await page.waitForTimeout(400);
  await field().fill('Wide');
  await btn('More fonts').click();
  await page.locator('.tx-desk-fonts').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(200);
  const pb = await panel.boundingBox();
  const sb = await page.getByRole('slider', { name: 'Size' }).boundingBox();
  const cb = await page.getByRole('button', { name: 'Color 1', exact: true }).boundingBox();
  check(sb.y > pb.y && sb.y + sb.height < pb.y + pb.height && cb.y + cb.height < pb.y + pb.height, 'size and color stay in view while the fonts scroll');
  const cols = () => page.locator('.tx-desk .tx-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  const c0 = await cols();
  const edge = await page.locator('.panel-edge').boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + 260, edge.y + edge.height / 2, { steps: 6 });
  await page.mouse.up();
  const pb2 = await panel.boundingBox();
  check(pb2.width > pb.width + 200 && (await cols()) > c0, `dragging the edge widens the panel (${Math.round(pb.width)} → ${Math.round(pb2.width)}) and shows more fonts side by side (${c0} → ${await cols()})`);
  await page.waitForTimeout(400);
  const word = await page.locator('.text-preview').boundingBox();
  const pb3 = await panel.boundingBox();
  check(word && word.x > pb3.x + pb3.width, 'the canvas slides aside so the word is not under the panel');

  // Font settings: weights for Poppins, features for Paper Mono.
  await page.locator('.tx-desk-fonts').evaluate((el) => el.scrollTo({ top: 0 }));
  await btn('Poppins').click();
  await page.getByRole('button', { name: 'Font settings' }).click();
  await page.waitForTimeout(300);
  check((await page.getByRole('slider', { name: 'Weight' }).count()) === 1 && (await page.getByRole('switch', { name: 'Italic' }).count()) === 1, 'Font settings offers weight and italic for Poppins');
  await page.getByRole('slider', { name: 'Weight' }).focus();
  await page.keyboard.press('ArrowLeft');
  check((await page.locator('.tx-style-value').textContent()) === 'Semibold', 'one step lighter than Bold is Semibold');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check((await panel.count()) === 1, 'Esc in Font settings closes only that');
  await btn('Paper Mono').click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Font settings' }).click();
  await page.waitForTimeout(400);
  const names = await page.locator('.tx-style [role=switch]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check(['Ligatures', 'Single-story a', 'Slashed zero'].every((n) => names.includes(n)) && !names.includes('Italic'), `Paper Mono offers its own features (${names.join(', ')})`);
  await page.getByRole('switch', { name: 'Single-story a' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await off();
  const t = await page.evaluate(() => Object.values(window.__lc.doc().groups)[0]?.text);
  check(t?.fontId === 'paper-mono' && t.features?.includes('cv01'), 'the word lands with the feature on');
  await page.screenshot({ path: join(shots, 'text-desktop.png') });

  // Retyping a word: shown live in its place, put back on click-off.
  const before = await page.evaluate(() => window.__lc.doc().shapes.map((x) => x.id).join());
  await page.evaluate(() => window.__lc.ui().set({ sheet: 'text', textTarget: Object.keys(window.__lc.doc().groups)[0] }));
  await page.waitForTimeout(400);
  await field().fill('Wider');
  await page.waitForTimeout(500);
  await off();
  const after = await page.evaluate(() => ({ n: window.__lc.doc().shapes.length, ids: window.__lc.doc().shapes.map((x) => x.id).join(), v: Object.values(window.__lc.doc().groups).map((g) => g.text.value) }));
  check(after.n === 5 && after.ids !== before && after.v.length === 1 && after.v[0] === 'Wider', 'retyping replaces the word in place');
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

// ---------------------------------------------------------------------------

// Vite is started directly rather than through npx, so that stopping it stops the server itself.
const server = spawn(process.execPath, [join(here, '..', 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', cwd: join(here, '..') });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  if (process.env.E2E_ONLY) {
    // E2E_ONLY=touch,controls runs just those flows
    const both = (fn) => async (b) => {
      await fn(b, false);
      await fn(b, true);
    };
    const flows = { controls, refinements, phoneLayout, sideways, touch, mirrorAndPicking, desktopBar, help, textDesktop, shapesAndMenus, wordmark: both(wordmark), photoToLogo: both(photoToLogo), geometric: both(geometric), firstVisit: both(firstVisit) };
    for (const name of process.env.E2E_ONLY.split(',')) await flows[name](browser);
    throw 'only';
  }
  for (const phone of [false, true]) {
    await photoToLogo(browser, phone);
    await geometric(browser, phone);
    await wordmark(browser, phone);
    await firstVisit(browser, phone);
  }
  await controls(browser);
  await refinements(browser);
  await phoneLayout(browser);
  await sideways(browser);
  await touch(browser);
  await mirrorAndPicking(browser);
  await desktopBar(browser);
  await help(browser);
  await shapesAndMenus(browser);
  await textDesktop(browser);
} catch (err) {
  if (err !== 'only') {
    console.error(err);
    failures++;
  }
} finally {
  await browser?.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
