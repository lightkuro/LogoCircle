/**
 * Scenes built on a coarse lattice: tangent circles, three curves through one
 * point, shared endpoints and collinear overlaps happen all the time here —
 * exactly what a designer snapping shapes together produces.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { flattenRing, windingOfPolygon } from '@/geom';
import type { Chain, Pt, Ring } from '@/geom';
import { arrangementStats, buildArrangement, faceAt, outline, withFollowers } from '../index';
import type { Arrangement, Source } from '../index';
import { circle, poly, rect, seg } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEED = Number(env.ENGINE_SEED ?? 20261124);
const FUZZ = Number(env.ENGINE_FUZZ ?? 1);

const L = fc.integer({ min: 2, max: 10 }).map((n) => n * 80);
const R = fc.integer({ min: 1, max: 6 }).map((n) => n * 40);
const arb: fc.Arbitrary<Chain> = fc.oneof(
  { weight: 5, arbitrary: fc.tuple(L, L, R).map(([x, y, r]) => circle(x, y, r)) },
  { weight: 2, arbitrary: fc.tuple(L, L, R, R, fc.constantFrom(0, Math.PI / 4, Math.PI / 2)).map(([x, y, w, h, t]) => rect(x, y, w * 2, h * 2, t)) },
  { weight: 3, arbitrary: fc.tuple(L, L, L, L).map(([a, b, c, d]) => seg(a, b, c, d)) },
  { weight: 1, arbitrary: fc.tuple(L, L, L, L, L, L).map(([a, b, c, d, e, f]) => poly(a, b, c, d, e, f)) },
);
const scene = fc
  .array(fc.tuple(arb, fc.boolean()), { minLength: 2, maxLength: 12 })
  .map((items) => items.map(([c, fill], i): Source => ({ id: `s${i}`, chains: [c], fill: fill && c.closed && c.edges.length > 0 })));

function insideSource(p: Pt, s: Source): boolean {
  let w = 0;
  for (const c of s.chains) if (c.closed) w += windingOfPolygon(p, flattenRing(c.edges, 0.002));
  return w !== 0;
}

function clearance(p: Pt, arr: Arrangement, id: number): number {
  let best = Infinity;
  for (const loop of arr.faces[id]!.loops) {
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

describe('lattice scenes (exact coincidences everywhere)', () => {
  it('graph, winding and point location stay consistent', () => {
    console.log(`[engine lattice] fast-check seed ${SEED}`);
    fc.assert(
      fc.property(scene, (sources) => {
        const arr = buildArrangement(sources);
        const s = arrangementStats(arr);
        expect(s.vertices - s.edges + s.boundedCycles).toBe(s.components);
        expect(s.cycles).toBe(s.boundedCycles + s.components);
        for (const f of arr.faces) {
          expect(faceAt(arr, f.center)).toBe(f.follow >= 0 ? f.follow : f.id);
          if (clearance(f.center, arr, f.id) < 0.05) continue;
          expect(f.inside).toEqual(sources.filter((x) => x.fill && insideSource(f.center, x)).map((x) => x.id));
        }
        // Slivers (tangent curves, three curves almost through one point) are tiny and resolved.
        for (const f of arr.faces) {
          if (f.follow < 0) continue;
          expect(f.area).toBeLessThan(40);
          expect(arr.faces[f.follow]!.follow).toBe(-1);
        }
      }),
      { seed: SEED, numRuns: 150 * FUZZ },
    );
  });

  it('baking every face and rebuilding changes nothing', () => {
    fc.assert(
      fc.property(scene, (sources) => {
        const guides = sources.map((s) => ({ ...s, fill: false }));
        const first = buildArrangement(guides);
        const firstReal = first.faces.filter((f) => f.follow < 0);
        const baked: Ring[][] = firstReal.map((f) => outline(first, withFollowers(first, [f.id])));
        for (const rings of baked) expect(rings.length).toBeGreaterThan(0);
        const second = buildArrangement([
          ...guides,
          ...baked.map((rings, i): Source => ({ id: `b${i}`, fill: true, chains: rings.map((r) => ({ edges: r, closed: true })) })),
        ]);
        expect(second.faces.filter((f) => f.follow < 0).length).toBe(firstReal.length);
        for (let i = 0; i < baked.length; i++) {
          const mine = second.faces.filter((f) => f.inside.includes(`b${i}`));
          expect(mine.filter((f) => f.follow < 0).length).toBe(1);
          for (const f of mine) expect(f.inside.length).toBe(1);
          expect(JSON.stringify(outline(second, mine.map((f) => f.id)))).toBe(JSON.stringify(baked[i]));
        }
        // the dissolved whole has no leftover interior edges
        const whole = outline(second, second.faces.map((f) => f.id));
        expect(JSON.stringify(whole)).toBe(JSON.stringify(outline(first, first.faces.map((f) => f.id))));
      }),
      { seed: SEED, numRuns: 100 * FUZZ },
    );
  });
});
