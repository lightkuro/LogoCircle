import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cubicEdge, ellipseChain, flattenRing, rotate, scale, transformChain, translate, windingOfPolygon } from '@/geom';
import type { Chain, Mat, Pt } from '@/geom';
import { arrangementStats, buildArrangement, faceAt, outline } from '../index';
import type { Arrangement, Source } from '../index';
import { circle, rect, rel, ringsArea, seg } from './helpers';

// ENGINE_SEED / ENGINE_FUZZ let you widen the search: ENGINE_FUZZ=20 runs 20× as many cases.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEED = Number(env.ENGINE_SEED ?? 20261124);
const FUZZ = Number(env.ENGINE_FUZZ ?? 1);
const log = (name: string): void => console.log(`[engine properties] ${name}: fast-check seed ${SEED}`);

// ---- generators -------------------------------------------------------------

const coord = fc.oneof(
  fc.double({ min: 120, max: 900, noNaN: true }),
  fc.integer({ min: 3, max: 22 }).map((n) => n * 40), // lattice values → exact coincidences
);
const radius = fc.oneof(fc.double({ min: 15, max: 260, noNaN: true }), fc.integer({ min: 1, max: 6 }).map((n) => n * 40));

const arbCircle = fc.tuple(coord, coord, radius).map(([x, y, r]) => circle(x, y, r));
const arbEllipse = fc
  .tuple(coord, coord, radius, radius, fc.double({ min: 0, max: Math.PI, noNaN: true }))
  .map(([x, y, a, b, rot]) => ellipseChain(x, y, a, b + 3, rot));
const arbRect = fc
  .tuple(coord, coord, radius, radius, fc.oneof(fc.constant(0), fc.double({ min: 0, max: 1.5, noNaN: true })))
  .map(([x, y, w, h, rot]) => rect(x, y, w + 10, h + 10, rot));
const arbSeg = fc.tuple(coord, coord, coord, coord).map(([a, b, c, d]) => seg(a, b, c + 0.37, d + 0.11));
const arbBlob = fc.tuple(coord, coord, radius, radius).map(([x, y, a, b]): Chain => {
  const k = 0.7;
  return {
    closed: true,
    edges: [
      cubicEdge(x - a, y, x - a, y - b * k, x + a, y - b * k * 1.6, x + a, y),
      cubicEdge(x + a, y, x + a, y + b * k * 1.3, x - a, y + b * k, x - a, y),
    ],
  };
});

const closedChain = fc.oneof({ weight: 4, arbitrary: arbCircle }, { weight: 2, arbitrary: arbEllipse }, { weight: 2, arbitrary: arbRect }, { weight: 1, arbitrary: arbBlob });
const anyChain = fc.oneof({ weight: 5, arbitrary: closedChain }, { weight: 3, arbitrary: arbSeg });

/** A scene: each chain is its own source; `fill` decides whether it is a shape or a guide. */
const scene = (max: number, chain = anyChain) =>
  fc.array(fc.tuple(chain, fc.boolean()), { minLength: 1, maxLength: max }).map((items) =>
    items.map(([c, fill], i): Source => ({ id: `s${i}`, chains: [c], fill: fill && c.closed })),
  );

// ---- oracles ----------------------------------------------------------------

function insideSource(p: Pt, s: Source): boolean {
  let w = 0;
  for (const c of s.chains) if (c.closed) w += windingOfPolygon(p, flattenRing(c.edges, 0.002));
  return w !== 0;
}

function distToBoundary(p: Pt, arr: Arrangement, faceId: number): number {
  let best = Infinity;
  for (const loop of arr.faces[faceId]!.loops) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[j]!;
      const b = loop[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
  }
  return best;
}

interface Graph {
  vx: Int32Array;
  vy: Int32Array;
  ea: Int32Array;
  eb: Int32Array;
}

function properCrossings(g: Graph): number {
  const n = g.ea.length;
  let bad = 0;
  const o = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  for (let i = 0; i < n; i++) {
    const a = g.ea[i]!;
    const b = g.eb[i]!;
    const ax = g.vx[a]!;
    const ay = g.vy[a]!;
    const bx = g.vx[b]!;
    const by = g.vy[b]!;
    for (let j = i + 1; j < n; j++) {
      const c = g.ea[j]!;
      const d = g.eb[j]!;
      if (c === a || c === b || d === a || d === b) continue;
      const cx = g.vx[c]!;
      const cy = g.vy[c]!;
      const dx = g.vx[d]!;
      const dy = g.vy[d]!;
      if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx)) continue;
      if (Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) continue;
      const o1 = o(ax, ay, bx, by, cx, cy);
      const o2 = o(ax, ay, bx, by, dx, dy);
      const o3 = o(cx, cy, dx, dy, ax, ay);
      const o4 = o(cx, cy, dx, dy, bx, by);
      if (o1 * o2 < 0 && o3 * o4 < 0) bad++;
      // an endpoint strictly inside the other edge is a crossing too
      const on = (px: number, py: number, qx: number, qy: number, rx: number, ry: number, oo: number): boolean =>
        oo === 0 && (rx - px) * (rx - qx) + (ry - py) * (ry - qy) < 0;
      if (on(ax, ay, bx, by, cx, cy, o1) || on(ax, ay, bx, by, dx, dy, o2) || on(cx, cy, dx, dy, ax, ay, o3) || on(cx, cy, dx, dy, bx, by, o4)) bad++;
    }
  }
  return bad;
}

// ---- properties -------------------------------------------------------------

describe('engine properties', () => {
  it('Euler: V − E + F = 1 + C, one outer cycle per component', () => {
    log('euler');
    fc.assert(
      fc.property(scene(9), (sources) => {
        const s = arrangementStats(buildArrangement(sources));
        expect(s.vertices - s.edges + (s.boundedCycles + 1)).toBe(1 + s.components);
        expect(s.cycles).toBe(s.boundedCycles + s.components);
      }),
      { seed: SEED, numRuns: 150 * FUZZ },
    );
  });

  it('no two segments cross after noding', () => {
    log('noding');
    fc.assert(
      fc.property(scene(6), (sources) => {
        const arr = buildArrangement(sources, { tolerance: 0.6 });
        expect(properCrossings(arr._ as Graph)).toBe(0);
      }),
      { seed: SEED, numRuns: 80 * FUZZ },
    );
  });

  it('every face knows exactly which shapes contain it, and faceAt finds it', () => {
    log('winding');
    fc.assert(
      fc.property(scene(8), (sources) => {
        const arr = buildArrangement(sources);
        for (const f of arr.faces) {
          const hit = faceAt(arr, f.center);
          expect(hit).toBe(f.follow >= 0 ? f.follow : f.id);
          if (f.follow >= 0) expect(arr.faces[f.follow]!.follow).toBe(-1);
          // Only judge points that are clearly away from every outline.
          if (distToBoundary(f.center, arr, f.id) < 0.05) continue;
          const expected = sources.filter((s) => s.fill && insideSource(f.center, s)).map((s) => s.id);
          expect(f.inside).toEqual(expected);
        }
      }),
      { seed: SEED, numRuns: 120 * FUZZ },
    );
  });

  it('face areas add up to the union of everything closed', () => {
    log('area');
    fc.assert(
      fc.property(scene(7, closedChain), (sources) => {
        const arr = buildArrangement(sources);
        const total = arr.faces.reduce((s, f) => s + f.area, 0);
        // exact outline of all faces vs the summed polygon areas
        const exact = ringsArea(outline(arr, arr.faces.map((f) => f.id)));
        expect(rel(total, exact)).toBeLessThan(2e-3);
        // independent raster oracle over the scene's bounding box
        const polys = sources.flatMap((s) => s.chains.map((c) => flattenRing(c.edges, 0.05)));
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const poly of polys) {
          for (const p of poly) {
            x0 = Math.min(x0, p.x);
            y0 = Math.min(y0, p.y);
            x1 = Math.max(x1, p.x);
            y1 = Math.max(y1, p.y);
          }
        }
        const n = 200;
        let inside = 0;
        let perimeter = 0;
        for (const poly of polys) {
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            perimeter += Math.hypot(poly[i]!.x - poly[j]!.x, poly[i]!.y - poly[j]!.y);
          }
        }
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const p = { x: x0 + ((i + 0.5) * (x1 - x0)) / n, y: y0 + ((j + 0.5) * (y1 - y0)) / n };
            for (const poly of polys) {
              if (windingOfPolygon(p, poly) !== 0) {
                inside++;
                break;
              }
            }
          }
        }
        const raster = (inside * (x1 - x0) * (y1 - y0)) / (n * n);
        // A raster is only as good as its cells: allow half a cell along every outline.
        const cell = Math.max(x1 - x0, y1 - y0) / n;
        expect(Math.abs(total - raster)).toBeLessThan(0.01 * total + 0.5 * cell * perimeter);
      }),
      { seed: SEED, numRuns: 40 * FUZZ },
    );
  });

  const summary = (arr: Arrangement): number[] =>
    arr.faces
      .filter((f) => f.follow < 0)
      .map((f) => f.area)
      .sort((a, b) => a - b);
  const sameFaces = (a: Arrangement, b: Arrangement): void => {
    const x = summary(a);
    const y = summary(b);
    expect(y.length).toBe(x.length);
    for (let i = 0; i < x.length; i++) expect(Math.abs(x[i]! - y[i]!)).toBeLessThan(1e-3 + 1e-5 * x[i]!);
  };
  const mapScene = (sources: Source[], m: Mat): Source[] =>
    sources.map((s) => ({ ...s, chains: s.chains.map((c) => transformChain(c, m)) }));

  it('faces do not depend on input order', () => {
    log('permutation');
    fc.assert(
      fc.property(scene(8), fc.integer({ min: 1, max: 1000 }), (sources, k) => {
        const shuffled = sources.map((s, i) => ({ s, key: ((i + 1) * k * 7919) % 104729 })).sort((a, b) => a.key - b.key).map((x) => x.s);
        sameFaces(buildArrangement(sources), buildArrangement(shuffled));
      }),
      { seed: SEED, numRuns: 80 * FUZZ },
    );
  });

  it('faces survive translation by whole units', () => {
    log('translation');
    fc.assert(
      fc.property(scene(8), fc.integer({ min: -300, max: 300 }), fc.integer({ min: -300, max: 300 }), (sources, dx, dy) => {
        sameFaces(buildArrangement(sources), buildArrangement(mapScene(sources, translate(dx, dy))));
      }),
      { seed: SEED, numRuns: 80 * FUZZ },
    );
  });

  it('faces survive mirroring and quarter turns', () => {
    log('mirror');
    fc.assert(
      fc.property(scene(8), fc.boolean(), (sources, quarter) => {
        const m = quarter ? rotate(Math.PI / 2, 512, 512) : scale(-1, 1, 512, 512);
        sameFaces(buildArrangement(sources), buildArrangement(mapScene(sources, m)));
      }),
      { seed: SEED, numRuns: 80 * FUZZ },
    );
  });

  it('painting everything then baking is stable (random scenes)', () => {
    log('rebake');
    fc.assert(
      fc.property(scene(6), (sources) => {
        const first = buildArrangement(sources);
        const real = first.faces.filter((f) => f.follow < 0);
        const baked = real.map((f) => outline(first, [f.id]));
        const guides = sources.map((s) => ({ ...s, fill: false }));
        const second = buildArrangement([
          ...guides,
          ...baked.map((rings, i): Source => ({ id: `b${i}`, fill: true, chains: rings.map((r) => ({ edges: r, closed: true })) })),
        ]);
        const real2 = second.faces.filter((f) => f.follow < 0);
        expect(real2.length).toBe(real.length);
        for (let i = 0; i < baked.length; i++) {
          const mine = real2.filter((f) => f.inside.includes(`b${i}`));
          expect(mine.length).toBe(1);
          expect(Math.abs(mine[0]!.area - real[i]!.area)).toBeLessThan(1e-3 + 1e-5 * real[i]!.area);
        }
      }),
      { seed: SEED, numRuns: 60 * FUZZ },
    );
  });
});
