/**
 * Cutting: a line drawn across the artwork separates what it crosses.
 * Shapes fall into pieces that can be moved, recolored or deleted on their
 * own; outlines fall into segments. The line itself stays as a dashed cut
 * line, so it is always clear where things were cut.
 */
import { buildArrangement, neighborsNotAcross, outline, type Source } from '@/engine';
import { intersectCarriers } from '@/engine/intersect';
import { carrierKey, evalC, lineChain, TAU, type Carrier, type Chain, type Edge, type LineC } from '@/geom';
import { board } from './doc';
import { guideCenterline, reach } from './guides';
import { uid } from './ids';
import type { Doc, Guide, LineGuide, Shape } from './types';

const CUT = '__cut__';

/** Split every shape the cut crosses into the pieces it leaves. */
function cutShapes(doc: Doc, cut: Chain): Shape[] {
  const targets = doc.shapes.filter((s) => !s.hidden && !s.locked && s.rings.length);
  if (!targets.length) return doc.shapes;
  const sources: Source[] = [
    { id: CUT, fill: false, chains: [cut] },
    ...targets.map((s) => ({ id: s.id, fill: true, chains: s.rings.map((r) => ({ edges: r, closed: true })) })),
  ];
  const { x, y, w, h } = board(doc);
  const arr = buildArrangement(sources, { bounds: { x: x - w, y: y - h, w: w * 3, h: h * 3 } });
  const keys = new Set(cut.edges.map((e) => carrierKey(e.c)));

  const facesOf = new Map<string, number[]>();
  for (const f of arr.faces) {
    for (const id of f.inside) {
      let list = facesOf.get(id);
      if (!list) facesOf.set(id, (list = []));
      list.push(f.id);
    }
  }
  /** Connected groups of faces; `across` decides whether the cut line separates. */
  const groups = (faces: number[], separated: boolean): number[][] => {
    const left = new Set(faces);
    const out: number[][] = [];
    for (const start of faces) {
      if (!left.has(start)) continue;
      left.delete(start);
      const piece: number[] = [];
      const stack = [start];
      while (stack.length) {
        const f = stack.pop()!;
        piece.push(f);
        for (const n of neighborsNotAcross(arr, f, separated ? keys : EMPTY)) {
          if (left.has(n)) {
            left.delete(n);
            stack.push(n);
          }
        }
      }
      out.push(piece);
    }
    return out;
  };

  const out: Shape[] = [];
  for (const s of doc.shapes) {
    const faces = facesOf.get(s.id);
    if (!faces || !faces.length) {
      out.push(s);
      continue;
    }
    const before = groups(faces, false).length;
    const after = groups(faces, true);
    if (after.length <= before) {
      out.push(s); // the line did not go all the way through
      continue;
    }
    // Largest piece keeps the shape's identity.
    const area = (piece: number[]): number => piece.reduce((a, f) => a + arr.faces[f]!.area, 0);
    after.sort((a, b) => area(b) - area(a));
    after.forEach((piece, i) => {
      const rings = outline(arr, piece);
      // A cut piece is free: it no longer follows the outlines it was colored from.
      if (rings.length) out.push({ ...s, id: i === 0 ? s.id : uid('s'), rings, from: undefined });
    });
  }
  return out;
}

const EMPTY: ReadonlySet<string> = new Set();

/** The parameter of a hit as it falls inside a directed edge, or null if it is outside the edge. */
function within(e: Edge, t: number): number | null {
  const lo = Math.min(e.t0, e.t1);
  const hi = Math.max(e.t0, e.t1);
  const eps = 1e-9;
  if (e.c.k === 'E') {
    // angles repeat every turn: bring the hit into the edge's own stretch
    let v = t + Math.ceil((lo - t) / TAU - 1e-12) * TAU;
    if (v > hi + eps) v -= TAU;
    if (v < lo - eps || v > hi + eps) return null;
    return v;
  }
  return t < lo - eps || t > hi + eps ? null : t;
}

/** Cut one chain wherever the cut line crosses it. Returns null when it does not. */
function cutChain(chain: Chain, cut: LineC): Chain[] | null {
  // 1. Split edges at their crossings.
  const edges: Edge[] = [];
  const breaks: number[] = []; // indices into `edges` where a new piece starts
  for (const e of chain.edges) {
    const ts: number[] = [];
    for (const hit of intersectCarriers(e.c as Carrier, cut)) {
      if (hit.tb < -1e-9 || hit.tb > 1 + 1e-9) continue;
      const t = within(e, hit.ta);
      if (t === null) continue;
      const span = Math.abs(e.t1 - e.t0);
      // a crossing right at an end splits nothing
      if (Math.abs(t - e.t0) < 1e-7 * Math.max(1, span) || Math.abs(t - e.t1) < 1e-7 * Math.max(1, span)) {
        if (Math.abs(t - e.t0) < 1e-7 * Math.max(1, span) && edges.length) breaks.push(edges.length);
        if (Math.abs(t - e.t1) < 1e-7 * Math.max(1, span)) ts.push(e.t1);
        continue;
      }
      ts.push(t);
    }
    const dir = e.t1 >= e.t0 ? 1 : -1;
    const uniq = [...new Set(ts)].sort((a, b) => (a - b) * dir);
    let from = e.t0;
    for (const t of uniq) {
      if (t !== from) edges.push({ c: e.c, t0: from, t1: t });
      breaks.push(edges.length);
      from = t;
    }
    if (from !== e.t1) edges.push({ c: e.c, t0: from, t1: e.t1 });
  }
  const cuts = [...new Set(breaks)].filter((i) => i > 0 && i < edges.length).sort((a, b) => a - b);
  const closedCutAtSeam = chain.closed && breaks.includes(edges.length);
  if (!cuts.length && !closedCutAtSeam) return null;

  // 2. Collect the pieces between crossings.
  const pieces: Edge[][] = [];
  let start = 0;
  for (const i of cuts) {
    pieces.push(edges.slice(start, i));
    start = i;
  }
  pieces.push(edges.slice(start));
  if (chain.closed && pieces.length > 1 && !closedCutAtSeam) {
    // a closed outline has no real start: the last piece runs on into the first
    const last = pieces.pop()!;
    pieces[0] = [...last, ...pieces[0]!];
  }
  return pieces.filter((p) => p.length).map((p) => ({ edges: p, closed: false }));
}

/** Cut the outlines the line crosses into separate segments. */
function cutGuides(doc: Doc, cut: LineC): Guide[] {
  const out: Guide[] = [];
  for (const g of doc.guides) {
    if (g.hidden || g.locked || (g.type === 'line' && g.cut)) {
      out.push(g);
      continue;
    }
    const center = guideCenterline(g);
    let any = false;
    const pieces: Chain[] = [];
    for (const c of center) {
      const parts = cutChain(c, cut);
      if (parts) {
        any = true;
        pieces.push(...parts);
      } else pieces.push(c);
    }
    if (!any) {
      out.push(g);
      continue;
    }
    const width = g.width ?? 0;
    pieces.forEach((piece, i) => {
      const id = i === 0 ? g.id : uid('g');
      const only = piece.edges.length === 1 ? piece.edges[0]! : null;
      if (only && only.c.k === 'L' && !piece.closed) {
        // a piece of a straight line is still a straight line, with its two end handles
        const a = evalC(only.c, only.t0);
        const b = evalC(only.c, only.t1);
        out.push({ id, type: 'line', x0: a.x, y0: a.y, x1: b.x, y1: b.y, width });
      } else {
        out.push({ id, type: 'edges', edges: piece.edges, closed: piece.closed, width, band: g.type === 'line' ? undefined : g.band });
      }
    });
  }
  return out;
}

/**
 * Apply a cut along the straight line a → b. Returns the same document when
 * the line crosses nothing.
 */
export function cutAlong(doc: Doc, a: { x: number; y: number }, b: { x: number; y: number }, opts: { outlines: boolean }): Doc {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return doc;
  const chain = lineChain(a.x, a.y, b.x, b.y);
  const carrier = chain.edges[0]!.c as LineC;
  let shapes = cutShapes(doc, reach(chain));
  // A colored outline (a ring, a stroke) that got cut lives on as its free pieces;
  // the outline it was made from would no longer match them, so it goes.
  const now = new Map(shapes.map((s) => [s.id, s]));
  const spent = new Set<string>();
  for (const s of doc.shapes) if (s.from && 'area' in s.from && now.get(s.id) !== s) spent.add(s.from.area);
  const kept = spent.size ? { ...doc, guides: doc.guides.filter((g) => !spent.has(g.id)) } : doc;
  const guides = opts.outlines ? cutGuides(kept, carrier) : kept.guides;
  // Fills that were following an outline that just got cut keep their look and let go of it.
  const was = new Map(doc.guides.map((g) => [g.id, g]));
  const cutIds = new Set(guides.filter((g) => was.has(g.id) && was.get(g.id) !== g).map((g) => g.id));
  if (cutIds.size) {
    shapes = shapes.map((s) => {
      if (!s.from) return s;
      const ids = 'area' in s.from ? [s.from.area] : s.from.guides;
      return ids.some((id) => cutIds.has(id)) ? { ...s, from: undefined } : s;
    });
  }
  const shapesChanged = shapes.length !== doc.shapes.length;
  const guidesChanged = guides.length !== kept.guides.length || guides.some((g, i) => g !== kept.guides[i]);
  if (!shapesChanged && !guidesChanged) return doc;
  const line: LineGuide = { id: uid('g'), type: 'line', x0: a.x, y0: a.y, x1: b.x, y1: b.y, width: 0, cut: true };
  // Words that lost a letter's shape to a cut can no longer be retyped.
  const cutGroups = new Set<string>();
  if (shapesChanged) {
    const before = new Map(doc.shapes.map((s) => [s.id, s]));
    for (const s of shapes) if (s.group && before.get(s.id) !== s) cutGroups.add(s.group);
  }
  let groups = doc.groups;
  for (const id of cutGroups) {
    const g = groups[id];
    if (g?.text?.pristine) {
      if (groups === doc.groups) groups = { ...groups };
      groups[id] = { ...g, text: { ...g.text, pristine: false } };
    }
  }
  return { ...doc, shapes, guides: [...guides, line], groups, updatedAt: Date.now() };
}
