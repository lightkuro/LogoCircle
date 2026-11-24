/** Advanced-mode commands: booleans, alignment, stacking order, grouping, conversions. */
import { toast } from 'sonner';
import { booleanOp, type BooleanOp } from '@/engine';
import { derivC, evalC, mul, rotate, scale, translate, type BBox, type Edge, type Mat, type Ring } from '@/geom';
import { commit, getDoc } from '@/store/doc';
import { ui, useUi } from '@/store/ui';
import type { Doc, Fill, Guide, PathGuide, PathNode, Shape, Stroke } from '@/model/types';
import { itemBBox, selectionBBox, transformItems, updateShapes } from '@/model/ops';
import { uid } from '@/model/ids';
import { transformSelection } from '@/actions';

const selectedShapes = (doc: Doc): Shape[] => {
  const sel = new Set(ui().selection);
  return doc.shapes.filter((s) => sel.has(s.id));
};

/** Combine the selected shapes. The lowest one in the stack keeps its look. */
export function booleanSelection(op: BooleanOp): void {
  const doc = getDoc();
  const shapes = selectedShapes(doc);
  if (shapes.length < 2) return;
  try {
    let rings: Ring[] = shapes[0]!.rings;
    for (let i = 1; i < shapes.length; i++) rings = booleanOp(op, rings, shapes[i]!.rings);
    const ids = new Set(shapes.map((s) => s.id));
    const base = shapes[0]!;
    const out: Shape[] = [];
    for (const s of doc.shapes) {
      if (s.id === base.id) {
        if (rings.length) out.push({ ...base, rings, group: undefined });
      } else if (!ids.has(s.id)) out.push(s);
    }
    commit({ ...doc, shapes: out, updatedAt: Date.now() });
    useUi.setState({ selection: rings.length ? [base.id] : [] });
    if (!rings.length) toast('Nothing left', { description: 'Those shapes cancel each other out.' });
  } catch {
    toast.error('Those shapes could not be combined.');
  }
}

/** Selection units: a whole group moves as one thing. */
function units(doc: Doc, ids: string[]): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  const set = new Set(ids);
  for (const id of ids) {
    if (seen.has(id)) continue;
    const s = doc.shapes.find((x) => x.id === id);
    if (s?.group) {
      const members = doc.shapes.filter((x) => x.group === s.group && set.has(x.id)).map((x) => x.id);
      members.forEach((m) => seen.add(m));
      out.push(members);
    } else {
      seen.add(id);
      out.push([id]);
    }
  }
  return out;
}

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Align to each other (several things selected) or to the artboard (one thing). */
export function alignSelection(edge: AlignEdge): void {
  let doc = getDoc();
  const ids = ui().selection;
  const us = units(doc, ids);
  if (!us.length) return;
  const target: BBox = us.length === 1 ? { x: 0, y: 0, w: doc.artboard.w, h: doc.artboard.h } : selectionBBox(doc, ids)!;
  for (const u of us) {
    const b = selectionBBox(doc, u);
    if (!b) continue;
    let dx = 0;
    let dy = 0;
    if (edge === 'left') dx = target.x - b.x;
    else if (edge === 'center') dx = target.x + target.w / 2 - (b.x + b.w / 2);
    else if (edge === 'right') dx = target.x + target.w - (b.x + b.w);
    else if (edge === 'top') dy = target.y - b.y;
    else if (edge === 'middle') dy = target.y + target.h / 2 - (b.y + b.h / 2);
    else dy = target.y + target.h - (b.y + b.h);
    if (dx || dy) doc = transformItems(doc, u, translate(dx, dy));
  }
  commit(doc);
}

/** Space three or more things evenly between the outermost two. */
export function distributeSelection(axis: 'h' | 'v'): void {
  let doc = getDoc();
  const us = units(doc, ui().selection)
    .map((u) => ({ u, b: selectionBBox(doc, u)! }))
    .filter((x) => x.b);
  if (us.length < 3) return;
  const mid = (b: BBox): number => (axis === 'h' ? b.x + b.w / 2 : b.y + b.h / 2);
  us.sort((a, b) => mid(a.b) - mid(b.b));
  const first = mid(us[0]!.b);
  const last = mid(us[us.length - 1]!.b);
  us.forEach((x, i) => {
    const want = first + ((last - first) * i) / (us.length - 1);
    const d = want - mid(x.b);
    if (Math.abs(d) > 1e-9) doc = transformItems(doc, x.u, axis === 'h' ? translate(d, 0) : translate(0, d));
  });
  commit(doc);
}

export type Order = 'front' | 'forward' | 'backward' | 'back';

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
  commit({ ...doc, shapes: next, updatedAt: Date.now() });
}

export function groupSelection(): void {
  const doc = getDoc();
  const shapes = selectedShapes(doc);
  if (shapes.length < 2) return;
  const id = uid('w');
  const ids = new Set(shapes.map((s) => s.id));
  commit({
    ...doc,
    shapes: doc.shapes.map((s) => (ids.has(s.id) ? { ...s, group: id } : s)),
    groups: { ...doc.groups, [id]: { id, kind: 'group', name: 'Group' } },
    updatedAt: Date.now(),
  });
}

export function ungroupSelection(): void {
  const doc = getDoc();
  const shapes = selectedShapes(doc);
  const gids = new Set(shapes.map((s) => s.group).filter((g): g is string => !!g));
  if (!gids.size) return;
  const groups = { ...doc.groups };
  gids.forEach((g) => delete groups[g]);
  commit({ ...doc, shapes: doc.shapes.map((s) => (s.group && gids.has(s.group) ? { ...s, group: undefined } : s)), groups, updatedAt: Date.now() });
}

// --- style ------------------------------------------------------------------

export function setSelectionFill(fill: Fill | null): void {
  commit(updateShapes(getDoc(), ui().selection, (s) => ({ ...s, fill })));
}

export function setSelectionStroke(stroke: Partial<Stroke> | null): void {
  commit(
    updateShapes(getDoc(), ui().selection, (s) => {
      if (stroke === null) return { ...s, stroke: undefined };
      const next: Stroke = { color: '#111111', width: 8, ...s.stroke, ...stroke };
      return { ...s, stroke: next.width > 0 ? next : undefined };
    }),
  );
}

export function setSelectionOpacity(doc: Doc, opacity: number): Doc {
  return updateShapes(doc, ui().selection, (s) => ({ ...s, opacity: opacity >= 1 ? undefined : opacity }));
}

// --- numeric transform --------------------------------------------------------

export function setSelectionBox(patch: Partial<BBox>): void {
  const doc = getDoc();
  const b = selectionBBox(doc, ui().selection);
  if (!b) return;
  let m: Mat = translate((patch.x ?? b.x) - b.x, (patch.y ?? b.y) - b.y);
  const sx = patch.w !== undefined && b.w > 1e-9 ? Math.max(0.001, patch.w / b.w) : 1;
  const sy = patch.h !== undefined && b.h > 1e-9 ? Math.max(0.001, patch.h / b.h) : 1;
  if (sx !== 1 || sy !== 1) {
    // One dimension typed: keep proportions, as the corner handles do.
    const s = patch.w !== undefined && patch.h === undefined ? sx : patch.h !== undefined && patch.w === undefined ? sy : null;
    m = mul(m, s !== null ? scale(s, s, b.x, b.y) : scale(sx, sy, b.x, b.y));
  }
  transformSelection(m);
}

export function rotateSelection(degrees: number): void {
  const b = selectionBBox(getDoc(), ui().selection);
  if (!b || !degrees) return;
  transformSelection(rotate((degrees * Math.PI) / 180, b.x + b.w / 2, b.y + b.h / 2));
}

// --- conversions --------------------------------------------------------------

/** One ring as pen-tool nodes (arcs become bezier approximations, a quarter turn at most each). */
function ringToNodes(ring: Ring): PathNode[] {
  const cubics: { p0: [number, number]; p1: [number, number]; p2: [number, number]; p3: [number, number]; straight: boolean }[] = [];
  const push = (e: Edge): void => {
    const c = e.c;
    if (c.k === 'L') {
      const a = evalC(c, e.t0);
      const b = evalC(c, e.t1);
      cubics.push({ p0: [a.x, a.y], p1: [a.x, a.y], p2: [b.x, b.y], p3: [b.x, b.y], straight: true });
      return;
    }
    const span = e.t1 - e.t0;
    const pieces = c.k === 'E' ? Math.max(1, Math.ceil(Math.abs(span) / (Math.PI / 2) - 1e-9)) : 1;
    for (let i = 0; i < pieces; i++) {
      const a = e.t0 + (span * i) / pieces;
      const b = e.t0 + (span * (i + 1)) / pieces;
      const pa = evalC(c, a);
      const pb = evalC(c, b);
      const da = derivC(c, a);
      const db = derivC(c, b);
      // Hermite → bezier. For an ellipse the handle length is the classic (4/3)·tan(Δ/4).
      const k = c.k === 'E' ? (4 / 3) * Math.tan((b - a) / 4) : (b - a) / 3;
      cubics.push({ p0: [pa.x, pa.y], p1: [pa.x + da.x * k, pa.y + da.y * k], p2: [pb.x - db.x * k, pb.y - db.y * k], p3: [pb.x, pb.y], straight: false });
    }
  };
  ring.forEach(push);
  const n = cubics.length;
  return cubics.map((seg, i) => {
    const prev = cubics[(i - 1 + n) % n]!;
    const node: PathNode = { x: seg.p0[0], y: seg.p0[1] };
    if (!seg.straight) {
      node.ox = seg.p1[0];
      node.oy = seg.p1[1];
    }
    if (!prev.straight) {
      node.ix = prev.p2[0];
      node.iy = prev.p2[1];
    }
    return node;
  });
}

/** Turn the selected shapes back into editable outlines (for point editing). */
export function shapesToOutlines(): void {
  const doc = getDoc();
  const shapes = selectedShapes(doc);
  if (!shapes.length) return;
  const guides: Guide[] = [];
  for (const s of shapes) {
    for (const ring of s.rings) {
      const nodes = ringToNodes(ring);
      if (nodes.length >= 2) guides.push({ id: uid('g'), type: 'path', nodes, closed: true, width: 0 } satisfies PathGuide);
    }
  }
  const ids = new Set(shapes.map((s) => s.id));
  commit({ ...doc, shapes: doc.shapes.filter((s) => !ids.has(s.id)), guides: [...doc.guides, ...guides], updatedAt: Date.now() });
  useUi.setState({ selection: guides.map((g) => g.id), showGuides: true });
  toast('Now editable as outlines', { description: 'Drag the points, then color the areas again.' });
}

export function toggleHidden(id: string): void {
  const doc = getDoc();
  commit({
    ...doc,
    shapes: doc.shapes.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s)),
    guides: doc.guides.map((g) => (g.id === id ? { ...g, hidden: !g.hidden } : g)),
    refs: doc.refs.map((r) => (r.id === id ? { ...r, hidden: !r.hidden } : r)),
    updatedAt: Date.now(),
  });
}

export function toggleLocked(id: string): void {
  const doc = getDoc();
  commit({
    ...doc,
    shapes: doc.shapes.map((s) => (s.id === id ? { ...s, locked: !s.locked } : s)),
    guides: doc.guides.map((g) => (g.id === id ? { ...g, locked: !g.locked } : g)),
    refs: doc.refs.map((r) => (r.id === id ? { ...r, locked: !r.locked } : r)),
    updatedAt: Date.now(),
  });
  useUi.setState({ selection: ui().selection.filter((x) => x !== id) });
}

export { itemBBox };
