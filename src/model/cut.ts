/**
 * Cutting: a line drawn across the artwork separates what it crosses.
 * Shapes fall into pieces that can be moved, recolored or deleted on their
 * own; outlines fall into segments. The line itself stays as a dashed cut
 * line, so it is always clear where things were cut.
 */
import { buildArrangement, neighborsNotAcross, outline, type Source } from '@/engine';
import { intersectCarriers } from '@/engine/intersect';
import { carrierKey, edgesBBox, evalC, flattenEdge, lineChain, TAU, type BBox, type Carrier, type Chain, type Edge, type LineC, type Pt } from '@/geom';
import { board } from './doc';
import { bandSpine, guideArea, guideCenterline, guideChains, guideWidth, reach } from './guides';
import { uid } from './ids';
import type { Band, Doc, Guide, LineGuide, Shape } from './types';

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

// Boxes come from flattened curves and can fall a hair short of the true extent, hence the padding.
const overlap = (a: BBox, b: BBox, pad = 0.5): boolean => a.x <= b.x + b.w + pad && b.x <= a.x + a.w + pad && a.y <= b.y + b.h + pad && b.y <= a.y + a.h + pad;

/** Cut one chain wherever the given edges cross it. Returns null when none does. */
function splitChain(chain: Chain, others: Edge[], boxes?: BBox[]): Chain[] | null {
  // 1. Split edges at their crossings.
  const edges: Edge[] = [];
  const breaks: number[] = []; // indices into `edges` where a new piece starts
  let atStart = false; // a crossing exactly where the chain begins
  for (const e of chain.edges) {
    const ts: number[] = [];
    const box = boxes ? edgesBBox([e]) : null;
    for (let k = 0; k < others.length; k++) {
      const f = others[k]!;
      if (box && !overlap(box, boxes![k]!)) continue;
      for (const hit of intersectCarriers(e.c as Carrier, f.c as Carrier)) {
        if (within(f, hit.tb) === null) continue;
        const t = within(e, hit.ta);
        if (t === null) continue;
        const span = Math.abs(e.t1 - e.t0);
        // a crossing right at an end splits nothing
        if (Math.abs(t - e.t0) < 1e-7 * Math.max(1, span) || Math.abs(t - e.t1) < 1e-7 * Math.max(1, span)) {
          if (Math.abs(t - e.t0) < 1e-7 * Math.max(1, span)) {
            if (edges.length) breaks.push(edges.length);
            else atStart = true;
          }
          if (Math.abs(t - e.t1) < 1e-7 * Math.max(1, span)) ts.push(e.t1);
          continue;
        }
        ts.push(t);
      }
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
  const closedCutAtSeam = chain.closed && (atStart || breaks.includes(edges.length));
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
    const blade: Edge[] = [{ c: cut, t0: 0, t1: 1 }];
    for (const c of center) {
      const parts = splitChain(c, blade);
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
      // the pieces stay in the outline's group (a word's letters stay one word)
      const base = { id: i === 0 ? g.id : uid('g'), ...(g.group ? { group: g.group } : null), ...(g.name ? { name: g.name } : null) };
      const only = piece.edges.length === 1 ? piece.edges[0]! : null;
      if (only && only.c.k === 'L' && !piece.closed) {
        // a piece of a straight line is still a straight line, with its two end handles
        const a = evalC(only.c, only.t0);
        const b = evalC(only.c, only.t1);
        out.push({ ...base, type: 'line', x0: a.x, y0: a.y, x1: b.x, y1: b.y, width });
      } else {
        out.push({ ...base, type: 'edges', edges: piece.edges, closed: piece.closed, width, band: g.type === 'line' ? undefined : g.band });
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

// ---------------------------------------------------------------------------
// Trimming: remove the piece of an outline between two crossings
// ---------------------------------------------------------------------------

/** A stretch of an outline from one crossing to the next (or to its end). */
export interface Piece {
  guide: string;
  /** Which of the guide's chains, and which stretch along it. */
  chain: number;
  index: number;
  /** How many stretches that chain has. */
  of: number;
  edges: Edge[];
  /** Flattened, for finding the piece under the pointer and for showing it. */
  pts: Pt[];
  /** How far from the line still counts as touching it (half the thickness). */
  reach: number;
}

const pieceCache = new WeakMap<readonly Guide[], Piece[]>();

/**
 * Every outline, divided at its crossings with the others. `guides` are the
 * ones on screen; hidden and locked ones are neither cut nor counted.
 */
export function outlinePieces(guides: readonly Guide[]): Piece[] {
  const hit = pieceCache.get(guides);
  if (hit) return hit;
  const live = guides.filter((g) => !g.hidden);
  // What each outline puts on screen: for a thick one, the two edges of its band.
  const lines = live.map((g) => guideChains(g).flatMap((c) => c.edges));
  const boxes = lines.map((list) => list.map((e) => edgesBBox([e])));
  const out: Piece[] = [];
  live.forEach((g, gi) => {
    if (g.locked || (g.type === 'line' && g.cut)) return;
    const others: Edge[] = [];
    const otherBoxes: BBox[] = [];
    lines.forEach((list, k) => {
      if (k === gi) return;
      others.push(...list);
      otherBoxes.push(...boxes[k]!);
    });
    const w = guideWidth(g);
    bandSpine(g).forEach((c, ci) => {
      let parts: Chain[];
      try {
        parts = splitChain(c, others, otherBoxes) ?? [c];
      } catch {
        parts = [c];
      }
      parts.forEach((part, index) => {
        const pts: Pt[] = [];
        for (const e of part.edges) {
          const flat = flattenEdge(e, 0.5);
          pts.push(...(pts.length ? flat.slice(1) : flat));
        }
        out.push({ guide: g.id, chain: ci, index, of: parts.length, edges: part.edges, pts, reach: w / 2 });
      });
    });
  });
  pieceCache.set(guides, out);
  return out;
}

function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best) best = d;
  }
  return best;
}

/** The piece of outline under a point, if any is within `tol`. */
export function pieceAt(guides: readonly Guide[], p: Pt, tol: number): Piece | null {
  let best: Piece | null = null;
  let bestD = Infinity;
  for (const piece of outlinePieces(guides)) {
    const d = distToPolyline(p, piece.pts) - piece.reach;
    if (d <= tol && d < bestD) {
      best = piece;
      bestD = d;
    }
  }
  return best;
}

/**
 * Remove one piece of an outline. What is left of the outline stays, as one or
 * two open pieces. Colors keep their look: a fill that was following the
 * outline lets go of it, and a colored thick outline loses the same piece.
 */
export function trimPiece(doc: Doc, guides: readonly Guide[], piece: Piece): Doc {
  const g = doc.guides.find((x) => x.id === piece.guide);
  if (!g) return doc;
  const mine = outlinePieces(guides).filter((x) => x.guide === g.id);
  const spine = bandSpine(g);
  const width = guideWidth(g);
  const left: Chain[] = [];
  spine.forEach((c, ci) => {
    if (ci !== piece.chain) return void left.push(c);
    const list = mine.filter((x) => x.chain === ci).sort((a, b) => a.index - b.index);
    const n = list.length;
    const join = (from: number, count: number): Edge[] => {
      const edges: Edge[] = [];
      for (let k = 0; k < count; k++) edges.push(...list[(from + k) % n]!.edges);
      return edges;
    };
    if (c.closed) {
      // the rest of the loop, starting just after the piece that goes
      if (n > 1) left.push({ edges: join(piece.index + 1, n - 1), closed: false });
    } else {
      if (piece.index > 0) left.push({ edges: join(0, piece.index), closed: false });
      if (piece.index < n - 1) left.push({ edges: join(piece.index + 1, n - 1 - piece.index), closed: false });
    }
  });

  const made: Guide[] = left
    .filter((c) => c.edges.length)
    .map((c): Guide => {
      const base = { id: uid('g'), group: g.group, hidden: g.hidden, locked: g.locked };
      const only = c.edges.length === 1 ? c.edges[0]! : null;
      if (only && only.c.k === 'L' && !c.closed) {
        const a = evalC(only.c, only.t0);
        const b = evalC(only.c, only.t1);
        return { ...base, type: 'line', x0: a.x, y0: a.y, x1: b.x, y1: b.y, width, cut: g.type === 'line' ? g.cut : undefined };
      }
      // Along the middle of the band, so the pieces keep the thickness exactly where it was.
      return { ...base, type: 'edges', edges: c.edges, closed: c.closed, width, band: c.closed ? (g.type === 'line' ? undefined : g.band) : 'mid' };
    });

  const shapes: Shape[] = [];
  for (const s of doc.shapes) {
    const link = s.from;
    if (!link) {
      shapes.push(s);
    } else if ('area' in link) {
      if (link.area !== g.id) shapes.push(s);
      else if (!(width > 0)) shapes.push({ ...s, from: undefined }); // a filled-in outline keeps its fill
      else {
        // A colored thick outline is the outline: it loses the same piece.
        let first = true;
        for (const ng of made) {
          const rings = guideArea(ng);
          if (!rings) continue;
          shapes.push({ ...s, id: first ? s.id : uid('s'), rings, from: { area: ng.id } });
          first = false;
        }
      }
    } else {
      shapes.push(link.guides.includes(g.id) ? { ...s, from: undefined } : s);
    }
  }

  const at = doc.guides.indexOf(g);
  const next = [...doc.guides.slice(0, at), ...made, ...doc.guides.slice(at + 1)];
  // The piece itself is set aside, thin and along its middle, so it can be shown and brought back.
  const whole = piece.of === 1 && !!spine[piece.chain]?.closed;
  const gone = pieceGuide(piece.edges, whole, { group: g.group, band: whole && g.type !== 'line' ? g.band : 'mid' }, width);
  return { ...doc, guides: next, trimmed: [...(doc.trimmed ?? []), gone], shapes, updatedAt: Date.now() };
}

/** A guide for a run of edges: a straight line when it is one, otherwise a free run of edges. */
function pieceGuide(edges: Edge[], closed: boolean, base: { group?: string; band?: Band }, width: number): Guide {
  const id = uid('g');
  const only = edges.length === 1 ? edges[0]! : null;
  if (only && only.c.k === 'L' && !closed) {
    const a = evalC(only.c, only.t0);
    const b = evalC(only.c, only.t1);
    return { id, group: base.group, type: 'line', x0: a.x, y0: a.y, x1: b.x, y1: b.y, width };
  }
  return { id, group: base.group, type: 'edges', edges, closed, width, band: width > 0 ? base.band : undefined };
}

/**
 * Bring a removed piece back as an outline of its own. A cut line brought back
 * becomes an ordinary line.
 */
export function restoreTrimmed(doc: Doc, id: string): Doc {
  const list = doc.trimmed ?? [];
  const g = list.find((x) => x.id === id);
  if (!g) return doc;
  const back = { ...g, group: g.group && doc.groups[g.group] ? g.group : undefined } as Guide;
  if (back.type === 'line') delete (back as { cut?: boolean }).cut;
  const trimmed = list.filter((x) => x.id !== id);
  return { ...doc, guides: [...doc.guides, back], trimmed: trimmed.length ? trimmed : undefined, updatedAt: Date.now() };
}

/** Make a dashed cut line, left by slicing, an ordinary line. */
export function restoreCutLine(doc: Doc, id: string): Doc {
  const g = doc.guides.find((x) => x.id === id);
  if (!g || g.type !== 'line' || !g.cut) return doc;
  return { ...doc, guides: doc.guides.map((x) => (x === g ? { ...g, cut: undefined } : x)), updatedAt: Date.now() };
}

/** What can be brought back: removed pieces, and the lines left by slicing. */
export interface Mark {
  id: string;
  kind: 'trimmed' | 'cut';
  pts: Pt[];
}

const markCache = new WeakMap<Doc, Mark[]>();

export function cutMarks(doc: Doc): Mark[] {
  const hit = markCache.get(doc);
  if (hit) return hit;
  const out: Mark[] = [];
  const flat = (g: Guide): Pt[] => {
    const pts: Pt[] = [];
    for (const c of guideCenterline(g)) for (const e of c.edges) pts.push(...flattenEdge(e, 0.5));
    return pts;
  };
  for (const g of doc.trimmed ?? []) out.push({ id: g.id, kind: 'trimmed', pts: flat(g) });
  for (const g of doc.guides) if (g.type === 'line' && g.cut && !g.hidden) out.push({ id: g.id, kind: 'cut', pts: flat(g) });
  markCache.set(doc, out);
  return out;
}

/** The mark under a point, if any is within `tol`. */
export function markAt(doc: Doc, p: Pt, tol: number): Mark | null {
  let best: Mark | null = null;
  let bestD = Infinity;
  for (const m of cutMarks(doc)) {
    const d = distToPolyline(p, m.pts);
    if (d <= tol && d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

export function restoreMark(doc: Doc, mark: Mark): Doc {
  return mark.kind === 'trimmed' ? restoreTrimmed(doc, mark.id) : restoreCutLine(doc, mark.id);
}
