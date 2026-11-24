import type { Chain, Edge, Pt } from './types';
import { arcEdge, cubicEdge, ellipseEdge, lineEdge } from './carrier';

/** Closed polygon through the given points. */
export function polygonChain(pts: Pt[]): Chain {
  const edges: Edge[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    if (a.x === b.x && a.y === b.y) continue;
    edges.push(lineEdge(a.x, a.y, b.x, b.y));
  }
  return { edges, closed: true };
}

export function ellipseChain(cx: number, cy: number, rx: number, ry: number, rot = 0): Chain {
  return { edges: [ellipseEdge(cx, cy, rx, ry, rot)], closed: true };
}

/** Rectangle centred on (cx, cy), optionally rotated and with rounded corners. */
export function rectChain(cx: number, cy: number, w: number, h: number, rot = 0, radius = 0): Chain {
  const hw = w / 2;
  const hh = h / 2;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const P = (x: number, y: number): Pt => ({ x: cx + x * cr - y * sr, y: cy + x * sr + y * cr });
  const r = Math.max(0, Math.min(radius, hw, hh));
  if (r < 1e-6) return polygonChain([P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)]);
  const edges: Edge[] = [];
  // Clockwise on screen, starting on the top edge. Corner arcs are circles, so
  // the rectangle's rotation simply offsets their angles.
  const corners: [number, number, number][] = [
    [hw - r, -hh + r, -Math.PI / 2],
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
  ];
  const sides: [Pt, Pt][] = [
    [P(-hw + r, -hh), P(hw - r, -hh)],
    [P(hw, -hh + r), P(hw, hh - r)],
    [P(hw - r, hh), P(-hw + r, hh)],
    [P(-hw, hh - r), P(-hw, -hh + r)],
  ];
  for (let i = 0; i < 4; i++) {
    const [a, b] = sides[i]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-9) edges.push(lineEdge(a.x, a.y, b.x, b.y));
    const [ox, oy, a0] = corners[i]!;
    const c = P(ox, oy);
    edges.push(arcEdge(c.x, c.y, r, a0 + rot, a0 + rot + Math.PI / 2));
  }
  return { edges, closed: true };
}

export function lineChain(x0: number, y0: number, x1: number, y1: number): Chain {
  return { edges: [lineEdge(x0, y0, x1, y1)], closed: false };
}

/** The outline of a thick line with round caps (a "stadium"). */
export function capsuleChain(x0: number, y0: number, x1: number, y1: number, width: number): Chain {
  const r = width / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return ellipseChain(x0, y0, r, r);
  const a = Math.atan2(dy, dx);
  const nx = (-dy / len) * r;
  const ny = (dx / len) * r;
  return {
    closed: true,
    edges: [
      lineEdge(x0 - nx, y0 - ny, x1 - nx, y1 - ny),
      arcEdge(x1, y1, r, a - Math.PI / 2, a + Math.PI / 2),
      lineEdge(x1 + nx, y1 + ny, x0 + nx, y0 + ny),
      arcEdge(x0, y0, r, a + Math.PI / 2, a + (3 * Math.PI) / 2),
    ],
  };
}

/**
 * A smooth curve through the given points (Catmull-Rom, converted to cubic
 * beziers). Handles are shortened on uneven spacing so the curve never loops
 * back on itself between two points.
 */
export function splineChain(pts: Pt[], closed: boolean): Chain {
  const n = pts.length;
  if (n < 2) return { edges: [], closed: false };
  if (n === 2) return { edges: [lineEdge(pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y)], closed: false };
  const at = (i: number): Pt => {
    if (closed) return pts[((i % n) + n) % n]!;
    return pts[Math.max(0, Math.min(n - 1, i))]!;
  };
  const edges: Edge[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (d < 1e-9) continue;
    let t1x = (p2.x - p0.x) / 6;
    let t1y = (p2.y - p0.y) / 6;
    let t2x = (p3.x - p1.x) / 6;
    let t2y = (p3.y - p1.y) / 6;
    const cap = d * 0.45;
    const l1 = Math.hypot(t1x, t1y);
    const l2 = Math.hypot(t2x, t2y);
    if (l1 > cap) {
      t1x *= cap / l1;
      t1y *= cap / l1;
    }
    if (l2 > cap) {
      t2x *= cap / l2;
      t2y *= cap / l2;
    }
    edges.push(cubicEdge(p1.x, p1.y, p1.x + t1x, p1.y + t1y, p2.x - t2x, p2.y - t2y, p2.x, p2.y));
  }
  return { edges, closed };
}

/** Regular polygon or star, as points. `inner` < 1 makes a star with that inner radius ratio. */
export function regularPoints(cx: number, cy: number, r: number, sides: number, rot = 0, inner = 1): Pt[] {
  const pts: Pt[] = [];
  const star = inner < 1;
  const count = star ? sides * 2 : sides;
  for (let i = 0; i < count; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI * 2) / count;
    const rr = star && i % 2 === 1 ? r * inner : r;
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return pts;
}
