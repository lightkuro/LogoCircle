import { describe, expect, it } from 'vitest';
import { carrierKey, cubicEdge, ellipseChain, ringsToPath, splineChain } from '@/geom';
import type { Chain, Ring } from '@/geom';
import { buildArrangement, outline, withFollowers } from '../index';
import { circle, guide, lensArea, poly, real, rect, rel, ringsArea, seg, shapeOfRings } from './helpers';

const TAU = Math.PI * 2;

describe('outline: exact curves come back', () => {
  const a = circle(400, 500, 200);
  const b = circle(600, 500, 200);
  const arr = buildArrangement([guide('a', a), guide('b', b)]);
  const sorted = [...arr.faces].sort((p, q) => p.area - q.area);
  const lens = sorted[0]!;

  it('the lens of two circles is two arcs on the original carriers', () => {
    const rings = outline(arr, [lens.id]);
    expect(rings.length).toBe(1);
    expect(rings[0]!.length).toBe(2);
    const keys = rings[0]!.map((e) => carrierKey(e.c)).sort();
    expect(keys).toEqual([carrierKey(a.edges[0]!.c), carrierKey(b.edges[0]!.c)].sort());
    for (const e of rings[0]!) expect(e.c.k).toBe('E');
    expect(rel(ringsArea(rings), lensArea(200, 200, 200))).toBeLessThan(1e-5);
  });

  it('the union of all faces of two circles is two arcs', () => {
    const rings = outline(arr, arr.faces.map((f) => f.id));
    expect(rings.length).toBe(1);
    expect(rings[0]!.length).toBe(2);
    expect(rel(ringsArea(rings), 2 * Math.PI * 200 * 200 - lensArea(200, 200, 200))).toBeLessThan(1e-5);
  });

  it('a whole circle is one edge sweeping a full turn', () => {
    const one = buildArrangement([guide('a', a)]);
    const rings = outline(one, [0]);
    expect(rings.length).toBe(1);
    expect(rings[0]!.length).toBe(1);
    expect(Math.abs(rings[0]![0]!.t1 - rings[0]![0]!.t0)).toBeCloseTo(TAU, 9);
    expect(carrierKey(rings[0]![0]!.c)).toBe(carrierKey(a.edges[0]!.c));
  });

  it('a square is four line edges', () => {
    const sq = buildArrangement([guide('s', rect(500, 500, 300, 300, 0.4))]);
    const rings = outline(sq, [0]);
    expect(rings.length).toBe(1);
    expect(rings[0]!.length).toBe(4);
    for (const e of rings[0]!) {
      expect(e.c.k).toBe('L');
      expect([e.t0, e.t1].sort()).toEqual([0, 1]);
    }
    expect(rel(ringsArea(rings), 300 * 300)).toBeLessThan(1e-9);
  });

  it('a ring face comes back as outer + opposite hole', () => {
    const an = buildArrangement([guide('a', circle(500, 500, 200)), guide('b', circle(500, 500, 100))]);
    const ring = an.faces.find((f) => f.loops.length === 2)!;
    const rings = outline(an, [ring.id]);
    expect(rings.length).toBe(2);
    const sweeps = rings.map((r) => r[0]!.t1 - r[0]!.t0);
    expect(Math.sign(sweeps[0]!)).toBe(-Math.sign(sweeps[1]!));
    // union of ring + disc dissolves the inner circle
    expect(outline(an, an.faces.map((f) => f.id)).length).toBe(1);
  });

  it('line pieces split by a crossing line merge back', () => {
    const arr2 = buildArrangement([guide('s', rect(500, 500, 400, 400)), guide('l', seg(100, 520, 900, 480))]);
    expect(arr2.faces.length).toBe(2);
    const rings = outline(arr2, arr2.faces.map((f) => f.id));
    expect(rings.length).toBe(1);
    expect(rings[0]!.length).toBe(4);
    const half = outline(arr2, [0]);
    expect(half[0]!.length).toBe(4);
  });

  it('collinear pieces from different rectangles merge into one line', () => {
    const arr2 = buildArrangement([guide('a', rect(300, 300, 200, 200)), guide('b', rect(500, 300, 200, 200))]);
    expect(arr2.faces.length).toBe(2);
    const rings = outline(arr2, [0, 1]);
    expect(rings.length).toBe(1);
    expect(rings[0]!.length).toBe(4);
    expect(rel(ringsArea(rings), 80000)).toBeLessThan(1e-9);
  });

  it('path data has no NaN', () => {
    for (const f of arr.faces) {
      const d = ringsToPath(outline(arr, [f.id]));
      expect(d).not.toMatch(/NaN|Infinity|undefined/);
      expect(d.startsWith('M')).toBe(true);
    }
  });

  it('cubic outlines come back as cubics', () => {
    const blob: Chain = splineChain(
      [
        { x: 300, y: 300 },
        { x: 700, y: 350 },
        { x: 650, y: 700 },
        { x: 350, y: 650 },
      ],
      true,
    );
    const arr2 = buildArrangement([guide('b', blob), guide('l', seg(100, 500, 900, 500))]);
    expect(real(arr2).length).toBe(2);
    const all = outline(arr2, arr2.faces.map((f) => f.id));
    expect(all.length).toBe(1);
    expect(all[0]!.length).toBe(4);
    for (const e of all[0]!) expect(e.c.k).toBe('C');
    const top = outline(arr2, [real(arr2)[0]!.id]);
    expect(top[0]!.some((e) => e.c.k === 'L')).toBe(true);
    expect(ringsToPath(top)).not.toMatch(/NaN/);
  });
});

describe('outline: idempotence (a baked shape next to the guides it came from)', () => {
  const cases: [string, Chain[]][] = [
    ['two circles', [circle(400, 500, 200), circle(600, 500, 200)]],
    ['three circles + line', [circle(400, 450, 200), circle(600, 450, 200), circle(500, 620, 200), seg(100, 500, 900, 520)]],
    ['ellipses', [ellipseChain(500, 500, 300, 120, 0.3), ellipseChain(520, 480, 280, 140, 1.4), circle(450, 520, 150)]],
    ['square, circle, triangle', [rect(500, 500, 300, 300, 0.2), circle(620, 420, 160), poly(300, 700, 700, 720, 480, 250)]],
    [
      'cubic blob + circle',
      [
        { closed: true, edges: [cubicEdge(300, 500, 300, 200, 700, 200, 700, 500), cubicEdge(700, 500, 700, 800, 300, 800, 300, 500)] },
        circle(640, 500, 150),
      ],
    ],
  ];
  for (const [name, chains] of cases) {
    it(name, () => {
      const guides = chains.map((c, i) => guide(`g${i}`, c));
      const first = buildArrangement(guides);
      expect(first.faces.every((f) => f.follow < 0)).toBe(true);
      // Bake every face into its own shape.
      const baked: Ring[][] = first.faces.map((f) => outline(first, [f.id]));
      const second = buildArrangement([...guides, ...baked.map((r, i) => shapeOfRings(`s${i}`, r))]);
      expect(second.faces.length).toBe(first.faces.length);
      expect(second.faces.every((f) => f.follow < 0)).toBe(true);
      const a1 = first.faces.map((f) => f.area).sort((p, q) => p - q);
      const a2 = second.faces.map((f) => f.area).sort((p, q) => p - q);
      for (let i = 0; i < a1.length; i++) expect(rel(a2[i]!, a1[i]!)).toBeLessThan(1e-9);
      // Each baked shape owns exactly one face, and re-tracing it is byte-identical.
      for (let i = 0; i < baked.length; i++) {
        const mine = second.faces.filter((f) => f.inside.includes(`s${i}`));
        expect(mine.length).toBe(1);
        expect(mine[0]!.inside).toEqual([`s${i}`]);
        const again = outline(second, withFollowers(second, [mine[0]!.id]));
        expect(JSON.stringify(again)).toBe(JSON.stringify(baked[i]));
      }
      // A third generation without the guides is stable too.
      const third = buildArrangement(baked.map((r, i) => shapeOfRings(`s${i}`, r)));
      expect(third.faces.length).toBe(first.faces.length);
      for (let i = 0; i < baked.length; i++) {
        const mine = third.faces.filter((f) => f.inside.includes(`s${i}`));
        expect(JSON.stringify(outline(third, mine.map((f) => f.id)))).toBe(JSON.stringify(baked[i]));
      }
    });
  }

  it('merging two baked neighbours gives the same outline as merging the faces', () => {
    const guides = [guide('a', circle(400, 500, 200)), guide('b', circle(600, 500, 200))];
    const first = buildArrangement(guides);
    const sorted = [...first.faces].sort((p, q) => p.area - q.area);
    const direct = outline(first, [sorted[0]!.id, sorted[1]!.id]);
    const s0 = outline(first, [sorted[0]!.id]);
    const s1 = outline(first, [sorted[1]!.id]);
    const second = buildArrangement([shapeOfRings('s0', s0), shapeOfRings('s1', s1)]);
    const merged = outline(second, second.faces.map((f) => f.id));
    expect(JSON.stringify(merged)).toBe(JSON.stringify(direct));
  });
});
