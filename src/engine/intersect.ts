/**
 * Carrier–carrier intersections.
 *
 * Lines, line–ellipse and circle–circle are solved in closed form so that
 * tangency ("just touching") is detected exactly as a single contact. All other
 * pairs are found numerically: coarse polylines give candidates, a damped
 * Newton iteration on the true curves refines them.
 */
import type { Carrier, CubicC, EllipseC, LineC, Pt } from '@/geom';
import { derivC, evalC, TAU } from '@/geom';

/** A common point of two carriers, as a parameter on each. */
export interface Hit {
  ta: number;
  tb: number;
}

/** Two points closer than this (document units) are the same point. */
const TOUCH = 1e-7;

export function intersectCarriers(a: Carrier, b: Carrier): Hit[] {
  if (a.k === 'L' && b.k === 'L') return lineLine(a, b);
  if (a.k === 'L' && b.k === 'E') return lineEllipse(a, b);
  if (a.k === 'E' && b.k === 'L') return lineEllipse(b, a).map((h) => ({ ta: h.tb, tb: h.ta }));
  if (a.k === 'E' && b.k === 'E' && isCircle(a) && isCircle(b)) return circleCircle(a, b);
  return numeric(a, b);
}

function isCircle(e: EllipseC): boolean {
  return Math.abs(e.rx - e.ry) <= 1e-9 * Math.max(e.rx, e.ry);
}

// ---------------------------------------------------------------------------
// line × line
// ---------------------------------------------------------------------------

function lineLine(a: LineC, b: LineC): Hit[] {
  const d1x = a.x1 - a.x0;
  const d1y = a.y1 - a.y0;
  const d2x = b.x1 - b.x0;
  const d2y = b.y1 - b.y0;
  const l1 = Math.hypot(d1x, d1y);
  const l2 = Math.hypot(d2x, d2y);
  if (l1 < 1e-12 || l2 < 1e-12) return [];
  const wx = b.x0 - a.x0;
  const wy = b.y0 - a.y0;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) > 1e-12 * l1 * l2) {
    const t = (wx * d2y - wy * d2x) / denom;
    const u = (wx * d1y - wy * d1x) / denom;
    const et = TOUCH / l1;
    const eu = TOUCH / l2;
    if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return [];
    return [{ ta: clamp01(t), tb: clamp01(u) }];
  }
  // Parallel. Collinear overlap → each endpoint that lies on the other line is a shared point.
  const dist = Math.abs(wx * d1y - wy * d1x) / l1;
  if (dist > TOUCH) return [];
  const hits: Hit[] = [];
  const onA = (x: number, y: number): number => ((x - a.x0) * d1x + (y - a.y0) * d1y) / (l1 * l1);
  const onB = (x: number, y: number): number => ((x - b.x0) * d2x + (y - b.y0) * d2y) / (l2 * l2);
  const et = TOUCH / l1;
  const eu = TOUCH / l2;
  const tb0 = onA(b.x0, b.y0);
  const tb1 = onA(b.x1, b.y1);
  if (tb0 >= -et && tb0 <= 1 + et) hits.push({ ta: clamp01(tb0), tb: 0 });
  if (tb1 >= -et && tb1 <= 1 + et) hits.push({ ta: clamp01(tb1), tb: 1 });
  const ta0 = onB(a.x0, a.y0);
  const ta1 = onB(a.x1, a.y1);
  if (ta0 >= -eu && ta0 <= 1 + eu) hits.push({ ta: 0, tb: clamp01(ta0) });
  if (ta1 >= -eu && ta1 <= 1 + eu) hits.push({ ta: 1, tb: clamp01(ta1) });
  return hits;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// ---------------------------------------------------------------------------
// line × ellipse
// ---------------------------------------------------------------------------

function lineEllipse(l: LineC, e: EllipseC): Hit[] {
  if (e.rx < 1e-12 || e.ry < 1e-12) return [];
  const cr = Math.cos(e.rot);
  const sr = Math.sin(e.rot);
  // Into the ellipse's unit-circle frame.
  const tx = (x: number, y: number): Pt => {
    const dx = x - e.cx;
    const dy = y - e.cy;
    return { x: (dx * cr + dy * sr) / e.rx, y: (-dx * sr + dy * cr) / e.ry };
  };
  const q0 = tx(l.x0, l.y0);
  const q1 = tx(l.x1, l.y1);
  const dx = q1.x - q0.x;
  const dy = q1.y - q0.y;
  const A = dx * dx + dy * dy;
  if (A < 1e-24) return [];
  const B = 2 * (q0.x * dx + q0.y * dy);
  const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
  const et = TOUCH / Math.max(len, 1e-12);
  // Distance of the infinite line from the centre, in the unit frame.
  const d0 = Math.abs(q0.x * dy - q0.y * dx) / Math.sqrt(A);
  const rmin = Math.min(e.rx, e.ry);
  const ts: number[] = [];
  if (Math.abs(1 - d0) * rmin < TOUCH) {
    ts.push(-B / (2 * A));
  } else if (d0 < 1) {
    const C = q0.x * q0.x + q0.y * q0.y - 1;
    const disc = Math.sqrt(Math.max(0, B * B - 4 * A * C));
    // Numerically stable quadratic roots.
    const q = -0.5 * (B + (B >= 0 ? disc : -disc));
    const r1 = q / A;
    const r2 = Math.abs(q) > 1e-300 ? C / q : r1;
    ts.push(Math.min(r1, r2), Math.max(r1, r2));
  }
  const hits: Hit[] = [];
  for (const t of ts) {
    if (t < -et || t > 1 + et) continue;
    const tc = clamp01(t);
    const px = q0.x + dx * tc;
    const py = q0.y + dy * tc;
    hits.push({ ta: tc, tb: Math.atan2(py, px) });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// circle × circle
// ---------------------------------------------------------------------------

function circleCircle(a: EllipseC, b: EllipseC): Hit[] {
  const r1 = (a.rx + a.ry) / 2;
  const r2 = (b.rx + b.ry) / 2;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-12) return [];
  const ux = dx / d;
  const uy = dy / d;
  const param = (c: EllipseC, x: number, y: number): number => Math.atan2(y - c.cy, x - c.cx) - c.rot;
  const outer = d - (r1 + r2);
  const inner = Math.abs(r1 - r2) - d;
  if (outer > TOUCH || inner > TOUCH) return [];
  const along = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  if (Math.abs(outer) <= TOUCH || Math.abs(inner) <= TOUCH) {
    const x = a.cx + along * ux;
    const y = a.cy + along * uy;
    return [{ ta: param(a, x, y), tb: param(b, x, y) }];
  }
  const h = Math.sqrt(Math.max(0, r1 * r1 - along * along));
  const mx = a.cx + along * ux;
  const my = a.cy + along * uy;
  const x1 = mx - h * uy;
  const y1 = my + h * ux;
  const x2 = mx + h * uy;
  const y2 = my - h * ux;
  return [
    { ta: param(a, x1, y1), tb: param(b, x1, y1) },
    { ta: param(a, x2, y2), tb: param(b, x2, y2) },
  ];
}

// ---------------------------------------------------------------------------
// everything else: coarse candidates + Newton
// ---------------------------------------------------------------------------

interface Coarse {
  t: number[];
  p: Pt[];
  /** Upper bound on how far the true curve strays from the polyline. */
  slack: number;
  periodic: boolean;
  speed: number;
}

function coarse(c: Carrier): Coarse {
  if (c.k === 'L') {
    return {
      t: [0, 1],
      p: [evalC(c, 0), evalC(c, 1)],
      slack: 0,
      periodic: false,
      speed: Math.hypot(c.x1 - c.x0, c.y1 - c.y0),
    };
  }
  if (c.k === 'E') {
    const n = 72;
    const r = Math.max(c.rx, c.ry);
    const t: number[] = [];
    const p: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      t.push((TAU * i) / n);
      p.push(evalC(c, (TAU * i) / n));
    }
    return { t, p, slack: r * (1 - Math.cos(Math.PI / n)), periodic: true, speed: r };
  }
  const n = 16;
  const dd = cubicSecondDiff(c);
  const t: number[] = [];
  const p: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    t.push(i / n);
    p.push(evalC(c, i / n));
  }
  return { t, p, slack: (0.75 * dd) / (n * n), periodic: false, speed: cubicSpeed(c) };
}

export function cubicSecondDiff(c: CubicC): number {
  const ddx = Math.max(Math.abs(c.x0 - 2 * c.x1 + c.x2), Math.abs(c.x1 - 2 * c.x2 + c.x3));
  const ddy = Math.max(Math.abs(c.y0 - 2 * c.y1 + c.y2), Math.abs(c.y1 - 2 * c.y2 + c.y3));
  return Math.hypot(ddx, ddy);
}

/** Upper bound of |dP/dt| on a cubic. */
export function cubicSpeed(c: CubicC): number {
  return (
    3 *
    Math.max(
      Math.hypot(c.x1 - c.x0, c.y1 - c.y0),
      Math.hypot(c.x2 - c.x1, c.y2 - c.y1),
      Math.hypot(c.x3 - c.x2, c.y3 - c.y2),
      1e-12,
    )
  );
}

/** Closest approach of two segments: distance and the fraction along each. */
function segSeg(p1: Pt, p2: Pt, q1: Pt, q2: Pt): { d: number; s: number; u: number } {
  const ux = p2.x - p1.x;
  const uy = p2.y - p1.y;
  const vx = q2.x - q1.x;
  const vy = q2.y - q1.y;
  const wx = p1.x - q1.x;
  const wy = p1.y - q1.y;
  const a = ux * ux + uy * uy;
  const b = ux * vx + uy * vy;
  const c = vx * vx + vy * vy;
  const d = ux * wx + uy * wy;
  const e = vx * wx + vy * wy;
  const D = a * c - b * b;
  let sN: number;
  let sD = D;
  let tN: number;
  let tD = D;
  if (D < 1e-18 * Math.max(a * c, 1e-300)) {
    sN = 0;
    sD = 1;
    tN = e;
    tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0) {
      sN = 0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }
  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0;
    else if (-d > a) sN = sD;
    else {
      sN = -d;
      sD = a;
    }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0) sN = 0;
    else if (-d + b > a) sN = sD;
    else {
      sN = -d + b;
      sD = a;
    }
  }
  const s = Math.abs(sN) < 1e-300 || sD === 0 ? 0 : sN / sD;
  const u = Math.abs(tN) < 1e-300 || tD === 0 ? 0 : tN / tD;
  const ex = wx + s * ux - u * vx;
  const ey = wy + s * uy - u * vy;
  return { d: Math.hypot(ex, ey), s, u };
}

/** Damped Newton on F(ta, tb) = A(ta) − B(tb). */
function refine(a: Carrier, b: Carrier, ta: number, tb: number): { ta: number; tb: number; err: number } {
  const maxA = a.k === 'E' ? Math.PI / 6 : 0.25;
  const maxB = b.k === 'E' ? Math.PI / 6 : 0.25;
  let err = Infinity;
  for (let it = 0; it < 48; it++) {
    const pa = evalC(a, ta);
    const pb = evalC(b, tb);
    const fx = pa.x - pb.x;
    const fy = pa.y - pb.y;
    err = Math.hypot(fx, fy);
    if (err < 1e-12) break;
    const da = derivC(a, ta);
    const db = derivC(b, tb);
    const j11 = da.x;
    const j12 = -db.x;
    const j21 = da.y;
    const j22 = -db.y;
    const det = j11 * j22 - j12 * j21;
    const na = Math.hypot(da.x, da.y);
    const nb = Math.hypot(db.x, db.y);
    let sa: number;
    let sb: number;
    if (Math.abs(det) > 1e-7 * na * nb) {
      sa = (-fx * j22 + fy * j12) / det;
      sb = (-j11 * fy + j21 * fx) / det;
    } else {
      // (Nearly) tangent: Levenberg–Marquardt step toward the closest approach.
      const lam = 1e-9 * (na * na + nb * nb) + 1e-30;
      const m11 = j11 * j11 + j21 * j21 + lam;
      const m12 = j11 * j12 + j21 * j22;
      const m22 = j12 * j12 + j22 * j22 + lam;
      const g1 = j11 * fx + j21 * fy;
      const g2 = j12 * fx + j22 * fy;
      const dm = m11 * m22 - m12 * m12;
      if (Math.abs(dm) < 1e-300) break;
      sa = (-g1 * m22 + g2 * m12) / dm;
      sb = (-m11 * g2 + m12 * g1) / dm;
    }
    if (sa > maxA) sa = maxA;
    else if (sa < -maxA) sa = -maxA;
    if (sb > maxB) sb = maxB;
    else if (sb < -maxB) sb = -maxB;
    ta += sa;
    tb += sb;
    if (Math.abs(sa) * na + Math.abs(sb) * nb < 1e-13) {
      const qa = evalC(a, ta);
      const qb = evalC(b, tb);
      err = Math.hypot(qa.x - qb.x, qa.y - qb.y);
      break;
    }
  }
  return { ta, tb, err };
}

function numeric(a: Carrier, b: Carrier): Hit[] {
  const ca = coarse(a);
  const cb = coarse(b);
  const reach = ca.slack + cb.slack + 1e-6;
  const hits: Hit[] = [];
  const na = ca.p.length - 1;
  const nb = cb.p.length - 1;
  // Bounding boxes of B's coarse pieces, reused for every piece of A.
  const bx0 = new Float64Array(nb);
  const bx1 = new Float64Array(nb);
  const by0 = new Float64Array(nb);
  const by1 = new Float64Array(nb);
  for (let j = 0; j < nb; j++) {
    const p = cb.p[j]!;
    const q = cb.p[j + 1]!;
    bx0[j] = Math.min(p.x, q.x) - reach;
    bx1[j] = Math.max(p.x, q.x) + reach;
    by0[j] = Math.min(p.y, q.y) - reach;
    by1[j] = Math.max(p.y, q.y) + reach;
  }
  const pDist = (c: Coarse, x: number, y: number): number => {
    let d = Math.abs(x - y);
    if (c.periodic) {
      d %= TAU;
      if (d > Math.PI) d = TAU - d;
    }
    return d * c.speed;
  };
  const add = (ta: number, tb: number): void => {
    for (const h of hits) {
      if (pDist(ca, h.ta, ta) < 1e-6 && pDist(cb, h.tb, tb) < 1e-6) return;
    }
    hits.push({ ta, tb });
  };
  let budget = 600;
  for (let i = 0; i < na && budget > 0; i++) {
    const p1 = ca.p[i]!;
    const p2 = ca.p[i + 1]!;
    const ax0 = Math.min(p1.x, p2.x);
    const ax1 = Math.max(p1.x, p2.x);
    const ay0 = Math.min(p1.y, p2.y);
    const ay1 = Math.max(p1.y, p2.y);
    for (let j = 0; j < nb && budget > 0; j++) {
      if (ax1 < bx0[j]! || ax0 > bx1[j]! || ay1 < by0[j]! || ay0 > by1[j]!) continue;
      const q1 = cb.p[j]!;
      const q2 = cb.p[j + 1]!;
      const near = segSeg(p1, p2, q1, q2);
      if (near.d > reach) continue;
      budget--;
      const a0 = ca.t[i]!;
      const a1 = ca.t[i + 1]!;
      const b0 = cb.t[j]!;
      const b1 = cb.t[j + 1]!;
      const seeds: [number, number][] = [
        [a0 + (a1 - a0) * near.s, b0 + (b1 - b0) * near.u],
        [a0, b0],
        [a1, b1],
        [a0, b1],
        [a1, b0],
      ];
      for (const [sa, sb] of seeds) {
        const r = refine(a, b, sa, sb);
        if (!(r.err < TOUCH)) continue;
        let ta = r.ta;
        let tb = r.tb;
        if (!ca.periodic) {
          if (ta < -TOUCH / ca.speed || ta > 1 + TOUCH / ca.speed) continue;
          ta = clamp01(ta);
        }
        if (!cb.periodic) {
          if (tb < -TOUCH / cb.speed || tb > 1 + TOUCH / cb.speed) continue;
          tb = clamp01(tb);
        }
        add(ta, tb);
      }
    }
  }
  return hits;
}
