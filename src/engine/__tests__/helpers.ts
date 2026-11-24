import type { Chain, Pt, Ring } from '@/geom';
import { derivC, ellipseChain, evalC, flattenRing, lineChain, polygonChain, rectChain, windingOfPolygon } from '@/geom';
import type { Arrangement, Face, Source } from '../index';

export const circle = (cx: number, cy: number, r: number): Chain => ellipseChain(cx, cy, r, r);
export const seg = (x0: number, y0: number, x1: number, y1: number): Chain => lineChain(x0, y0, x1, y1);
export const rect = (cx: number, cy: number, w: number, h: number, rot = 0): Chain => rectChain(cx, cy, w, h, rot);
export const poly = (...xy: number[]): Chain => {
  const pts: Pt[] = [];
  for (let i = 0; i < xy.length; i += 2) pts.push({ x: xy[i]!, y: xy[i + 1]! });
  return polygonChain(pts);
};

export const guide = (id: string, ...chains: Chain[]): Source => ({ id, chains, fill: false });
export const shape = (id: string, ...chains: Chain[]): Source => ({ id, chains, fill: true });
export const shapeOfRings = (id: string, rings: Ring[]): Source => ({
  id,
  fill: true,
  chains: rings.map((r) => ({ edges: r, closed: true })),
});

/** Faces a person could tap (slivers excluded). */
export const real = (arr: Arrangement): Face[] => arr.faces.filter((f) => f.follow < 0);
export const areas = (arr: Arrangement): number[] =>
  real(arr)
    .map((f) => f.area)
    .sort((a, b) => a - b);
export const totalArea = (arr: Arrangement): number => arr.faces.reduce((s, f) => s + f.area, 0);

/** Area of the lens where two circles overlap. */
export function lensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a + b - c;
}

/** Exact area enclosed by rings (Green's theorem per edge; cubics by Simpson). */
export function ringsArea(rings: Ring[]): number {
  let a = 0;
  for (const r of rings) {
    for (const e of r) {
      const c = e.c;
      const p = evalC(c, e.t0);
      const q = evalC(c, e.t1);
      if (c.k === 'L') {
        a += 0.5 * (p.x * q.y - q.x * p.y);
      } else if (c.k === 'E') {
        a += 0.5 * c.rx * c.ry * (e.t1 - e.t0) + 0.5 * (c.cx * (q.y - p.y) - c.cy * (q.x - p.x));
      } else {
        const n = 200;
        const h = (e.t1 - e.t0) / n;
        let sum = 0;
        for (let i = 0; i <= n; i++) {
          const t = e.t0 + h * i;
          const pt = evalC(c, t);
          const d = derivC(c, t);
          const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
          sum += w * (pt.x * d.y - pt.y * d.x);
        }
        a += (0.5 * sum * h) / 3;
      }
    }
  }
  return Math.abs(a);
}

export function insideRings(p: Pt, rings: Ring[], tol = 0.02): boolean {
  let w = 0;
  for (const r of rings) w += windingOfPolygon(p, flattenRing(r, tol));
  return w !== 0;
}

/** Deterministic pseudo-random numbers for sampling oracles. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
