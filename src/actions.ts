/**
 * Commands. Everything a button, a shortcut or a gesture can ask for goes
 * through here, so the three always behave the same.
 */
import { toast } from 'sonner';
import { mul, scale, translate, type Mat, type Pt } from '@/geom';
import { useDoc, getDoc, commit } from '@/store/doc';
import { selectionKey, ui, useUi, remember, type Mode, type Tool } from '@/store/ui';
import { putImage, saveNow } from '@/store/persist';
import { isPhone, isSide, isTouch } from '@/store/settings';
import { keyLabel } from '@/keys';
import { CLASSIC_COLORS, type Border, type Doc, type Group, type Guide, type RefImage, type Shape } from '@/model/types';
import { addGuide, addRef, applyPalette, duplicateItems, removeColor, removeItems, selectionBBox, transformItems, contentBBox } from '@/model/ops';
import { visibleGuides } from '@/model/paint';
import { board, groupMembers, newDoc } from '@/model/doc';
import { guideArea } from '@/model/guides';
import { mirrorable } from '@/model/mirror';
import { applyPattern, defaultPattern, type PatternKind, type PatternSpec } from '@/model/pattern';
import { applyFillet, maxFillet, type Crossing } from '@/model/fillet';
import { uid } from '@/model/ids';
import { chromeInsets, fitView, toDoc, zoomAt } from '@/canvas/view';
import { regularPoints } from '@/geom';

export type AddKind = 'circle' | 'line' | 'rect' | 'triangle' | 'curve' | 'polygon' | 'star';

const insets = () => (isSide() ? sideInsets(ui().stage) : chromeInsets(ui().stage, ui().mode === 'advanced', isPhone()));

/** A phone on its side: the canvas gets the full height, between the controls down either edge. */
function sideInsets(stage: { w: number; h: number }) {
  const left = typeof document !== 'undefined' ? document.querySelector('.side-left')?.getBoundingClientRect() : undefined;
  const right = typeof document !== 'undefined' ? document.querySelector('.side-right')?.getBoundingClientRect() : undefined;
  return { top: 12, bottom: 12, left: (left?.right ?? 150) + 10, right: stage.w - (right?.left ?? stage.w - 80) + 10 };
}

/** The document point in the middle of the visible canvas. */
export function viewCenter(): Pt {
  const { view, stage } = ui();
  const ins = insets();
  return toDoc(view, {
    x: ins.left + (stage.w - ins.left - ins.right) / 2,
    y: ins.top + (stage.h - ins.top - ins.bottom) / 2,
  });
}

/** A comfortable default size for something new, in document units. */
function defaultSize(): number {
  const { view, stage } = ui();
  const ins = insets();
  const px = Math.min(stage.w - ins.left - ins.right, stage.h - ins.top - ins.bottom);
  const doc = getDoc();
  return Math.max(24, Math.min((px / view.k) * 0.34, doc.artboard.w * 0.5));
}

let cascade = 0;

export function makeGuide(kind: AddKind, at?: Pt, size?: number): Guide {
  const s = size ?? defaultSize();
  const { view } = ui();
  let c = at;
  if (!c) {
    // Step each new outline a little so a second circle never hides the first.
    const step = (14 / view.k) * (cascade++ % 5);
    const v = viewCenter();
    c = { x: v.x + step, y: v.y + step };
  }
  const id = uid('g');
  switch (kind) {
    case 'circle':
      return { id, type: 'ellipse', cx: c.x, cy: c.y, rx: s / 2, ry: s / 2, rot: 0 };
    case 'rect':
      return { id, type: 'rect', cx: c.x, cy: c.y, w: s, h: s, rot: 0, radius: 0 };
    case 'line':
      return { id, type: 'line', x0: c.x - s * 0.6, y0: c.y, x1: c.x + s * 0.6, y1: c.y, width: 0 };
    case 'triangle':
      return { id, type: 'poly', pts: regularPoints(c.x, c.y + s * 0.08, s * 0.58, 3) };
    case 'polygon':
      return { id, type: 'poly', pts: regularPoints(c.x, c.y, s / 2, 6) };
    case 'star':
      return { id, type: 'poly', pts: regularPoints(c.x, c.y, s / 2, 5, 0, 0.45) };
    case 'curve':
      return {
        id,
        type: 'curve',
        closed: false,
        width: 0,
        pts: [
          { x: c.x - s * 0.55, y: c.y + s * 0.18 },
          { x: c.x, y: c.y - s * 0.22 },
          { x: c.x + s * 0.55, y: c.y + s * 0.18 },
        ],
      };
  }
}

export function addOutline(kind: AddKind): void {
  const g = makeGuide(kind);
  commit(addGuide(getDoc(), g));
  useUi.setState({ tool: 'arrange', erasing: false, selection: [g.id], showGuides: true });
}

/** Selection with whole words expanded is the default; this narrows nothing. */
export function selectedIds(): string[] {
  return ui().selection;
}

export function deleteSelection(): void {
  const ids = selectedIds();
  if (!ids.length) return;
  commit(removeItems(getDoc(), ids));
  useUi.setState({ selection: [] });
}

function trackMove(m: Mat): void {
  // If what moved is the fresh copy, fold the move into the transform that Repeat re-applies.
  const s = ui();
  if (s.lastDup && dupIds && sameSet(dupIds, s.selection)) {
    useUi.setState({ lastDup: mul(m, s.lastDup) });
  }
}

let dupIds: string[] | null = null;
const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/** Apply a transform to the selection as one undo step. */
export function transformSelection(m: Mat): void {
  const ids = selectedIds();
  if (!ids.length) return;
  commit(transformItems(getDoc(), ids, m));
  trackMove(m);
}

export function duplicateSelection(): void {
  const ids = selectedIds();
  if (!ids.length) return;
  const d = 20 / ui().view.k;
  const m = translate(d, d);
  const r = duplicateItems(getDoc(), ids, m);
  commit(r.doc);
  dupIds = r.ids;
  useUi.setState({ selection: r.ids, lastDup: m });
}

/** Duplicate again with the same offset (and any move made since) — "Transform Again". */
export function repeatDuplicate(): void {
  const s = ui();
  if (!s.lastDup || !s.selection.length || !canRepeat()) return;
  const r = duplicateItems(getDoc(), s.selection, s.lastDup);
  commit(r.doc);
  dupIds = r.ids;
  useUi.setState({ selection: r.ids });
}

export function canRepeat(): boolean {
  const s = ui();
  return !!s.lastDup && !!dupIds && sameSet(dupIds, s.selection);
}

export function flipSelection(axis: 'h' | 'v'): void {
  const ids = selectedIds();
  const b = selectionBBox(getDoc(), ids);
  if (!b) return;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  transformSelection(axis === 'h' ? scale(-1, 1, cx, cy) : scale(1, -1, cx, cy));
}

export function nudge(dx: number, dy: number): void {
  transformSelection(translate(dx, dy));
}

/** The thickness a thin line gets when it is first given a color. */
const INK_WIDTH = 12;

/**
 * Give the selection a color. Shapes are recolored. Outlines are colored in:
 * a closed outline fills, a thick one colors its band, and a thin line first
 * becomes a stroke. The colored result stays linked to its outline, so later
 * changes to thickness or shape carry through.
 */
export function colorSelection(fill: number | string): boolean {
  let doc = getDoc();
  const sel = new Set(ui().selection);
  if (!sel.size) return false;
  let did = false;
  // thin open lines need a body before they can carry a color
  const guides = doc.guides.map((g) => {
    if (!sel.has(g.id) || guideArea(g)) return g;
    did = true;
    return { ...g, width: INK_WIDTH } as Guide;
  });
  if (did) doc = { ...doc, guides };
  const shapes = doc.shapes.map((s) => {
    if (!sel.has(s.id) || s.fill === fill) return s;
    did = true;
    return { ...s, fill };
  });
  const added: Shape[] = [];
  for (const g of doc.guides) {
    if (!sel.has(g.id)) continue;
    const rings = guideArea(g);
    if (!rings) continue;
    // already colored from this outline? then just change that color
    const mine = shapes.findIndex((s) => s.from && 'area' in s.from && s.from.area === g.id);
    if (mine >= 0) {
      if (shapes[mine]!.fill !== fill) {
        shapes[mine] = { ...shapes[mine]!, fill };
        did = true;
      }
      continue;
    }
    added.push({ id: uid('s'), rings, fill, from: { area: g.id }, group: g.group });
    did = true;
  }
  if (!did) return false;
  commit({ ...doc, shapes: [...shapes, ...added], updatedAt: Date.now() });
  return true;
}

export function fillSelectedOutlines(): void {
  colorSelection(ui().ink);
}

export function selectAll(): void {
  const doc = getDoc();
  const ids = [
    ...visibleGuides(doc, ui().showGuides, ui().showCuts)
      .filter((g) => !g.locked)
      .map((g) => g.id),
    ...doc.shapes.filter((x) => !x.hidden && !x.locked).map((x) => x.id),
  ];
  useUi.setState({ selection: ids, tool: 'arrange', erasing: false });
}

/** A tap on a letter selects its whole word first. */
export function expandToGroup(doc: Doc, id: string): string[] {
  const group = doc.shapes.find((x) => x.id === id)?.group ?? doc.guides.find((x) => x.id === id)?.group;
  if (group) return groupMembers(doc, group);
  return [id];
}

// --- tools & modes ------------------------------------------------------------

/** Switch to a tool; choosing the tool that is already on switches it off again. */
export function setTool(tool: Tool): void {
  const s = ui();
  const next: Tool = s.tool === tool && tool !== 'arrange' ? 'arrange' : tool;
  useUi.setState({ tool: next, erasing: false, trayOpen: false, colorPanel: null, frameEdit: false, selection: next === 'arrange' ? s.selection : [] });
}

// --- Pattern: repeat the selection in a row, around a circle or in a grid ----------

/** Start setting up a pattern of the selection; the copies show at once and follow every change. */
export function startPattern(kind: PatternKind = 'row'): void {
  const s = ui();
  const doc = getDoc();
  const ids = mirrorable(doc, s.selection);
  const box = selectionBBox(doc, ids);
  if (!ids.length || !box) {
    toast('Select something to repeat first');
    return;
  }
  useDoc.getState().hold();
  useUi.setState({ pattern: { ids, spec: defaultPattern(kind, box), key: '' }, tool: 'arrange', menu: null, corner: null });
  setPattern(ui().pattern!.spec);
}

export function setPattern(spec: PatternSpec): void {
  const p = ui().pattern;
  const st = useDoc.getState();
  if (!p || !st.held) return;
  const r = applyPattern(st.held, p.ids, spec);
  st.patch(r.doc);
  const selection = [...p.ids, ...r.ids];
  useUi.setState({ pattern: { ...p, spec, key: selectionKey(selection) }, selection });
}

/** Keep the pattern (one undo step) or take it away again. */
export function finishPattern(keep: boolean): void {
  const p = ui().pattern;
  if (!p) return;
  useUi.setState({ pattern: null, ...(keep ? {} : { selection: p.ids }) });
  useDoc.getState().release(keep);
}

// --- Fillet: round off where two straight outlines cross ----------------------------

export function startFillet(crossing: Crossing): void {
  const max = maxFillet(crossing);
  if (max <= 0) return;
  useDoc.getState().hold();
  useUi.setState({ fillet: { crossing, r: 0, max }, tool: 'arrange', menu: null, corner: null, pattern: null, selection: [] });
  setFillet(Math.min(max, 24 / ui().view.k));
}

export function setFillet(r: number): void {
  const f = ui().fillet;
  const st = useDoc.getState();
  if (!f || !st.held) return;
  st.patch(applyFillet(st.held, f.crossing, r));
  useUi.setState({ fillet: { ...f, r } });
}

export function finishFillet(keep: boolean): void {
  if (!ui().fillet) return;
  useUi.setState({ fillet: null });
  useDoc.getState().release(keep);
}

// A pattern or fillet ends when anything else happens: another change, undo, or a different selection.
useDoc.subscribe((d) => {
  if (!d.held && (ui().pattern || ui().fillet)) useUi.setState({ pattern: null, fillet: null });
});
useUi.subscribe((s) => {
  if (s.pattern && s.pattern.key && (s.tool !== 'arrange' || selectionKey(s.selection) !== s.pattern.key)) finishPattern(true);
  if (s.fillet && (s.tool !== 'arrange' || s.selection.length)) finishFillet(true);
});

/** Mirror copy: pick a line and the selection gets copies reflected across it. */
export function startMirror(): void {
  const s = ui();
  if (s.tool === 'mirror') return doneTool();
  if (!mirrorable(getDoc(), s.selection).length) {
    toast('Select something to mirror first', { description: `Then pick Mirror copy and ${isTouch() ? 'tap' : 'click'} a line.` });
    return;
  }
  useUi.setState({ tool: 'mirror', erasing: false, trayOpen: false, colorPanel: null, frameEdit: false, multi: false });
}

/** Back to moving things around. */
export function doneTool(): void {
  useUi.setState({ tool: 'arrange', erasing: false, colorPanel: null, frameEdit: false });
}

/** How many swatches the current mode works with. */
export function colorLimit(): number {
  return ui().mode === 'classic' ? CLASSIC_COLORS : 24;
}

/**
 * Click on a swatch. With something selected it colors that. Otherwise it
 * picks the color up for coloring areas; clicking the color already in hand
 * opens its small panel.
 */
export function pickInk(ink: number): void {
  const s = ui();
  if (s.tool === 'brush' || s.tool === 'draw' || s.tool === 'pen') {
    if (s.ink === ink) useUi.setState({ colorPanel: s.colorPanel === ink ? null : ink });
    else useUi.setState({ ink, colorPanel: null });
    return;
  }
  if (s.tool === 'arrange' && s.selection.length && colorSelection(ink)) {
    useUi.setState({ ink, colorPanel: null });
    return;
  }
  if (s.tool === 'color' && !s.erasing && s.ink === ink) {
    useUi.setState({ colorPanel: s.colorPanel === ink ? null : ink });
    return;
  }
  useUi.setState({ tool: 'color', ink, erasing: false, selection: [], trayOpen: false, colorPanel: null, frameEdit: false });
}

export function pickEraser(): void {
  const s = ui();
  if (s.tool === 'color' && s.erasing) return doneTool();
  useUi.setState({ tool: 'color', erasing: true, selection: [], trayOpen: false, colorPanel: null, frameEdit: false });
}

/** Open the panel for a new swatch. The swatch only appears once a color is chosen in it. */
export function addSwatch(): void {
  if (getDoc().palette.length >= colorLimit()) return;
  useUi.setState((s) => ({ colorPanel: s.colorPanel === 'new' ? null : 'new', colorAnchor: null }));
}

/** Sticky points on or off; remembered on this device. */
export function setSticky(on: boolean): void {
  useUi.setState({ stickyPoints: on });
  remember('lc.sticky', on ? '1' : '');
}

/** Open the background's color panel by whatever asked for it: a button (opens above it) or a point (beside it). */
export function openBackground(at?: { left: number; top: number; right: number; bottom: number; width: number; height: number }, side: 'above' | 'beside' = 'above'): void {
  useUi.setState({ colorPanel: 'paper', colorAnchor: at ? { left: at.left, top: at.top, right: at.right, bottom: at.bottom, width: at.width, height: at.height, side } : null });
}

export function removeSwatch(index: number): void {
  const doc = getDoc();
  if (doc.palette.length <= 1) return;
  commit(removeColor(doc, index));
  const s = ui();
  const ink = typeof s.ink === 'number' ? (s.ink === index ? 0 : s.ink > index ? s.ink - 1 : s.ink) : 0;
  useUi.setState({ ink, colorPanel: null });
}

export function usePalette(colors: string[]): void {
  commit(applyPalette(getDoc(), colors));
  const s = ui();
  if (typeof s.ink === 'number' && s.ink >= colors.length) useUi.setState({ ink: 0 });
}

export function setMode(mode: Mode): void {
  remember('lc.mode', mode);
  const patch: Partial<ReturnType<typeof ui>> = { mode, colorPanel: null };
  const s = ui();
  if (mode === 'classic') {
    if (s.tool === 'pen') patch.tool = 'arrange';
    promoteClassicColors();
    if (typeof s.ink !== 'number' || s.ink >= CLASSIC_COLORS) patch.ink = 0;
  }
  useUi.setState(patch);
}

/** Back in Classic: make the most-used colors the ones on show. */
function promoteClassicColors(): void {
  const doc = getDoc();
  if (doc.palette.length <= CLASSIC_COLORS) return;
  const use = new Array<number>(doc.palette.length).fill(0);
  for (const s of doc.shapes) if (typeof s.fill === 'number') use[s.fill] = (use[s.fill] ?? 0) + 1;
  const order = doc.palette.map((_, i) => i).sort((a, b) => use[b]! - use[a]! || a - b);
  if (order.every((v, i) => v === i)) return;
  const remap = new Map(order.map((from, to) => [from, to]));
  useDoc.getState().patch({
    ...doc,
    palette: order.map((i) => doc.palette[i]!),
    shapes: doc.shapes.map((s) => (typeof s.fill === 'number' ? { ...s, fill: remap.get(s.fill) ?? s.fill } : s)),
    groups: Object.fromEntries(
      Object.entries(doc.groups).map(([id, g]) => [id, g.text && typeof g.text.fill === 'number' ? { ...g, text: { ...g.text, fill: remap.get(g.text.fill) ?? g.text.fill } } : g]),
    ),
  });
}

// --- grouping and stacking --------------------------------------------------------

/** Group everything selected, so it is picked up and moved as one. */
export function groupSelection(): void {
  const doc = getDoc();
  const sel = new Set(ui().selection);
  if (sel.size < 2) return;
  const id = uid('w');
  commit({
    ...doc,
    guides: doc.guides.map((g) => (sel.has(g.id) ? { ...g, group: id } : g)),
    shapes: doc.shapes.map((s) => (sel.has(s.id) ? { ...s, group: id } : s)),
    groups: { ...doc.groups, [id]: { id, kind: 'group', name: 'Group' } },
    updatedAt: Date.now(),
  });
}

export function selectionGroups(): string[] {
  const doc = getDoc();
  const sel = new Set(ui().selection);
  const out = new Set<string>();
  for (const s of doc.shapes) if (sel.has(s.id) && s.group) out.add(s.group);
  for (const g of doc.guides) if (sel.has(g.id) && g.group) out.add(g.group);
  return [...out];
}

export function ungroupSelection(): void {
  const doc = getDoc();
  const gids = new Set(selectionGroups());
  if (!gids.size) return;
  const groups = { ...doc.groups };
  gids.forEach((g) => delete groups[g]);
  commit({
    ...doc,
    guides: doc.guides.map((g) => (g.group && gids.has(g.group) ? { ...g, group: undefined } : g)),
    shapes: doc.shapes.map((s) => (s.group && gids.has(s.group) ? { ...s, group: undefined } : s)),
    groups,
    updatedAt: Date.now(),
  });
}

export type Order = 'front' | 'forward' | 'backward' | 'back';

/** Move the selected shapes up or down the stack. */
export function orderSelection(order: Order): void {
  const doc = getDoc();
  const sel = new Set(ui().selection);
  const shapes = [...doc.shapes];
  const picked = shapes.filter((s) => sel.has(s.id));
  if (!picked.length) return;
  let next: Shape[];
  if (order === 'front') next = [...shapes.filter((s) => !sel.has(s.id)), ...picked];
  else if (order === 'back') next = [...picked, ...shapes.filter((s) => !sel.has(s.id))];
  else {
    next = shapes;
    const step = order === 'forward' ? 1 : -1;
    const idx = shapes.map((s, i) => (sel.has(s.id) ? i : -1)).filter((i) => i >= 0);
    if (step === 1) idx.reverse();
    for (const i of idx) {
      const j = i + step;
      if (j < 0 || j >= next.length || sel.has(next[j]!.id)) continue;
      [next[i], next[j]] = [next[j]!, next[i]!];
    }
  }
  if (next.every((s, i) => s === doc.shapes[i])) return;
  commit({ ...doc, shapes: next, updatedAt: Date.now() });
}

/** Free the selected fills from their outlines: they keep their look and stop following. */
export function detachSelection(): void {
  const doc = getDoc();
  const sel = new Set(ui().selection);
  if (!doc.shapes.some((s) => sel.has(s.id) && s.from)) return;
  commit({ ...doc, shapes: doc.shapes.map((s) => (sel.has(s.id) && s.from ? { ...s, from: undefined } : s)), updatedAt: Date.now() });
}

// --- export frame -----------------------------------------------------------------

export function setBoard(b: { x: number; y: number; w: number; h: number }): void {
  const doc = getDoc();
  const next = { x: Math.round(b.x), y: Math.round(b.y), w: Math.max(16, Math.round(b.w)), h: Math.max(16, Math.round(b.h)) };
  const cur = board(doc);
  if (cur.x === next.x && cur.y === next.y && cur.w === next.w && cur.h === next.h) return;
  commit({ ...doc, artboard: next, updatedAt: Date.now() });
}

/** Give the frame a new proportion, keeping its centre and area. */
export function setBoardRatio(rw: number, rh: number): void {
  const b = board(getDoc());
  const area = b.w * b.h;
  const w = Math.sqrt((area * rw) / rh);
  const h = area / w;
  setBoard({ x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h });
}

/** Wrap the frame around the artwork with a little breathing room. */
export function fitBoardToArtwork(): void {
  const c = contentBBox(getDoc());
  if (!c || c.w <= 0 || c.h <= 0) return;
  const pad = Math.max(c.w, c.h) * 0.08;
  setBoard({ x: c.x - pad, y: c.y - pad, w: c.w + pad * 2, h: c.h + pad * 2 });
  requestAnimationFrame(() => fitToScreen());
}

export function editFrame(on = true): void {
  useUi.setState({ frameEdit: on, tool: 'arrange', erasing: false, selection: [], sheet: null, colorPanel: null });
}

// --- view ---------------------------------------------------------------------

export function fitToScreen(content = false): void {
  const { stage } = ui();
  if (!stage.w) return;
  const doc = getDoc();
  const box = (content && contentBBox(doc)) || board(doc);
  const pad = content ? Math.max(box.w, box.h) * 0.08 : 0;
  useUi.setState({
    view: fitView(stage, { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }, insets()),
  });
}

export function zoomBy(factor: number): void {
  const { view, stage } = ui();
  useUi.setState({ view: zoomAt(view, { x: stage.w / 2, y: stage.h / 2 }, factor) });
}

// --- documents ------------------------------------------------------------------

export function openDoc(doc: Doc): void {
  useDoc.getState().load(doc);
  useUi.setState({ selection: [], tool: 'arrange', erasing: false, sheet: null, lastDup: null, showGuides: true, colorPanel: null, frameEdit: false, menu: null, ink: 0 });
  requestAnimationFrame(() => fitToScreen());
}

export function createNewDoc(): void {
  openDoc(newDoc());
}

// --- photo ----------------------------------------------------------------------

const MAX_IMAGE = 2048;

async function shrink(file: Blob): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_IMAGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
  return { blob: blob ?? file, w, h };
}

/** Place a reference photo. Classic keeps one at a time. */
export async function addPhoto(file: Blob): Promise<void> {
  try {
    const { blob, w, h } = await shrink(file);
    const id = uid('i');
    await putImage(id, blob);
    const doc = getDoc();
    const b = board(doc);
    const fit = Math.min((b.w * 0.86) / w, (b.h * 0.86) / h);
    const ref: RefImage = {
      id: uid('r'),
      blob: id,
      cx: b.x + b.w / 2,
      cy: b.y + b.h / 2,
      w: w * fit,
      h: h * fit,
      rot: 0,
      opacity: 0.45,
      locked: true,
    };
    commit(addRef(doc, ref, ui().mode === 'classic'));
    // Selected, so its settings (fade, lock, on top) show straight away.
    useUi.setState({ tool: 'arrange', erasing: false, selection: [ref.id], trayOpen: false, colorPanel: null });
    toast('Photo added', { description: 'Stays underneath as guide. Never exported.' });
  } catch {
    toast.error("Couldn't open that file as image.");
  }
}

export function pickPhoto(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void addPhoto(f);
  };
  input.click();
}

/** The Photo button: with a photo already placed it shows that photo's controls, otherwise it asks for one. */
export function openPhoto(): void {
  const doc = getDoc();
  const ref = doc.refs[doc.refs.length - 1];
  if (ref && ui().mode === 'classic') useUi.setState({ tool: 'arrange', erasing: false, selection: [ref.id], trayOpen: false, colorPanel: null });
  else pickPhoto();
}

/** Bring in the picture that is on the clipboard. */
export async function pastePhoto(): Promise<void> {
  const fail = (): void => {
    const extra = isTouch() ? '' : ` ${keyLabel('paste') ?? 'Ctrl+V'} also pastes one straight onto the canvas.`;
    toast('No image to paste', { description: `Copy image first, then try again.${extra}` });
  };
  try {
    if (!navigator.clipboard?.read) return fail();
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) return void (await addPhoto(await item.getType(type)));
    }
    fail();
  } catch {
    fail();
  }
}

// --- saving and starting over ---------------------------------------------------

/** Everything saves by itself; this is the button for peace of mind. */
export async function saveToDevice(): Promise<void> {
  try {
    await saveNow();
    toast('Saved', { description: 'In My logos, on this device.' });
  } catch {
    toast('Could not save', { description: 'Browser is blocking storage right now.' });
  }
}

/** Put the starting design back. One step, so Undo returns what was there. */
export async function resetToStarter(): Promise<void> {
  const fresh = await import('@/examples/starter').then((m) => m.buildStarter());
  const doc = getDoc();
  commit({ ...fresh, id: doc.id, name: doc.name, createdAt: doc.createdAt, updatedAt: Date.now() });
  useUi.setState({ selection: [], tool: 'arrange', erasing: false, selectMode: 'move', showGuides: true, frameEdit: false, colorPanel: null, menu: null, ink: 0, sheet: null, lastDup: null });
  fitToScreen();
  toast('Reset to default', { description: 'Undo brings logo back.', action: { label: 'Undo', onClick: () => useDoc.getState().undo() } });
}

// --- text -----------------------------------------------------------------------

export interface TextInput {
  value: string;
  fontId: string;
  size: number;
  spacing: number;
  fill: number | string;
  weight?: number;
  italic?: boolean;
  features?: string[];
  border?: Border;
}

/** A word laid out where it will land, ready to go on the canvas. */
export interface BuiltText {
  shapes: Shape[];
  group: Group;
  /** The word it takes the place of, when retyping one. */
  replaces: string | null;
  missing: string[];
}

/**
 * Lay a word out where it will land: centred on `center` (the middle of the
 * view unless given), or in place of the word being retyped.
 */
export async function buildText(input: TextInput, target: string | null, center?: Pt): Promise<BuiltText | null> {
  const { layoutText, textShapes } = await import('@/text/layout');
  const value = input.value.trim();
  if (!value) return null;
  const features = input.features?.length ? [...input.features].sort() : undefined;
  const layout = await layoutText(value, input.fontId, input.size, input.spacing, { weight: input.weight, italic: input.italic, features });
  if (!layout.glyphs.length) return null;
  const info = {
    value,
    fontId: input.fontId,
    size: input.size,
    spacing: input.spacing,
    fill: input.fill,
    ...(input.weight !== undefined ? { weight: input.weight } : null),
    ...(input.italic ? { italic: true } : null),
    ...(features ? { features } : null),
    ...(input.border && input.border.width > 0 ? { border: input.border } : null),
  };
  const existing = target ? getDoc().groups[target] : undefined;
  if (existing?.text) return { ...textShapes(layout, info, existing.text.m, existing.id), replaces: existing.id, missing: layout.missing };
  const c = center ?? viewCenter();
  const m = translate(c.x - layout.width / 2, c.y + (layout.ascent + layout.descent) / 2 - layout.descent * 0.15);
  return { ...textShapes(layout, info, m), replaces: null, missing: layout.missing };
}

/** Put a built word on the canvas (one undo step) and select it. */
export function placeText(built: BuiltText): void {
  const doc = getDoc();
  const { shapes, group } = built;
  const at = built.replaces ? doc.shapes.findIndex((s) => s.group === built.replaces) : -1;
  const rest = built.replaces ? doc.shapes.filter((s) => s.group !== built.replaces) : [...doc.shapes];
  rest.splice(at < 0 ? rest.length : Math.min(at, rest.length), 0, ...shapes);
  commit({ ...doc, shapes: rest, groups: { ...doc.groups, [group.id]: group }, updatedAt: Date.now() });
  useUi.setState({ selection: shapes.map((s) => s.id), tool: 'arrange', erasing: false });
  if (built.missing.length) toast(`This font has no “${built.missing.join('')}”`, { description: 'Try another font for these.' });
}

/** Add a word to the canvas, or retype an existing (untouched) one. */
export async function commitText(input: TextInput, target: string | null): Promise<boolean> {
  const built = await buildText(input, target);
  if (!built) return false;
  placeText(built);
  return true;
}

// --- clipboard (within the app) ---------------------------------------------------

let clipboard: { guides: Guide[]; shapes: Shape[]; groups: Doc['groups'] } | null = null;
let pasteCount = 0;

export function copySelection(): boolean {
  const doc = getDoc();
  const sel = new Set(ui().selection);
  const guides = doc.guides.filter((g) => sel.has(g.id));
  const shapes = doc.shapes.filter((s) => sel.has(s.id));
  if (!guides.length && !shapes.length) return false;
  const groups: Doc['groups'] = {};
  for (const s of shapes) if (s.group && doc.groups[s.group]) groups[s.group] = doc.groups[s.group]!;
  clipboard = { guides, shapes, groups };
  pasteCount = 0;
  return true;
}

export const hasClipboard = (): boolean => clipboard !== null;

export function pasteClipboard(): void {
  if (!clipboard) return;
  pasteCount += 1;
  // Paste through a scratch document so copies get fresh ids and their own word groups.
  const doc = getDoc();
  const scratch: Doc = { ...doc, guides: clipboard.guides, shapes: clipboard.shapes, groups: clipboard.groups, refs: [] };
  const d = (20 / ui().view.k) * pasteCount;
  const ids = [...clipboard.guides.map((g) => g.id), ...clipboard.shapes.map((s) => s.id)];
  const r = duplicateItems(scratch, ids, translate(d, d));
  const added = new Set(r.ids);
  commit({
    ...doc,
    guides: [...doc.guides, ...r.doc.guides.filter((g) => added.has(g.id))],
    shapes: [...doc.shapes, ...r.doc.shapes.filter((s) => added.has(s.id))],
    groups: { ...doc.groups, ...Object.fromEntries(Object.entries(r.doc.groups).filter(([id]) => !(id in clipboard!.groups))) },
    updatedAt: Date.now(),
  });
  useUi.setState({ selection: r.ids, tool: 'arrange', erasing: false });
}
