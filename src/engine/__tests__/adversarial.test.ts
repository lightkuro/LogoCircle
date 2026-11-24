import { describe, expect, it } from 'vitest';
import { ellipseChain, ringsToPath } from '@/geom';
import { arrangementStats, buildArrangement, faceAt, outline, withFollowers } from '../index';
import type { Arrangement, Source } from '../index';
import { circle, guide, poly, real, rect, rel, ringsArea, seg, shape } from './helpers';

const ARTBOARD = { x: -1024, y: -1024, w: 3072, h: 3072 };

function sane(arr: Arrangement): void {
  const s = arrangementStats(arr);
  expect(s.vertices - s.edges + s.boundedCycles).toBe(s.components);
  for (const f of arr.faces) {
    expect(f.area).toBeGreaterThan(0);
    expect(faceAt(arr, f.center)).toBe(f.follow >= 0 ? f.follow : f.id);
    if (f.follow >= 0) expect(arr.faces[f.follow]!.follow).toBe(-1);
  }
  const all = outline(arr, arr.faces.map((f) => f.id));
  expect(ringsToPath(all)).not.toMatch(/NaN|Infinity/);
}

describe('adversarial inputs', () => {
  for (const off of [0, 1e-9, 1e-7, 1e-5, 2e-4, 4.8828125e-4, 1e-3, 5e-3, 0.02, 0.06]) {
    it(`near-duplicate circles, offset ${off}`, () => {
      const arr = buildArrangement([guide('a', circle(500, 500, 200)), guide('b', circle(500 + off, 500 + off / 3, 200))]);
      sane(arr);
      expect(real(arr).length).toBe(1);
      const total = arr.faces.reduce((s, f) => s + f.area, 0);
      expect(rel(total, Math.PI * 200 * 200)).toBeLessThan(1e-3);
      // tapping the disc takes its slivers along, leaving one clean outline
      const rings = outline(arr, withFollowers(arr, [real(arr)[0]!.id]));
      expect(rel(ringsArea(rings), Math.PI * 200 * 200)).toBeLessThan(1e-3);
    });
  }

  it('near-duplicate circle visibly apart keeps its crescents', () => {
    const arr = buildArrangement([guide('a', circle(500, 500, 200)), guide('b', circle(501, 500, 200))]);
    sane(arr);
    expect(real(arr).length).toBe(3);
  });

  it('a shape slightly shifted from its guide', () => {
    for (const off of [1e-4, 1e-3, 0.01]) {
      const arr = buildArrangement([
        guide('a', circle(400, 500, 200)),
        guide('b', circle(600, 500, 200)),
        shape('s', circle(400 + off, 500, 200)),
      ]);
      sane(arr);
      expect(real(arr).length).toBe(3);
    }
  });

  it('many concentric circles', () => {
    const src: Source[] = [];
    for (let i = 1; i <= 12; i++) src.push(guide(`c${i}`, circle(500, 500, i * 30)));
    const arr = buildArrangement(src);
    sane(arr);
    expect(arr.faces.length).toBe(12);
    expect(arr.faces.filter((f) => f.loops.length === 2).length).toBe(11);
  });

  it('circles all through one point', () => {
    const src: Source[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8;
      src.push(guide(`c${i}`, circle(500 + 150 * Math.cos(a), 500 + 150 * Math.sin(a), 150)));
    }
    const arr = buildArrangement(src);
    sane(arr);
    // rosette: 8 petals × 4 layers (the centre is a single shared point)
    expect(real(arr).length).toBe(32);
  });

  it('a lattice of touching circles (many exact tangencies)', () => {
    const src: Source[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) src.push(guide(`c${i}${j}`, circle(200 + i * 160, 200 + j * 160, 80)));
    const arr = buildArrangement(src);
    sane(arr);
    // 16 discs + 9 four-cornered gaps between them
    expect(real(arr).length).toBe(25);
  });

  it('a grid of lines', () => {
    const src: Source[] = [];
    for (let i = 0; i <= 10; i++) {
      src.push(guide(`h${i}`, seg(100, 100 + i * 80, 900, 100 + i * 80)));
      src.push(guide(`v${i}`, seg(100 + i * 80, 100, 100 + i * 80, 900)));
    }
    const arr = buildArrangement(src);
    sane(arr);
    expect(arr.faces.length).toBe(100);
    for (const f of arr.faces) expect(f.area).toBeCloseTo(6400, 6);
    expect(outline(arr, arr.faces.map((f) => f.id))[0]!.length).toBe(4);
  });

  it('collinear overlapping segments and shared endpoints', () => {
    const arr = buildArrangement([
      guide('a', seg(100, 500, 700, 500)),
      guide('b', seg(400, 500, 900, 500)),
      guide('c', seg(100, 500, 500, 100)),
      guide('d', seg(500, 100, 900, 500)),
      guide('e', seg(500, 100, 500, 500)),
    ]);
    sane(arr);
    expect(arr.faces.length).toBe(2);
    expect(arr.faces[0]!.area + arr.faces[1]!.area).toBeCloseTo(0.5 * 800 * 400, 6);
  });

  it('identical polygons and polygons sharing edges', () => {
    const arr = buildArrangement([
      guide('a', rect(400, 400, 200, 200)),
      shape('b', rect(400, 400, 200, 200)),
      guide('c', rect(600, 400, 200, 200)),
      guide('d', rect(500, 600, 400, 200)),
    ]);
    sane(arr);
    expect(arr.faces.length).toBe(3);
    expect(arr.faces.filter((f) => f.inside.includes('b')).length).toBe(1);
    expect(outline(arr, arr.faces.map((f) => f.id))[0]!.length).toBe(4);
  });

  it('a tiny circle and a huge one', () => {
    const tiny = buildArrangement([guide('t', circle(500, 500, 0.01)), guide('c', circle(500, 500, 100))], { bounds: ARTBOARD });
    sane(tiny);
    expect(real(tiny).length).toBe(1);

    const huge = buildArrangement([guide('art', rect(512, 512, 1024, 1024)), guide('h', circle(512, 10300, 10000))], { bounds: ARTBOARD });
    sane(huge);
    // two halves of the artboard, plus the rest of the disc around it
    expect(real(huge).length).toBe(3);
    const inArt = huge.faces.filter((f) => f.center.x > 0 && f.center.x < 1024 && f.center.y > 0 && f.center.y < 1024);
    expect(inArt.length).toBe(2);
    expect(rel(inArt[0]!.area + inArt[1]!.area, 1024 * 1024)).toBeLessThan(1e-6);
    // the big arc still exports as a true arc of the original circle
    const top = outline(huge, [faceAt(huge, { x: 512, y: 100 })]);
    expect(top[0]!.some((e) => e.c.k === 'E' && e.c.rx === 10000)).toBe(true);
  });

  it('lines running far outside the working area', () => {
    const arr = buildArrangement(
      [
        guide('art', rect(512, 512, 1024, 1024)),
        guide('l1', seg(-50000, 300, 50000, 700)),
        guide('l2', seg(400, -40000, 600, 40000)),
        guide('l3', seg(-3000, 5000, 5000, -3000)),
        guide('far', seg(-5000, 500, 500, -5000)),
      ],
      { bounds: ARTBOARD },
    );
    sane(arr);
    const inArt = arr.faces.filter((f) => f.center.x > 0 && f.center.x < 1024 && f.center.y > 0 && f.center.y < 1024);
    expect(rel(inArt.reduce((s, f) => s + f.area, 0), 1024 * 1024)).toBeLessThan(1e-6);
    // l1 and l2 quarter the artboard, l3 clips one corner, `far` misses it
    expect(inArt.length).toBe(5);
  });

  it('a shape reaching outside the working area keeps its winding', () => {
    const arr = buildArrangement([shape('big', poly(-9000, 200, 9000, 200, 9000, 800, -9000, 800)), guide('c', circle(512, 512, 100))], {
      bounds: ARTBOARD,
    });
    sane(arr);
    expect(arr.faces[faceAt(arr, { x: 512, y: 512 })]!.inside).toEqual(['big']);
    expect(arr.faces[faceAt(arr, { x: 100, y: 500 })]!.inside).toEqual(['big']);
    expect(faceAt(arr, { x: 100, y: 100 })).toBe(-1);
  });

  it('thin ellipses and nearly parallel lines', () => {
    const arr = buildArrangement([
      guide('e1', ellipseChain(500, 500, 400, 3, 0.2)),
      guide('e2', ellipseChain(500, 500, 400, 3, 0.2005)),
      guide('l1', seg(100, 300, 900, 300.0004)),
      guide('l2', seg(100, 300.0002, 900, 300)),
      guide('c', circle(500, 400, 250)),
    ]);
    sane(arr);
  });

  it('degenerate edges are ignored', () => {
    const arr = buildArrangement([
      guide('z', seg(300, 300, 300, 300)),
      { id: 'e', fill: false, chains: [{ closed: true, edges: [] }] },
      { id: 'n', fill: true, chains: [{ closed: true, edges: [{ c: { k: 'E', cx: 0, cy: 0, rx: 0, ry: 0, rot: 0 }, t0: 0, t1: 6 }] }] },
      guide('c', circle(500, 500, 100)),
    ]);
    sane(arr);
    expect(arr.faces.length).toBe(1);
  });
});
