import type { BBox, Carrier, Chain, CubicC, Edge, EllipseC, LineC, Mat, Pt, Ring } from './types';
import { apply, applyVec } from './mat';

export const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export function evalC(c: Carrier, t: number): Pt {
  switch (c.k) {
    case 'L':
      return { x: c.x0 + (c.x1 - c.x0) * t, y: c.y0 + (c.y1 - c.y0) * t };
    case 'E': {
      const cs = Math.cos(t) * c.rx;
      const sn = Math.sin(t) * c.ry;
      const cr = Math.cos(c.rot);
      const sr = Math.sin(c.rot);
      return { x: c.cx + cs * cr - sn * sr, y: c.cy + cs * sr + sn * cr };
    }
    case 'C': {
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const d = 3 * u * t * t;
      const e = t * t * t;
      return {
        x: a * c.x0 + b * c.x1 + d * c.x2 + e * c.x3,
        y: a * c.y0 + b * c.y1 + d * c.y2 + e * c.y3,
      };
    }
  }
}

/** First derivative with respect to the carrier parameter. */
export function derivC(c: Carrier, t: number): Pt {
  switch (c.k) {
    case 'L':
      return { x: c.x1 - c.x0, y: c.y1 - c.y0 };
    case 'E': {
      const cs = Math.cos(t) * c.ry;
      const sn = -Math.sin(t) * c.rx;
      const cr = Math.cos(c.rot);
      const sr = Math.sin(c.rot);
      return { x: sn * cr - cs * sr, y: sn * sr + cs * cr };
    }
    case 'C': {
      const u = 1 - t;
      const a = 3 * u * u;
      const b = 6 * u * t;
      const d = 3 * t * t;
      return {
        x: a * (c.x1 - c.x0) + b * (c.x2 - c.x1) + d * (c.x3 - c.x2),
        y: a * (c.y1 - c.y0) + b * (c.y2 - c.y1) + d * (c.y3 - c.y2),
      };
    }
  }
}

export function edgeStart(e: Edge): Pt {
  return evalC(e.c, e.t0);
}

export function edgeEnd(e: Edge): Pt {
  return evalC(e.c, e.t1);
}

export function reverseEdge(e: Edge): Edge {
  return { c: e.c, t0: e.t1, t1: e.t0 };
}

export function reverseRing(ring: Ring): Ring {
  const out: Edge[] = [];
  for (let i = ring.length - 1; i >= 0; i--) out.push(reverseEdge(ring[i]!));
  return out;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function line(x0: number, y0: number, x1: number, y1: number): LineC {
  return { k: 'L', x0, y0, x1, y1 };
}

export function lineEdge(x0: number, y0: number, x1: number, y1: number): Edge {
  return { c: line(x0, y0, x1, y1), t0: 0, t1: 1 };
}

export function cubic(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
): CubicC {
  return { k: 'C', x0, y0, x1, y1, x2, y2, x3, y3 };
}

export function cubicEdge(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
): Edge {
  return { c: cubic(x0, y0, x1, y1, x2, y2, x3, y3), t0: 0, t1: 1 };
}

/**
 * Canonical ellipse carrier for center + two conjugate half-axis vectors
 * (p(t) = center + u·cos t + v·sin t). Returns the carrier and the parameter
 * map t' = sign·t + shift that takes a parameter in the (u,v) frame to the
 * canonical carrier's parameter.
 *
 * Canonical means: rx ≥ ry > 0, rot ∈ [0, π), and circles have rot = 0. Two
 * routes to the same ellipse therefore produce the same numbers, which is what
 * lets the engine recognise a shape edge and the guide it came from as one
 * curve.
 */
export function ellipseFromAxes(
  cx: number, cy: number, ux: number, uy: number, vx: number, vy: number,
): { c: EllipseC; sign: 1 | -1; shift: number } {
  const uu = ux * ux + uy * uy;
  const vv = vx * vx + vy * vy;
  const uv = ux * vx + uy * vy;
  // Parameter of the major axis.
  let ts = 0.5 * Math.atan2(2 * uv, uu - vv);
  const scaleSq = Math.max(uu, vv);
  const round = Math.abs(uu - vv) <= 1e-12 * scaleSq && Math.abs(uv) <= 1e-12 * scaleSq;
  if (round) ts = 0;
  const cs = Math.cos(ts);
  const sn = Math.sin(ts);
  const px = ux * cs + vx * sn;
  const py = uy * cs + vy * sn;
  const qx = -ux * sn + vx * cs;
  const qy = -uy * sn + vy * cs;
  const rx = Math.hypot(px, py);
  const ry = Math.hypot(qx, qy);
  let rot = Math.atan2(py, px);
  // Orientation: is q on the +normal side of p?
  const sign: 1 | -1 = px * qy - py * qx >= 0 ? 1 : -1;
  // p(t) = p·cos(t - ts) + q·sin(t - ts)  →  canonical t' = sign·(t - ts)
  let shift = -sign * ts;
  if (round || Math.abs(rx - ry) <= 1e-9 * Math.max(rx, ry)) {
    // Circle: fold the rotation into the parameter.
    const r = (rx + ry) / 2;
    shift += rot;
    return { c: { k: 'E', cx, cy, rx: r, ry: r, rot: 0 }, sign, shift };
  }
  // Keep rot in [0, π): turning the frame by π shifts the parameter by π.
  if (rot < 0) {
    rot += Math.PI;
    shift -= Math.PI;
  } else if (rot >= Math.PI) {
    rot -= Math.PI;
    shift += Math.PI;
  }
  if (Math.abs(rot - Math.PI) < 1e-12) {
    rot = 0;
    shift += Math.PI;
  }
  return { c: { k: 'E', cx, cy, rx, ry, rot }, sign, shift };
}

/** A full-turn ellipse edge (clockwise on screen), starting at its local 0 angle. */
export function ellipseEdge(cx: number, cy: number, rx: number, ry: number, rot = 0): Edge {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const { c, sign, shift } = ellipseFromAxes(cx, cy, rx * cr, rx * sr, -ry * sr, ry * cr);
  return { c, t0: shift, t1: shift + sign * TAU };
}

/** Circular arc edge from angle a0 to a1 (radians, unwrapped). */
export function arcEdge(cx: number, cy: number, r: number, a0: number, a1: number): Edge {
  return { c: { k: 'E', cx, cy, rx: r, ry: r, rot: 0 }, t0: a0, t1: a1 };
}

// ---------------------------------------------------------------------------
// Affine transforms
// ---------------------------------------------------------------------------

export function transformEdge(e: Edge, m: Mat): Edge {
  const c = e.c;
  switch (c.k) {
    case 'L': {
      const p0 = apply(m, { x: c.x0, y: c.y0 });
      const p1 = apply(m, { x: c.x1, y: c.y1 });
      return { c: { k: 'L', x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y }, t0: e.t0, t1: e.t1 };
    }
    case 'C': {
      const p0 = apply(m, { x: c.x0, y: c.y0 });
      const p1 = apply(m, { x: c.x1, y: c.y1 });
      const p2 = apply(m, { x: c.x2, y: c.y2 });
      const p3 = apply(m, { x: c.x3, y: c.y3 });
      return {
        c: { k: 'C', x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x3: p3.x, y3: p3.y },
        t0: e.t0,
        t1: e.t1,
      };
    }
    case 'E': {
      const cr = Math.cos(c.rot);
      const sr = Math.sin(c.rot);
      const ctr = apply(m, { x: c.cx, y: c.cy });
      const u = applyVec(m, { x: c.rx * cr, y: c.rx * sr });
      const v = applyVec(m, { x: -c.ry * sr, y: c.ry * cr });
      const r = ellipseFromAxes(ctr.x, ctr.y, u.x, u.y, v.x, v.y);
      return { c: r.c, t0: r.sign * e.t0 + r.shift, t1: r.sign * e.t1 + r.shift };
    }
  }
}

export function transformRing(ring: Ring, m: Mat): Ring {
  return ring.map((e) => transformEdge(e, m));
}

export function transformRings(rings: Ring[], m: Mat): Ring[] {
  return rings.map((r) => transformRing(r, m));
}

export function transformChain(chain: Chain, m: Mat): Chain {
  return { closed: chain.closed, edges: chain.edges.map((e) => transformEdge(e, m)) };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const keyNum = (n: number): string => (Math.round(n * 1e7) / 1e7 || 0).toString();

/** Stable identity of a carrier: equal keys mean "the same curve". */
export function carrierKey(c: Carrier): string {
  switch (c.k) {
    case 'L':
      return `L${keyNum(c.x0)},${keyNum(c.y0)},${keyNum(c.x1)},${keyNum(c.y1)}`;
    case 'E':
      return `E${keyNum(c.cx)},${keyNum(c.cy)},${keyNum(c.rx)},${keyNum(c.ry)},${keyNum(c.rot)}`;
    case 'C':
      return `C${keyNum(c.x0)},${keyNum(c.y0)},${keyNum(c.x1)},${keyNum(c.y1)},${keyNum(c.x2)},${keyNum(c.y2)},${keyNum(c.x3)},${keyNum(c.y3)}`;
  }
}

// ---------------------------------------------------------------------------
// Cubic helpers
// ---------------------------------------------------------------------------

/** The stretch of a cubic between two parameters, as its own cubic (t0 > t1 reverses). */
export function subCubic(c: CubicC, t0: number, t1: number): CubicC {
  // Blossoming: control points are the blossom evaluated at (t0,t0,t0), (t0,t0,t1), ...
  const bl = (a: number, b: number, d: number, p0: number, p1: number, p2: number, p3: number): number => {
    const l = (s: number, q0: number, q1: number) => q0 + (q1 - q0) * s;
    const a0 = l(a, p0, p1);
    const a1 = l(a, p1, p2);
    const a2 = l(a, p2, p3);
    const b0 = l(b, a0, a1);
    const b1 = l(b, a1, a2);
    return l(d, b0, b1);
  };
  return {
    k: 'C',
    x0: bl(t0, t0, t0, c.x0, c.x1, c.x2, c.x3),
    y0: bl(t0, t0, t0, c.y0, c.y1, c.y2, c.y3),
    x1: bl(t0, t0, t1, c.x0, c.x1, c.x2, c.x3),
    y1: bl(t0, t0, t1, c.y0, c.y1, c.y2, c.y3),
    x2: bl(t0, t1, t1, c.x0, c.x1, c.x2, c.x3),
    y2: bl(t0, t1, t1, c.y0, c.y1, c.y2, c.y3),
    x3: bl(t1, t1, t1, c.x0, c.x1, c.x2, c.x3),
    y3: bl(t1, t1, t1, c.y0, c.y1, c.y2, c.y3),
  };
}

// ---------------------------------------------------------------------------
// Flattening (display, hit-testing, bounding boxes — NOT the engine's noding)
// ---------------------------------------------------------------------------

/** Number of straight pieces needed to stay within `tol` of the edge. */
export function edgeSegments(e: Edge, tol: number): number {
  const c = e.c;
  switch (c.k) {
    case 'L':
      return 1;
    case 'E': {
      const r = Math.max(c.rx, c.ry);
      if (r <= tol) return Math.max(2, Math.ceil(Math.abs(e.t1 - e.t0) / (Math.PI / 4)));
      const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)));
      return Math.max(2, Math.ceil(Math.abs(e.t1 - e.t0) / step));
    }
    case 'C': {
      // Second-difference bound on the deviation of a cubic from its chord.
      const ddx = Math.max(Math.abs(c.x0 - 2 * c.x1 + c.x2), Math.abs(c.x1 - 2 * c.x2 + c.x3));
      const ddy = Math.max(Math.abs(c.y0 - 2 * c.y1 + c.y2), Math.abs(c.y1 - 2 * c.y2 + c.y3));
      const dd = Math.hypot(ddx, ddy);
      const span = Math.abs(e.t1 - e.t0);
      return Math.max(1, Math.ceil(span * Math.sqrt((0.75 * dd) / tol)));
    }
  }
}

/** Points along an edge, including both ends. */
export function flattenEdge(e: Edge, tol = 0.25, out: Pt[] = [], skipFirst = false): Pt[] {
  const n = edgeSegments(e, tol);
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    out.push(evalC(e.c, e.t0 + ((e.t1 - e.t0) * i) / n));
  }
  return out;
}

/** A ring as a closed polygon (last point not repeated). */
export function flattenRing(ring: Ring, tol = 0.25): Pt[] {
  const out: Pt[] = [];
  for (const e of ring) {
    const n = edgeSegments(e, tol);
    for (let i = 0; i < n; i++) out.push(evalC(e.c, e.t0 + ((e.t1 - e.t0) * i) / n));
  }
  return out;
}

export function flattenChain(chain: Chain, tol = 0.25): Pt[] {
  if (chain.closed) return flattenRing(chain.edges, tol);
  const out: Pt[] = [];
  chain.edges.forEach((e, i) => flattenEdge(e, tol, out, i > 0));
  return out;
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j]!.x + pts[i]!.x) * (pts[i]!.y - pts[j]!.y);
  }
  return a / 2;
}

/** Signed area of a ring (positive = clockwise on screen, i.e. y-down counter-math). */
export function ringArea(ring: Ring, tol = 0.1): number {
  return polygonArea(flattenRing(ring, tol));
}

export function emptyBBox(): BBox {
  return { x: Infinity, y: Infinity, w: -Infinity, h: -Infinity };
}

export function bboxOfPoints(pts: Pt[]): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionBBox(a: BBox, b: BBox): BBox {
  if (!isFinite(a.x)) return b;
  if (!isFinite(b.x)) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function edgesBBox(edges: Edge[]): BBox {
  const pts: Pt[] = [];
  // Fine enough that aligning to an edge lands within a hundredth of a unit.
  for (const e of edges) flattenEdge(e, 0.01, pts);
  return bboxOfPoints(pts);
}

export function ringsBBox(rings: Ring[]): BBox {
  let b = emptyBBox();
  for (const r of rings) b = unionBBox(b, edgesBBox(r));
  return b;
}

/** Nonzero winding number of a point against a closed polygon. */
export function windingOfPolygon(p: Pt, poly: Pt[]): number {
  let w = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    if (a.y <= p.y) {
      if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) w++;
    } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) w--;
  }
  return w;
}

export function pointInRings(p: Pt, rings: Ring[], tol = 0.25): boolean {
  let w = 0;
  for (const r of rings) w += windingOfPolygon(p, flattenRing(r, tol));
  return w !== 0;
}

/** Distance from a point to a segment. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: Pt, pts: Pt[], closed: boolean): number {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i + 1 < n; i++) best = Math.min(best, distToSegment(p, pts[i]!, pts[i + 1]!));
  if (closed && n > 1) best = Math.min(best, distToSegment(p, pts[n - 1]!, pts[0]!));
  if (n === 1) best = Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  return best;
}
