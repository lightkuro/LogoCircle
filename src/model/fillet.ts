/**
 * Fillet: round off the corner where two straight outlines cross or meet, with
 * an arc touching both. Lines are cut back to where the arc meets them; other
 * outlines keep their sides (Cut can take the rest away).
 */
import { arcEdge, edgeEnd, edgeStart, type Pt } from '@/geom';
import { guideCenterline } from './guides';
import { uid } from './ids';
import type { Doc, EdgesGuide, Guide, LineGuide } from './types';

interface Segment {
  guide: string;
  a: Pt;
  b: Pt;
}

/** Where two straight outlines cross, and which corner of the crossing (the rays out of it) gets rounded. */
export interface Crossing {
  at: Pt;
  /** The two outlines, each with the far end of its ray (where the arc's touch point can go no further than). */
  rays: [{ guide: string; end: Pt }, { guide: string; end: Pt }];
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Pt): number => Math.hypot(v.x, v.y);

function segments(guides: Guide[]): Segment[] {
  const out: Segment[] = [];
  for (const g of guides) {
    for (const c of guideCenterline(g)) {
      for (const e of c.edges) {
        if (e.c.k !== 'L') continue;
        const a = edgeStart(e);
        const b = edgeEnd(e);
        if (len(sub(b, a)) > 1e-6) out.push({ guide: g.id, a, b });
      }
    }
  }
  return out;
}

function intersect(p: Segment, q: Segment): Pt | null {
  const r = sub(p.b, p.a);
  const s = sub(q.b, q.a);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9 * len(r) * len(s)) return null; // parallel
  const qp = sub(q.a, p.a);
  const t = (qp.x * s.y - qp.y * s.x) / den;
  const u = (qp.x * r.y - qp.y * r.x) / den;
  const e = 1e-6;
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
  return { x: p.a.x + r.x * t, y: p.a.y + r.y * t };
}

/** Of a segment through `x`, the end on the side of `p` (or the only end, where `x` is one of them). */
function rayEnd(s: Segment, x: Pt, p: Pt): Pt {
  const da = len(sub(s.a, x));
  const db = len(sub(s.b, x));
  const tiny = 1e-6 * (da + db);
  if (da < tiny) return s.b;
  if (db < tiny) return s.a;
  const d = sub(s.b, s.a);
  return (p.x - x.x) * d.x + (p.y - x.y) * d.y >= 0 ? s.b : s.a;
}

/**
 * The crossing of two straight outlines near `p` (two different outlines; a
 * polygon's own corners are rounded with its corner rounding). Null when none
 * is that close.
 */
export function crossingAt(guides: Guide[], p: Pt, tol: number): Crossing | null {
  const segs = segments(guides);
  let best: Crossing | null = null;
  let bestD = tol;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!;
      const t = segs[j]!;
      if (s.guide === t.guide) continue;
      const x = intersect(s, t);
      if (!x) continue;
      const d = len(sub(p, x));
      if (d > bestD) continue;
      bestD = d;
      best = {
        at: x,
        rays: [
          { guide: s.guide, end: rayEnd(s, x, p) },
          { guide: t.guide, end: rayEnd(t, x, p) },
        ],
      };
    }
  }
  return best;
}

/** The largest radius that fits: the arc must touch both rays before they end. */
export function maxFillet(c: Crossing): number {
  const [a, b] = c.rays;
  const la = len(sub(a.end, c.at));
  const lb = len(sub(b.end, c.at));
  const ua = { x: (a.end.x - c.at.x) / la, y: (a.end.y - c.at.y) / la };
  const ub = { x: (b.end.x - c.at.x) / lb, y: (b.end.y - c.at.y) / lb };
  const theta = Math.acos(Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y)));
  if (!(theta > 1e-3 && theta < Math.PI - 1e-3)) return 0;
  return Math.min(la, lb) * Math.tan(theta / 2);
}

/** Cut a line back so that the stretch from `at` to `to` (along it) is gone. */
function trimLine(g: LineGuide, at: Pt, to: Pt): LineGuide[] {
  const p0 = { x: g.x0, y: g.y0 };
  const p1 = { x: g.x1, y: g.y1 };
  const d = sub(p1, p0);
  const L = len(d);
  const along = (q: Pt): number => ((q.x - p0.x) * d.x + (q.y - p0.y) * d.y) / (L * L);
  const ta = along(at);
  const tb = along(to);
  const lo = Math.min(ta, tb);
  const hi = Math.max(ta, tb);
  const pt = (t: number): Pt => ({ x: p0.x + d.x * t, y: p0.y + d.y * t });
  const out: LineGuide[] = [];
  const min = 1e-4;
  if (lo > min) out.push({ ...g, ...{ x0: p0.x, y0: p0.y }, x1: pt(lo).x, y1: pt(lo).y });
  if (hi < 1 - min) out.push({ ...g, id: out.length ? uid('g') : g.id, x0: pt(hi).x, y0: pt(hi).y, x1: p1.x, y1: p1.y });
  return out;
}

/** Round the crossing with radius `r`: an arc between the two rays, lines cut back to it. */
export function applyFillet(doc: Doc, c: Crossing, r: number): Doc {
  const rmax = maxFillet(c);
  if (rmax <= 0) return doc;
  r = Math.max(0.5, Math.min(r, rmax));
  const [a, b] = c.rays;
  const ua = sub(a.end, c.at);
  const ub = sub(b.end, c.at);
  const la = len(ua);
  const lb = len(ub);
  ua.x /= la;
  ua.y /= la;
  ub.x /= lb;
  ub.y /= lb;
  const theta = Math.acos(Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y)));
  const t = r / Math.tan(theta / 2);
  const ta = { x: c.at.x + ua.x * t, y: c.at.y + ua.y * t };
  const tb = { x: c.at.x + ub.x * t, y: c.at.y + ub.y * t };
  const bis = { x: ua.x + ub.x, y: ua.y + ub.y };
  const bl = len(bis);
  const k = r / Math.sin(theta / 2) / bl;
  const centre = { x: c.at.x + bis.x * k, y: c.at.y + bis.y * k };
  const a0 = Math.atan2(ta.y - centre.y, ta.x - centre.x);
  let sweep = Math.atan2(tb.y - centre.y, tb.x - centre.x) - a0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  const arc: EdgesGuide = { id: uid('g'), type: 'edges', edges: [arcEdge(centre.x, centre.y, r, a0, a0 + sweep)], closed: false, width: 0 };

  const guides: Guide[] = [];
  for (const g of doc.guides) {
    if (g.type === 'line' && (g.id === a.guide || g.id === b.guide)) {
      guides.push(...trimLine(g, c.at, g.id === a.guide ? ta : tb));
    } else guides.push(g);
  }
  guides.push(arc);
  return { ...doc, guides, updatedAt: Date.now() };
}
