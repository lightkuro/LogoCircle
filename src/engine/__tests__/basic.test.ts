import { describe, expect, it } from 'vitest';
import { ellipseChain } from '@/geom';
import { buildArrangement, faceAt, neighbors } from '../index';
import { areas, circle, guide, lensArea, poly, real, rect, rel, seg } from './helpers';

describe('faces: hand cases', () => {
  it('two overlapping circles → 3 faces with analytic areas', () => {
    const arr = buildArrangement([guide('a', circle(400, 500, 200)), guide('b', circle(600, 500, 200))]);
    expect(real(arr).length).toBe(3);
    expect(arr.faces.length).toBe(3);
    const lens = lensArea(200, 200, 200);
    const moon = Math.PI * 200 * 200 - lens;
    const got = areas(arr);
    expect(rel(got[0]!, lens)).toBeLessThan(5e-4);
    expect(rel(got[1]!, moon)).toBeLessThan(5e-4);
    expect(rel(got[2]!, moon)).toBeLessThan(5e-4);
  });

  it('circle + chord line → 2 faces', () => {
    const arr = buildArrangement([guide('c', circle(500, 500, 200)), guide('l', seg(200, 450, 800, 450))]);
    expect(real(arr).length).toBe(2);
    expect(rel(arr.faces.reduce((s, f) => s + f.area, 0), Math.PI * 200 * 200)).toBeLessThan(5e-4);
  });

  it('a dangling segment does not split a face', () => {
    const arr = buildArrangement([guide('c', circle(500, 500, 200)), guide('l', seg(450, 500, 550, 520))]);
    expect(arr.faces.length).toBe(1);
    const half = buildArrangement([guide('c', circle(500, 500, 200)), guide('l', seg(100, 500, 520, 500))]);
    expect(half.faces.length).toBe(1);
  });

  it('a segment crossing boundary to boundary adds exactly one face', () => {
    const one = buildArrangement([guide('c', circle(500, 500, 200))]);
    const two = buildArrangement([guide('c', circle(500, 500, 200)), guide('l', seg(250, 300, 760, 640))]);
    expect(two.faces.length).toBe(one.faces.length + 1);
  });

  it('concentric circles → the ring face has a hole', () => {
    const arr = buildArrangement([guide('a', circle(500, 500, 200)), guide('b', circle(500, 500, 100))]);
    expect(arr.faces.length).toBe(2);
    const ring = arr.faces.find((f) => f.loops.length === 2)!;
    expect(ring).toBeDefined();
    expect(rel(ring.area, Math.PI * (200 * 200 - 100 * 100))).toBeLessThan(5e-4);
    expect(neighbors(arr, ring.id).length).toBe(1);
  });

  it('a lone square inside a circle nests as a hole', () => {
    const arr = buildArrangement([guide('c', circle(500, 500, 300)), guide('s', rect(520, 480, 100, 100))]);
    expect(arr.faces.length).toBe(2);
    const outer = arr.faces.find((f) => f.loops.length === 2)!;
    expect(rel(outer.area, Math.PI * 300 * 300 - 100 * 100)).toBeLessThan(5e-4);
    const inner = arr.faces.find((f) => f.loops.length === 1)!;
    expect(rel(inner.area, 100 * 100)).toBeLessThan(1e-6);
    expect(faceAt(arr, { x: 520, y: 480 })).toBe(inner.id);
    expect(faceAt(arr, { x: 300, y: 500 })).toBe(outer.id);
    expect(faceAt(arr, { x: 10, y: 10 })).toBe(-1);
  });

  it('a lone segment far inside another face does not confuse nesting', () => {
    const arr = buildArrangement([
      guide('c', circle(500, 500, 300)),
      guide('l', seg(450, 500, 550, 500)),
      guide('s', rect(600, 500, 40, 40)),
    ]);
    expect(arr.faces.length).toBe(2);
    expect(arr.faces.some((f) => f.loops.length === 2)).toBe(true);
  });

  for (const eps of [0, 1e-9, -1e-9, 1e-6, -1e-6, 1e-3, -1e-3]) {
    it(`externally tangent circles (gap ${eps}) → 2 tappable faces`, () => {
      const arr = buildArrangement([guide('a', circle(300, 500, 150)), guide('b', circle(300 + 150 + 120 + eps, 500, 120))]);
      expect(real(arr).length).toBe(2);
      const total = real(arr).reduce((s, f) => s + f.area, 0);
      expect(rel(total, Math.PI * (150 * 150 + 120 * 120))).toBeLessThan(1e-3);
    });
    it(`internally tangent circles (gap ${eps}) → 2 tappable faces`, () => {
      const arr = buildArrangement([guide('a', circle(500, 500, 200)), guide('b', circle(500 + 200 - 80 + eps, 500, 80))]);
      expect(real(arr).length).toBe(2);
      const got = areas(arr);
      expect(rel(got[0]!, Math.PI * 80 * 80)).toBeLessThan(2e-3);
      expect(rel(got[1]!, Math.PI * (200 * 200 - 80 * 80))).toBeLessThan(2e-3);
    });
  }

  it('duplicate identical circles behave as one', () => {
    const one = buildArrangement([guide('a', circle(500, 500, 200))]);
    const two = buildArrangement([guide('a', circle(500, 500, 200)), guide('b', circle(500, 500, 200))]);
    expect(two.faces.length).toBe(1);
    expect(two.faces[0]!.area).toBe(one.faces[0]!.area);
  });

  it('two rotated ellipses cross four times → 5 faces', () => {
    const arr = buildArrangement([
      guide('a', ellipseChain(500, 500, 300, 120, 0.3)),
      guide('b', ellipseChain(500, 500, 300, 120, 0.3 + Math.PI / 2)),
    ]);
    expect(real(arr).length).toBe(5);
    expect(arr.faces.length).toBe(5);
  });

  it('rectangles sharing part of an edge (collinear overlap)', () => {
    const arr = buildArrangement([guide('a', rect(300, 300, 200, 200)), guide('b', rect(500, 350, 200, 200))]);
    expect(arr.faces.length).toBe(2);
    expect(areas(arr).map((a) => Math.round(a))).toEqual([40000, 40000]);
    expect(neighbors(arr, 0)).toEqual([1]);
  });

  it('a pencil of 6 lines through one point inside a circle → 12 faces', () => {
    const src = [guide('c', circle(500, 500, 300))];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 6 + 0.1;
      src.push(guide(`l${i}`, seg(500 - 400 * Math.cos(a), 500 - 400 * Math.sin(a), 500 + 400 * Math.cos(a), 500 + 400 * Math.sin(a))));
    }
    const arr = buildArrangement(src);
    expect(real(arr).length).toBe(12);
    for (const f of real(arr)) expect(rel(f.area, (Math.PI * 300 * 300) / 12)).toBeLessThan(2e-3);
  });

  it('a triangle from three long lines', () => {
    const arr = buildArrangement([
      guide('a', seg(100, 800, 900, 800)),
      guide('b', seg(150, 900, 550, 100)),
      guide('c', seg(850, 900, 450, 100)),
    ]);
    expect(arr.faces.length).toBe(1);
    // corners: (200,800), (800,800), (500,200)
    expect(rel(arr.faces[0]!.area, 0.5 * 600 * 600)).toBeLessThan(1e-5);
  });

  it('polygon touching a circle at a vertex', () => {
    const arr = buildArrangement([guide('c', circle(500, 500, 200)), guide('p', poly(700, 500, 900, 400, 900, 600))]);
    expect(real(arr).length).toBe(2);
  });

  it('empty input', () => {
    const arr = buildArrangement([]);
    expect(arr.faces).toEqual([]);
    expect(faceAt(arr, { x: 0, y: 0 })).toBe(-1);
  });
});
