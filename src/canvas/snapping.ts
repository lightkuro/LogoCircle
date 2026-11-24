import { evalC, type BBox, type Pt } from '@/geom';
import type { Doc } from '@/model/types';
import { guidePoints, guideSnapPoints, isClosedGuide } from '@/model/guides';
import { itemBBox } from '@/model/ops';
import { board } from '@/model/doc';

export interface SnapLine {
  a: Pt;
  b: Pt;
}

interface Axis {
  v: number;
  lo: number;
  hi: number;
}

function targets(doc: Doc, exclude: Set<string>, grid = 0): { xs: Axis[]; ys: Axis[] } {
  const { x, y, w, h } = board(doc);
  const xs: Axis[] = [
    { v: x, lo: y, hi: y + h },
    { v: x + w / 2, lo: y, hi: y + h },
    { v: x + w, lo: y, hi: y + h },
  ];
  const ys: Axis[] = [
    { v: y, lo: x, hi: x + w },
    { v: y + h / 2, lo: x, hi: x + w },
    { v: y + h, lo: x, hi: x + w },
  ];
  if (grid > 0) {
    for (let v = grid; v < w; v += grid) xs.push({ v: x + v, lo: y, hi: y + h });
    for (let v = grid; v < h; v += grid) ys.push({ v: y + v, lo: x, hi: x + w });
  }
  const ids = [...doc.guides.map((g) => g.id), ...doc.shapes.map((s) => s.id)];
  if (ids.length > 150) return { xs, ys };
  for (const id of ids) {
    if (exclude.has(id)) continue;
    const b = itemBBox(doc, id);
    if (!b) continue;
    for (const v of [b.x, b.x + b.w / 2, b.x + b.w]) xs.push({ v, lo: b.y, hi: b.y + b.h });
    for (const v of [b.y, b.y + b.h / 2, b.y + b.h]) ys.push({ v, lo: b.x, hi: b.x + b.w });
  }
  return { xs, ys };
}

/** Nudge a move so the selection's edges or centre line up with something nearby. */
export function snapMove(
  doc: Doc,
  ids: Set<string>,
  box: BBox,
  dx: number,
  dy: number,
  tol: number,
  grid = 0,
): { dx: number; dy: number; lines: SnapLine[] } {
  const { xs, ys } = targets(doc, ids, grid);
  const lines: SnapLine[] = [];
  let bestX: { d: number; t: Axis } | null = null;
  for (const own of [box.x, box.x + box.w / 2, box.x + box.w]) {
    for (const t of xs) {
      const d = t.v - (own + dx);
      if (Math.abs(d) <= tol && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, t };
    }
  }
  let bestY: { d: number; t: Axis } | null = null;
  for (const own of [box.y, box.y + box.h / 2, box.y + box.h]) {
    for (const t of ys) {
      const d = t.v - (own + dy);
      if (Math.abs(d) <= tol && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, t };
    }
  }
  if (bestX) dx += bestX.d;
  if (bestY) dy += bestY.d;
  if (bestX) {
    const lo = Math.min(bestX.t.lo, box.y + dy);
    const hi = Math.max(bestX.t.hi, box.y + box.h + dy);
    lines.push({ a: { x: bestX.t.v, y: lo }, b: { x: bestX.t.v, y: hi } });
  }
  if (bestY) {
    const lo = Math.min(bestY.t.lo, box.x + dx);
    const hi = Math.max(bestY.t.hi, box.x + box.w + dx);
    lines.push({ a: { x: lo, y: bestY.t.v }, b: { x: hi, y: bestY.t.v } });
  }
  return { dx, dy, lines };
}

const ANGLE_STEP = Math.PI / 12;

/**
 * Snap a dragged point to nearby key points of other outlines, to the
 * artboard, or — relative to `anchor` (the other end of a line) — to 15°.
 */
export function snapPoint(
  doc: Doc,
  excludeId: string,
  p: Pt,
  tol: number,
  anchor?: Pt,
  grid = 0,
): { p: Pt; lines: SnapLine[] } {
  const { x: ox, y: oy, w, h } = board(doc);
  const pts: Pt[] = [
    { x: ox, y: oy }, { x: ox + w / 2, y: oy }, { x: ox + w, y: oy },
    { x: ox, y: oy + h / 2 }, { x: ox + w / 2, y: oy + h / 2 }, { x: ox + w, y: oy + h / 2 },
    { x: ox, y: oy + h }, { x: ox + w / 2, y: oy + h }, { x: ox + w, y: oy + h },
  ];
  if (doc.guides.length <= 150) {
    for (const g of doc.guides) if (g.id !== excludeId && !g.hidden) pts.push(...guideSnapPoints(g));
  }
  let best: Pt | null = null;
  let bestD = tol;
  for (const q of pts) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = q;
    }
  }
  if (best) return { p: { x: best.x, y: best.y }, lines: [] };

  if (grid > 0) {
    const gx = ox + Math.round((p.x - ox) / grid) * grid;
    const gy = oy + Math.round((p.y - oy) / grid) * grid;
    if (Math.hypot(gx - p.x, gy - p.y) <= tol) return { p: { x: gx, y: gy }, lines: [] };
  }

  // Where two other outlines cross is a natural place to end a line.
  const cross = nearestCrossing(doc, excludeId, p, tol);
  if (cross) return { p: cross, lines: [] };

  // Next best: land exactly on another outline, so the two close an area.
  if (doc.guides.length <= 150) {
    let on: Pt | null = null;
    let onD = tol * 0.8;
    for (const g of doc.guides) {
      if (g.id === excludeId || g.hidden) continue;
      const closed = isClosedGuide(g);
      for (const poly of guidePoints(g)) {
        const n = poly.length;
        const count = closed ? n : n - 1;
        for (let i = 0; i < count; i++) {
          const a = poly[i]!;
          const b = poly[(i + 1) % n]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          if (len2 === 0) continue;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
          const qx = a.x + dx * t;
          const qy = a.y + dy * t;
          const d = Math.hypot(p.x - qx, p.y - qy);
          if (d < onD) {
            onD = d;
            on = { x: qx, y: qy };
          }
        }
      }
    }
    if (on) return { p: on, lines: [] };
  }

  if (anchor) {
    const dx = p.x - anchor.x;
    const dy = p.y - anchor.y;
    const len = Math.hypot(dx, dy);
    if (len > tol * 2) {
      const a = Math.atan2(dy, dx);
      const s = Math.round(a / ANGLE_STEP) * ANGLE_STEP;
      const off = Math.abs(Math.sin(a - s)) * len;
      if (off <= tol) {
        const q = { x: anchor.x + Math.cos(s) * len, y: anchor.y + Math.sin(s) * len };
        return { p: q, lines: [{ a: anchor, b: q }] };
      }
    }
  }

  // Fall back to lining up with a single axis of a key point.
  let out = { x: p.x, y: p.y };
  const lines: SnapLine[] = [];
  let bx: Pt | null = null;
  let by: Pt | null = null;
  let dxBest = tol;
  let dyBest = tol;
  for (const q of pts) {
    const ax = Math.abs(q.x - p.x);
    const ay = Math.abs(q.y - p.y);
    if (ax <= dxBest) {
      dxBest = ax;
      bx = q;
    }
    if (ay <= dyBest) {
      dyBest = ay;
      by = q;
    }
  }
  if (bx) out = { x: bx.x, y: out.y };
  if (by) out = { x: out.x, y: by.y };
  if (bx) lines.push({ a: bx, b: out });
  if (by) lines.push({ a: by, b: out });
  return { p: out, lines };
}

/** The closest point within `tol` of `p` where two different outlines cross. */
function nearestCrossing(doc: Doc, excludeId: string, p: Pt, tol: number): Pt | null {
  if (doc.guides.length > 150) return null;
  // Only segments passing near the pointer can produce a crossing near it.
  const near: { a: Pt; b: Pt; g: string }[] = [];
  const reach = tol * 2;
  for (const g of doc.guides) {
    if (g.id === excludeId || g.hidden) continue;
    const closed = isClosedGuide(g);
    for (const poly of guidePoints(g)) {
      const n = poly.length;
      const count = closed ? n : n - 1;
      for (let i = 0; i < count; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % n]!;
        if (Math.min(a.x, b.x) - reach > p.x || Math.max(a.x, b.x) + reach < p.x) continue;
        if (Math.min(a.y, b.y) - reach > p.y || Math.max(a.y, b.y) + reach < p.y) continue;
        near.push({ a, b, g: g.id });
      }
    }
  }
  let best: Pt | null = null;
  let bestD = tol;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const s1 = near[i]!;
      const s2 = near[j]!;
      if (s1.g === s2.g) continue;
      const d1x = s1.b.x - s1.a.x;
      const d1y = s1.b.y - s1.a.y;
      const d2x = s2.b.x - s2.a.x;
      const d2y = s2.b.y - s2.a.y;
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((s2.a.x - s1.a.x) * d2y - (s2.a.y - s1.a.y) * d2x) / den;
      const u = ((s2.a.x - s1.a.x) * d1y - (s2.a.y - s1.a.y) * d1x) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const q = { x: s1.a.x + d1x * t, y: s1.a.y + d1y * t };
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bestD) {
        bestD = d;
        best = q;
      }
    }
  }
  return best;
}

/**
 * While a single circle is being moved: if it comes close to just touching
 * another circle or a line, make it touch exactly. Touching outlines are what
 * geometric marks are built from, and a near-miss leaves a hairline gap.
 */
export function snapTangent(doc: Doc, id: string, dx: number, dy: number, tol: number): { dx: number; dy: number; lines: SnapLine[] } | null {
  const me = doc.guides.find((g) => g.id === id);
  if (!me || me.type !== 'ellipse' || Math.abs(me.rx - me.ry) > 1e-6 * me.rx) return null;
  if (doc.guides.length > 150) return null;
  const r = me.rx;
  const cx = me.cx + dx;
  const cy = me.cy + dy;
  let best: { dx: number; dy: number; line: SnapLine } | null = null;
  let bestD = tol;
  for (const g of doc.guides) {
    if (g.id === id || g.hidden) continue;
    if (g.type === 'ellipse' && Math.abs(g.rx - g.ry) <= 1e-6 * g.rx) {
      const ox = cx - g.cx;
      const oy = cy - g.cy;
      const d = Math.hypot(ox, oy);
      if (d < 1e-6) continue;
      // touching from outside, or from inside (one within the other)
      for (const want of [g.rx + r, Math.abs(g.rx - r)]) {
        if (want < 1e-6) continue;
        const off = Math.abs(d - want);
        if (off < bestD) {
          bestD = off;
          const k = want / d;
          const nx = g.cx + ox * k;
          const ny = g.cy + oy * k;
          const touch = { x: g.cx + (ox / d) * g.rx, y: g.cy + (oy / d) * g.rx };
          best = { dx: dx + (nx - cx), dy: dy + (ny - cy), line: { a: { x: g.cx, y: g.cy }, b: touch } };
        }
      }
    } else if (g.type === 'line' && g.width === 0) {
      const lx = g.x1 - g.x0;
      const ly = g.y1 - g.y0;
      const len = Math.hypot(lx, ly);
      if (len < 1e-6) continue;
      const t = ((cx - g.x0) * lx + (cy - g.y0) * ly) / (len * len);
      if (t < 0 || t > 1) continue;
      // signed distance from the line
      const sd = ((cx - g.x0) * ly - (cy - g.y0) * lx) / len;
      const off = Math.abs(Math.abs(sd) - r);
      if (off < bestD) {
        bestD = off;
        const push = (Math.sign(sd) || 1) * r - sd;
        const nx = ly / len;
        const ny = -lx / len;
        const foot = { x: g.x0 + lx * t, y: g.y0 + ly * t };
        best = { dx: dx + nx * push, dy: dy + ny * push, line: { a: foot, b: { x: cx + nx * push, y: cy + ny * push } } };
      }
    }
  }
  return best ? { dx: best.dx, dy: best.dy, lines: [best.line] } : null;
}

// ---------------------------------------------------------------------------
// Sticky points: corners and points pull onto nearby corners, points and edges
// ---------------------------------------------------------------------------

/** The corners and points of a shape's outline: where its edges meet. */
function shapeCorners(doc: Doc, id: string): Pt[] {
  const s = doc.shapes.find((x) => x.id === id);
  if (!s) return [];
  const out: Pt[] = [];
  for (const ring of s.rings) for (const e of ring) out.push(evalC(e.c, e.t0));
  return out;
}

/** The points something offers: an outline's key points, a shape's corners. */
function ownPoints(doc: Doc, id: string): Pt[] {
  const g = doc.guides.find((x) => x.id === id);
  return g ? guideSnapPoints(g) : shapeCorners(doc, id);
}

interface StickyTargets {
  points: Pt[];
  edges: Pt[][];
}

function stickyTargets(doc: Doc, exclude: Set<string>): StickyTargets {
  const { x, y, w, h } = board(doc);
  const points: Pt[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
    { x: x + w / 2, y: y + h / 2 },
  ];
  const edges: Pt[][] = [[points[0]!, points[1]!, points[2]!, points[3]!, points[0]!]];
  if (doc.guides.length + doc.shapes.length > 200) return { points, edges };
  for (const g of doc.guides) {
    if (exclude.has(g.id) || g.hidden) continue;
    points.push(...guideSnapPoints(g));
    edges.push(...guidePoints(g, 1));
  }
  for (const s of doc.shapes) {
    if (exclude.has(s.id) || s.hidden) continue;
    points.push(...shapeCorners(doc, s.id));
  }
  return { points, edges };
}

/** The nearest point of any edge to `p`, if one is within `tol`. */
function nearestOnEdges(edges: Pt[][], p: Pt, tol: number): { q: Pt; d: number } | null {
  let best: { q: Pt; d: number } | null = null;
  for (const poly of edges) {
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1]!;
      const b = poly[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= tol && (!best || d < best.d)) best = { q, d };
    }
  }
  return best;
}

/** Where a point would stick: the nearest corner or point within `tol`, else the nearest edge. */
function stickTo(t: StickyTargets, p: Pt, tol: number): { q: Pt; d: number; kind: 'point' | 'edge' } | null {
  let best: { q: Pt; d: number; kind: 'point' | 'edge' } | null = null;
  for (const q of t.points) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= tol && (!best || d < best.d)) best = { q, d, kind: 'point' };
  }
  if (best) return best;
  const on = nearestOnEdges(t.edges, p, tol * 0.8);
  return on && { ...on, kind: 'edge' };
}

/**
 * Sticky points, for a move: of all the corners and points being moved, the
 * one nearest to another corner, point or edge pulls the whole move onto it.
 * Points win over edges. Returns null when nothing is near.
 */
export function snapSticky(doc: Doc, ids: Set<string>, dx: number, dy: number, tol: number): { dx: number; dy: number; lines: SnapLine[] } | null {
  const t = stickyTargets(doc, ids);
  let best: { ox: number; oy: number; score: number; q: Pt } | null = null;
  for (const id of ids) {
    for (const p of ownPoints(doc, id)) {
      const at = { x: p.x + dx, y: p.y + dy };
      const hit = stickTo(t, at, tol);
      if (!hit) continue;
      const score = hit.d * (hit.kind === 'edge' ? 1.25 : 1);
      if (!best || score < best.score) best = { ox: hit.q.x - at.x, oy: hit.q.y - at.y, score, q: hit.q };
    }
  }
  if (!best) return null;
  return { dx: dx + best.ox, dy: dy + best.oy, lines: [{ a: best.q, b: best.q }] };
}

/** Sticky points, for one dragged point or handle: where it would stick, if anywhere. */
export function stickyPoint(doc: Doc, exclude: Set<string>, p: Pt, tol: number): Pt | null {
  return stickTo(stickyTargets(doc, exclude), p, tol)?.q ?? null;
}
