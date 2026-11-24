import type { BBox, Pt } from '@/geom';
import type { Doc } from '@/model/types';
import { guidePoints, guideSnapPoints, isClosedGuide } from '@/model/guides';
import { itemBBox } from '@/model/ops';

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
  const { w, h } = doc.artboard;
  const xs: Axis[] = [
    { v: 0, lo: 0, hi: h },
    { v: w / 2, lo: 0, hi: h },
    { v: w, lo: 0, hi: h },
  ];
  const ys: Axis[] = [
    { v: 0, lo: 0, hi: w },
    { v: h / 2, lo: 0, hi: w },
    { v: h, lo: 0, hi: w },
  ];
  if (grid > 0) {
    for (let v = grid; v < w; v += grid) xs.push({ v, lo: 0, hi: h });
    for (let v = grid; v < h; v += grid) ys.push({ v, lo: 0, hi: w });
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
  const { w, h } = doc.artboard;
  const pts: Pt[] = [
    { x: 0, y: 0 }, { x: w / 2, y: 0 }, { x: w, y: 0 },
    { x: 0, y: h / 2 }, { x: w / 2, y: h / 2 }, { x: w, y: h / 2 },
    { x: 0, y: h }, { x: w / 2, y: h }, { x: w, y: h },
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
    const gx = Math.round(p.x / grid) * grid;
    const gy = Math.round(p.y / grid) * grid;
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
