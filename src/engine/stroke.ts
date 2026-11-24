/**
 * Thick strokes: the outline of a chain drawn with a round pen.
 *
 * Every edge becomes a "sausage" (its two offset curves joined by round caps).
 * The union of the sausages — computed by the region engine — is the stroke
 * with round caps and round joins. Lines and circular arcs offset exactly;
 * other curves are offset by fitted cubics.
 */
import type { Chain, CubicC, Edge, EllipseC, Pt, Ring } from '@/geom';
import { arcEdge, capsuleChain, derivC, evalC, subCubic } from '@/geom';

/** How far a fitted offset curve may stray from the true offset (document units). */
const OFFSET_TOL = 0.05;

export function strokeChain(chain: Chain, width: number, unite: (parts: Ring[][]) => Ring[]): Chain[] {
  if (!(width > 0) || chain.edges.length === 0) return [];
  const r = width / 2;
  const edges = chain.edges.filter((e) => Math.abs(e.t1 - e.t0) > 1e-12);
  if (edges.length === 0) return [];
  if (edges.length === 1 && edges[0]!.c.k === 'L') {
    const a = evalC(edges[0]!.c, edges[0]!.t0);
    const b = evalC(edges[0]!.c, edges[0]!.t1);
    return [capsuleChain(a.x, a.y, b.x, b.y, width)];
  }
  const parts: Ring[][] = [];
  for (const e of edges) {
    const c = e.c;
    if (c.k === 'L') {
      const a = evalC(c, e.t0);
      const b = evalC(c, e.t1);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) continue;
      parts.push([capsuleChain(a.x, a.y, b.x, b.y, width).edges]);
    } else if (c.k === 'E' && Math.abs(c.rx - c.ry) <= 1e-9 * Math.max(c.rx, c.ry)) {
      parts.push(...arcParts(c, e.t0, e.t1, r));
    } else if (c.k === 'E') {
      for (const cub of ellipseToCubics(c, e.t0, e.t1)) parts.push([cubicSausage(cub, r)]);
    } else {
      parts.push([cubicSausage(e.t0 === 0 && e.t1 === 1 ? c : subCubic(c, e.t0, e.t1), r)]);
    }
  }
  if (parts.length === 0) return [];
  return unite(parts).map((ring) => ({ edges: ring, closed: true }));
}

// ---------------------------------------------------------------------------
// circular arcs — exact
// ---------------------------------------------------------------------------

function arcParts(c: EllipseC, t0: number, t1: number, r: number): Ring[][] {
  const R = (c.rx + c.ry) / 2;
  const a0 = t0 + c.rot;
  const a1 = t1 + c.rot;
  const sweep = a1 - a0;
  const s = sweep >= 0 ? 1 : -1;
  const full = Math.abs(sweep) >= Math.PI * 2 - 1e-9;
  const P = (a: number): Pt => ({ x: c.cx + R * Math.cos(a), y: c.cy + R * Math.sin(a) });
  if (R - r > 1e-6) {
    if (full) {
      return [[[arcEdge(c.cx, c.cy, R + r, a0, a0 + Math.PI * 2)], [arcEdge(c.cx, c.cy, R - r, a0 + Math.PI * 2, a0)]]];
    }
    // Direction of travel at an angle: the radius turned a quarter in the sweep direction.
    const tangentAngle = (a: number): number => a + (s * Math.PI) / 2;
    const p0 = P(a0);
    const p1 = P(a1);
    const ring: Edge[] = [
      arcEdge(c.cx, c.cy, R + s * r, a0, a1),
      arcEdge(p1.x, p1.y, r, tangentAngle(a1) - Math.PI / 2, tangentAngle(a1) + Math.PI / 2),
      arcEdge(c.cx, c.cy, R - s * r, a1, a0),
      arcEdge(p0.x, p0.y, r, tangentAngle(a0) + Math.PI / 2, tangentAngle(a0) + (3 * Math.PI) / 2),
    ];
    return [[ring]];
  }
  // Pen wider than the arc's radius: the inside closes up into a wedge.
  if (full) return [[[arcEdge(c.cx, c.cy, R + r, a0, a0 + Math.PI * 2)]]];
  const o0 = { x: c.cx + (R + r) * Math.cos(a0), y: c.cy + (R + r) * Math.sin(a0) };
  const o1 = { x: c.cx + (R + r) * Math.cos(a1), y: c.cy + (R + r) * Math.sin(a1) };
  const wedge: Edge[] = [
    { c: { k: 'L', x0: c.cx, y0: c.cy, x1: o0.x, y1: o0.y }, t0: 0, t1: 1 },
    arcEdge(c.cx, c.cy, R + r, a0, a1),
    { c: { k: 'L', x0: o1.x, y0: o1.y, x1: c.cx, y1: c.cy }, t0: 0, t1: 1 },
  ];
  const p0 = P(a0);
  const p1 = P(a1);
  return [
    [wedge],
    [[arcEdge(p0.x, p0.y, r, 0, Math.PI * 2)]],
    [[arcEdge(p1.x, p1.y, r, 0, Math.PI * 2)]],
  ];
}

// ---------------------------------------------------------------------------
// ellipse arcs → cubics
// ---------------------------------------------------------------------------

function ellipseToCubics(c: EllipseC, t0: number, t1: number): CubicC[] {
  const sweep = t1 - t0;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 4) - 1e-9));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: CubicC[] = [];
  for (let i = 0; i < n; i++) {
    const a = t0 + i * step;
    const b = a + step;
    const p0 = evalC(c, a);
    const p3 = evalC(c, b);
    const d0 = derivC(c, a);
    const d3 = derivC(c, b);
    out.push({
      k: 'C',
      x0: p0.x,
      y0: p0.y,
      x1: p0.x + k * d0.x,
      y1: p0.y + k * d0.y,
      x2: p3.x - k * d3.x,
      y2: p3.y - k * d3.y,
      x3: p3.x,
      y3: p3.y,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// cubics — fitted offsets
// ---------------------------------------------------------------------------

function unit(x: number, y: number): Pt | null {
  const l = Math.hypot(x, y);
  return l > 1e-12 ? { x: x / l, y: y / l } : null;
}

function startTangent(c: CubicC): Pt {
  return (
    unit(c.x1 - c.x0, c.y1 - c.y0) ??
    unit(c.x2 - c.x0, c.y2 - c.y0) ??
    unit(c.x3 - c.x0, c.y3 - c.y0) ?? { x: 1, y: 0 }
  );
}

function endTangent(c: CubicC): Pt {
  return (
    unit(c.x3 - c.x2, c.y3 - c.y2) ??
    unit(c.x3 - c.x1, c.y3 - c.y1) ??
    unit(c.x3 - c.x0, c.y3 - c.y0) ?? { x: 1, y: 0 }
  );
}

/** Cubic pieces approximating the curve offset by `d` to the left of travel. */
function offsetCubic(c: CubicC, d: number, depth = 0, out: CubicC[] = []): CubicC[] {
  const t0 = startTangent(c);
  const t1 = endTangent(c);
  const q0 = { x: c.x0 - t0.y * d, y: c.y0 + t0.x * d };
  const q3 = { x: c.x3 - t1.y * d, y: c.y3 + t1.x * d };
  const chord = Math.hypot(c.x3 - c.x0, c.y3 - c.y0);
  const qChord = Math.hypot(q3.x - q0.x, q3.y - q0.y);
  // Handle lengths: keep the end tangents, and make the middle of the fitted
  // curve land on the true offset of the source's middle.
  const k = chord > 1e-9 ? qChord / chord : 1;
  let alpha = Math.hypot(c.x1 - c.x0, c.y1 - c.y0) * k;
  let beta = Math.hypot(c.x3 - c.x2, c.y3 - c.y2) * k;
  const cross = t0.x * t1.y - t0.y * t1.x;
  if (Math.abs(cross) > 0.02) {
    const m = evalC(c, 0.5);
    const dm = derivC(c, 0.5);
    const tm = unit(dm.x, dm.y);
    if (tm) {
      const rx = (m.x - tm.y * d - (q0.x + q3.x) / 2) * (8 / 3);
      const ry = (m.y + tm.x * d - (q0.y + q3.y) / 2) * (8 / 3);
      // alpha·t0 − beta·t1 = (rx, ry)
      const a = (-rx * t1.y + t1.x * ry) / -cross;
      const b = (t0.x * ry - t0.y * rx) / -cross;
      if (a > 0 && b > 0 && a < 2 * qChord + 1e-9 && b < 2 * qChord + 1e-9) {
        alpha = a;
        beta = b;
      }
    }
  }
  const fit: CubicC = {
    k: 'C',
    x0: q0.x,
    y0: q0.y,
    x1: q0.x + t0.x * alpha,
    y1: q0.y + t0.y * alpha,
    x2: q3.x - t1.x * beta,
    y2: q3.y - t1.y * beta,
    x3: q3.x,
    y3: q3.y,
  };
  let err = 0;
  if (depth < 5) {
    for (const t of [0.25, 0.5, 0.75]) {
      const q = evalC(fit, t);
      // Distance from the fitted point to the source curve should be |d|.
      let u = t;
      for (let it = 0; it < 4; it++) {
        const p = evalC(c, u);
        const dv = derivC(c, u);
        const den = dv.x * dv.x + dv.y * dv.y;
        if (den < 1e-18) break;
        u = Math.max(0, Math.min(1, u + ((q.x - p.x) * dv.x + (q.y - p.y) * dv.y) / den));
      }
      const p = evalC(c, u);
      err = Math.max(err, Math.abs(Math.hypot(q.x - p.x, q.y - p.y) - Math.abs(d)));
    }
  }
  if (err > OFFSET_TOL) {
    offsetCubic(subCubic(c, 0, 0.5), d, depth + 1, out);
    offsetCubic(subCubic(c, 0.5, 1), d, depth + 1, out);
  } else {
    out.push(fit);
  }
  return out;
}

function cubicSausage(c: CubicC, r: number): Ring {
  const right = offsetCubic(c, -r);
  const left = offsetCubic(c, r);
  const t0 = startTangent(c);
  const t1 = endTangent(c);
  const a0 = Math.atan2(t0.y, t0.x);
  const a1 = Math.atan2(t1.y, t1.x);
  const ring: Edge[] = [];
  for (const p of right) ring.push({ c: p, t0: 0, t1: 1 });
  ring.push(arcEdge(c.x3, c.y3, r, a1 - Math.PI / 2, a1 + Math.PI / 2));
  for (let i = left.length - 1; i >= 0; i--) ring.push({ c: left[i]!, t0: 1, t1: 0 });
  ring.push(arcEdge(c.x0, c.y0, r, a0 + Math.PI / 2, a0 + (3 * Math.PI) / 2));
  return ring;
}
