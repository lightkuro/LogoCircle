import { describe, expect, it } from 'vitest';
import { arcEdge, cubicEdge, distToPolyline, ellipseChain, flattenChain, lineEdge, ringsToPath, splineChain } from '@/geom';
import type { Chain, Pt } from '@/geom';
import { strokeOutline } from '../index';
import { insideRings, lcg, rel, ringsArea } from './helpers';

const ringsOf = (chains: Chain[]) => chains.map((c) => c.edges);

/** Compare a stroke outline with "all points within w/2 of the centreline". */
function agreement(chain: Chain, width: number, out: Chain[], seed: number): number {
  const centre = flattenChain(chain, 0.01);
  const rnd = lcg(seed);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of centre) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const pad = width;
  let bad = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const p: Pt = { x: x0 - pad + rnd() * (x1 - x0 + 2 * pad), y: y0 - pad + rnd() * (y1 - y0 + 2 * pad) };
    const d = distToPolyline(p, centre, chain.closed);
    if (Math.abs(d - width / 2) < 0.2) continue; // too close to the edge to call
    if (d < width / 2 !== insideRings(p, ringsOf(out))) bad++;
  }
  return bad / n;
}

describe('strokeOutline', () => {
  it('zero or negative width gives nothing', () => {
    const c: Chain = { edges: [lineEdge(0, 0, 100, 0)], closed: false };
    expect(strokeOutline(c, 0)).toEqual([]);
    expect(strokeOutline(c, -3)).toEqual([]);
    expect(strokeOutline({ edges: [], closed: false }, 5)).toEqual([]);
  });

  it('a single line is a capsule: 2 lines + 2 arcs', () => {
    const c: Chain = { edges: [lineEdge(200, 300, 600, 500)], closed: false };
    const out = strokeOutline(c, 40);
    expect(out.length).toBe(1);
    expect(out[0]!.closed).toBe(true);
    expect(out[0]!.edges.filter((e) => e.c.k === 'L').length).toBe(2);
    expect(out[0]!.edges.filter((e) => e.c.k === 'E').length).toBe(2);
    const L = Math.hypot(400, 200);
    expect(rel(ringsArea(ringsOf(out)), 40 * L + Math.PI * 20 * 20)).toBeLessThan(1e-9);
  });

  it('an L-shaped polyline has a round outer corner and a sharp inner one', () => {
    const c: Chain = { edges: [lineEdge(200, 200, 600, 200), lineEdge(600, 200, 600, 600)], closed: false };
    const out = strokeOutline(c, 60);
    expect(out.length).toBe(1);
    const e = out[0]!.edges;
    expect(e.filter((x) => x.c.k === 'L').length).toBe(4);
    expect(e.filter((x) => x.c.k === 'E').length).toBe(3);
    // two capsules minus their overlap: a quarter disc plus a square at the corner
    const r = 30;
    const expected = 2 * (60 * 400 + Math.PI * r * r) - ((Math.PI * r * r) / 4 + r * r + (Math.PI * r * r) / 2);
    expect(rel(ringsArea(ringsOf(out)), expected)).toBeLessThan(1e-6);
    expect(agreement(c, 60, out, 7)).toBeLessThan(0.002);
    expect(ringsToPath(ringsOf(out))).not.toMatch(/NaN/);
  });

  it('a closed triangle becomes an outer and an inner ring', () => {
    const c: Chain = {
      closed: true,
      edges: [lineEdge(300, 700, 700, 700), lineEdge(700, 700, 500, 300), lineEdge(500, 300, 300, 700)],
    };
    const out = strokeOutline(c, 30);
    expect(out.length).toBe(2);
    expect(agreement(c, 30, out, 11)).toBeLessThan(0.002);
  });

  it('a thick circular arc is exact', () => {
    const c: Chain = { edges: [arcEdge(500, 500, 200, 0.3, 2.1)], closed: false };
    const out = strokeOutline(c, 50);
    expect(out.length).toBe(1);
    expect(out[0]!.edges.length).toBe(4);
    for (const e of out[0]!.edges) expect(e.c.k).toBe('E');
    expect(rel(ringsArea(ringsOf(out)), 1.8 * 200 * 50 + Math.PI * 25 * 25)).toBeLessThan(1e-9);
    const back: Chain = { edges: [arcEdge(500, 500, 200, 2.1, 0.3)], closed: false };
    expect(rel(ringsArea(ringsOf(strokeOutline(back, 50))), 1.8 * 200 * 50 + Math.PI * 25 * 25)).toBeLessThan(1e-9);
  });

  it('a thick full circle is a ring', () => {
    const out = strokeOutline(ellipseChain(500, 500, 200, 200), 40);
    expect(out.length).toBe(2);
    expect(rel(ringsArea(ringsOf(out)), Math.PI * (220 * 220 - 180 * 180))).toBeLessThan(1e-9);
  });

  it('a pen wider than the arc radius still works', () => {
    const c: Chain = { edges: [arcEdge(500, 500, 10, 0, 2)], closed: false };
    const out = strokeOutline(c, 60);
    expect(out.length).toBe(1);
    expect(agreement(c, 60, out, 3)).toBeLessThan(0.004);
  });

  it('a thick cubic covers length × width', () => {
    const c: Chain = { edges: [cubicEdge(200, 600, 350, 200, 650, 200, 800, 600)], closed: false };
    const out = strokeOutline(c, 30);
    expect(out.length).toBe(1);
    const pts = flattenChain(c, 0.001);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    expect(rel(ringsArea(ringsOf(out)), len * 30 + Math.PI * 15 * 15)).toBeLessThan(0.02);
    expect(agreement(c, 30, out, 5)).toBeLessThan(0.002);
    expect(out[0]!.edges.length).toBeLessThanOrEqual(16);
  });

  it('a smooth multi-point curve and a thick ellipse', () => {
    const s = splineChain(
      [
        { x: 200, y: 500 },
        { x: 400, y: 300 },
        { x: 600, y: 600 },
        { x: 800, y: 400 },
      ],
      false,
    );
    const out = strokeOutline(s, 24);
    expect(out.length).toBe(1);
    expect(agreement(s, 24, out, 9)).toBeLessThan(0.003);
    expect(out[0]!.edges.length).toBeLessThanOrEqual(s.edges.length * 8);

    const el = ellipseChain(500, 500, 300, 150, 0.4);
    const ring = strokeOutline(el, 20);
    expect(ring.length).toBe(2);
    expect(agreement(el, 20, ring, 13)).toBeLessThan(0.003);
  });
});
