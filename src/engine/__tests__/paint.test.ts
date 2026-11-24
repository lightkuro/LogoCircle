/**
 * End-to-end use of the engine the way the editor uses it: tap faces to paint
 * them, bake the result into shapes, rebuild with guides + shapes, repeat.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ellipseChain, translate, transformChain } from '@/geom';
import type { Chain, Ring } from '@/geom';
import { arrangementStats, buildArrangement, faceAt, neighbors, outline, withFollowers } from '../index';
import type { Arrangement, Source } from '../index';
import { circle, lcg, rect, rel, ringsArea, seg } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEED = Number(env.ENGINE_SEED ?? 20261124);
const FUZZ = Number(env.ENGINE_FUZZ ?? 1);

interface Painted {
  id: string;
  color: number;
  rings: Ring[];
}

const toSource = (s: Painted): Source => ({ id: s.id, fill: true, chains: s.rings.map((r) => ({ edges: r, closed: true })) });

let nextId = 0;

/** The editor's paint operation: color === null erases. */
function paint(arr: Arrangement, shapes: Painted[], picked: number[], color: number | null): Painted[] {
  const P = withFollowers(arr, picked);
  const facesOf = (id: string): number[] => arr.faces.filter((f) => f.inside.includes(id)).map((f) => f.id);
  const out: Painted[] = [];
  const merged = new Set<number>(P);
  for (const s of shapes) {
    const mine = facesOf(s.id);
    const touched = mine.some((f) => P.has(f));
    const adjacent = mine.some((f) => neighbors(arr, f).some((g) => P.has(g)));
    if (color !== null && s.color === color && (touched || adjacent)) {
      for (const f of mine) merged.add(f);
    } else if (touched) {
      const rest = mine.filter((f) => !P.has(f));
      const rings = outline(arr, rest);
      if (rings.length > 0) out.push({ ...s, rings });
    } else {
      out.push(s);
    }
  }
  if (color !== null) {
    const rings = outline(arr, withFollowers(arr, merged));
    if (rings.length > 0) out.push({ id: `p${nextId++}`, color, rings });
  }
  return out;
}

const coord = fc.oneof(fc.double({ min: 150, max: 870, noNaN: true }), fc.integer({ min: 4, max: 21 }).map((n) => n * 40));
const radius = fc.oneof(fc.double({ min: 30, max: 240, noNaN: true }), fc.integer({ min: 1, max: 6 }).map((n) => n * 40));
const arbGuide = fc.oneof(
  { weight: 4, arbitrary: fc.tuple(coord, coord, radius).map(([x, y, r]): Chain => circle(x, y, r)) },
  { weight: 2, arbitrary: fc.tuple(coord, coord, radius, radius, fc.double({ min: 0, max: 3, noNaN: true })).map(([x, y, a, b, t]): Chain => ellipseChain(x, y, a, b, t)) },
  { weight: 2, arbitrary: fc.tuple(coord, coord, radius, radius).map(([x, y, w, h]): Chain => rect(x, y, w * 2, h * 2)) },
  { weight: 3, arbitrary: fc.tuple(coord, coord, coord, coord).map(([a, b, c, d]): Chain => seg(a - 100, b, c + 100.3, d + 0.7)) },
);

describe('painting, baking and rebuilding', () => {
  it('shapes stay consistent over many paint steps', () => {
    console.log(`[engine paint] fast-check seed ${SEED}`);
    fc.assert(
      fc.property(fc.array(arbGuide, { minLength: 2, maxLength: 7 }), fc.integer({ min: 1, max: 1 << 30 }), (chains, seed) => {
        const rnd = lcg(seed);
        const guides: Source[] = chains.map((c, i) => ({ id: `g${i}`, chains: [c], fill: false }));
        const base = buildArrangement(guides);
        const baseReal = base.faces.filter((f) => f.follow < 0).length;
        if (baseReal === 0) return;
        let shapes: Painted[] = [];
        for (let step = 0; step < 7; step++) {
          const arr = buildArrangement([...guides, ...shapes.map(toSource)]);
          const real = arr.faces.filter((f) => f.follow < 0);
          // Baked shapes share their guides' curves: no new tappable faces appear.
          expect(real.length).toBe(baseReal);
          // Nothing overlaps: every face belongs to at most one shape.
          for (const f of real) expect(f.inside.length).toBeLessThanOrEqual(1);
          // What the faces say is painted matches what the shapes hold.
          const paintedFaces = arr.faces.filter((f) => f.inside.length > 0).reduce((s, f) => s + f.area, 0);
          const paintedShapes = shapes.reduce((s, sh) => s + ringsArea(sh.rings), 0);
          expect(Math.abs(paintedFaces - paintedShapes)).toBeLessThan(1 + 2e-3 * paintedShapes);
          const st = arrangementStats(arr);
          expect(st.vertices - st.edges + st.boundedCycles).toBe(st.components);

          const start = real[Math.floor(rnd() * real.length)]!.id;
          const picked = [start];
          for (const g of neighbors(arr, start)) if (rnd() < 0.4) picked.push(g);
          const color = rnd() < 0.25 ? null : Math.floor(rnd() * 3);
          shapes = paint(arr, shapes, picked, color);
          for (const s of shapes) {
            expect(s.rings.length).toBeGreaterThan(0);
            for (const r of s.rings) expect(r.length).toBeGreaterThan(0);
          }
        }
      }),
      { seed: SEED, numRuns: 60 * FUZZ },
    );
  });

  it('re-tracing an untouched shape is byte-identical, generation after generation', () => {
    fc.assert(
      fc.property(fc.array(arbGuide, { minLength: 2, maxLength: 6 }), (chains) => {
        const guides: Source[] = chains.map((c, i) => ({ id: `g${i}`, chains: [c], fill: false }));
        const first = buildArrangement(guides);
        const real = first.faces.filter((f) => f.follow < 0);
        let baked = real.map((f) => outline(first, withFollowers(first, [f.id])));
        for (let gen = 0; gen < 3; gen++) {
          const arr = buildArrangement([...guides, ...baked.map((rings, i): Source => toSource({ id: `b${i}`, color: 0, rings }))]);
          const again = baked.map((_, i) => outline(arr, arr.faces.filter((f) => f.inside.includes(`b${i}`)).map((f) => f.id)));
          for (let i = 0; i < baked.length; i++) expect(JSON.stringify(again[i])).toBe(JSON.stringify(baked[i]));
          baked = again;
        }
      }),
      { seed: SEED, numRuns: 60 * FUZZ },
    );
  });

  it('moving a guide after baking leaves the painted shapes alone', () => {
    const guides: Source[] = [
      { id: 'a', chains: [circle(400, 500, 200)], fill: false },
      { id: 'b', chains: [circle(600, 500, 200)], fill: false },
      { id: 'l', chains: [seg(150, 430, 850, 560)], fill: false },
    ];
    const first = buildArrangement(guides);
    const lens = faceAt(first, { x: 500, y: 400 });
    const below = faceAt(first, { x: 500, y: 600 });
    let shapes = paint(first, [], [lens], 0);
    shapes = paint(buildArrangement([...guides, ...shapes.map(toSource)]), shapes, [below], 1);
    const area0 = shapes.reduce((s, sh) => s + ringsArea(sh.rings), 0);
    for (const off of [1e-6, 1e-4, 1e-3, 0.01, 0.3, 5, 60]) {
      const moved = guides.map((g, i) => (i === 0 ? { ...g, chains: g.chains.map((c) => transformChain(c, translate(off, off / 2))) } : g));
      const arr = buildArrangement([...moved, ...shapes.map(toSource)]);
      const st = arrangementStats(arr);
      expect(st.vertices - st.edges + st.boundedCycles).toBe(st.components);
      const painted = arr.faces.filter((f) => f.inside.length > 0).reduce((s, f) => s + f.area, 0);
      expect(rel(painted, area0)).toBeLessThan(1e-3);
      for (const f of arr.faces) expect(faceAt(arr, f.center)).toBe(f.follow >= 0 ? f.follow : f.id);
      // repaint over the top shape with another colour: areas still add up
      const top = arr.faces.find((f) => f.follow < 0 && f.inside.includes(shapes[0]!.id))!;
      const after = paint(arr, shapes, [top.id], 2);
      const arr2 = buildArrangement([...moved, ...after.map(toSource)]);
      for (const f of arr2.faces.filter((x) => x.follow < 0)) expect(f.inside.length).toBeLessThanOrEqual(1);
    }
  });
});
