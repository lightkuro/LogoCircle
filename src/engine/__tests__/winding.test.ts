import { describe, expect, it } from 'vitest';
import { reverseRing } from '@/geom';
import type { Ring } from '@/geom';
import { booleanOp, buildArrangement, faceAt, normalizeRings, outline } from '../index';
import { circle, guide, lensArea, poly, rect, rel, ringsArea, shape, shapeOfRings } from './helpers';

describe('winding: which shapes contain a face', () => {
  it('a letter-like shape with a counter', () => {
    const outer = circle(500, 500, 200).edges;
    const counter = reverseRing(circle(500, 500, 80).edges);
    const arr = buildArrangement([shapeOfRings('o', [outer, counter])]);
    expect(arr.faces.length).toBe(2);
    const hole = arr.faces[faceAt(arr, { x: 500, y: 500 })]!;
    const body = arr.faces[faceAt(arr, { x: 500, y: 350 })]!;
    expect(hole.inside).toEqual([]);
    expect(body.inside).toEqual(['o']);
  });

  it('overlapping same-direction contours fill their overlap (nonzero)', () => {
    const arr = buildArrangement([shape('s', circle(420, 500, 150), circle(580, 500, 150))]);
    expect(arr.faces.length).toBe(3);
    for (const f of arr.faces) expect(f.inside).toEqual(['s']);
  });

  it('guides and open chains never count as inside', () => {
    const arr = buildArrangement([guide('g', circle(500, 500, 200)), shape('s', rect(500, 500, 100, 100))]);
    const inner = arr.faces[faceAt(arr, { x: 500, y: 500 })]!;
    const outer = arr.faces[faceAt(arr, { x: 500, y: 330 })]!;
    expect(inner.inside).toEqual(['s']);
    expect(outer.inside).toEqual([]);
  });

  it('stacked shapes report every container', () => {
    const arr = buildArrangement([
      shape('a', rect(450, 500, 300, 300)),
      shape('b', rect(550, 500, 300, 300)),
      shape('c', circle(500, 500, 60)),
    ]);
    const mid = arr.faces[faceAt(arr, { x: 500, y: 500 })]!;
    expect(mid.inside).toEqual(['a', 'b', 'c']);
    expect(arr.faces[faceAt(arr, { x: 320, y: 500 })]!.inside).toEqual(['a']);
    expect(arr.faces[faceAt(arr, { x: 680, y: 500 })]!.inside).toEqual(['b']);
  });

  it('a shape nested in the hole of another', () => {
    const ring: Ring[] = [circle(500, 500, 300).edges, reverseRing(circle(500, 500, 200).edges)];
    const arr = buildArrangement([shapeOfRings('ring', ring), shape('dot', circle(500, 500, 50))]);
    expect(arr.faces[faceAt(arr, { x: 500, y: 500 })]!.inside).toEqual(['dot']);
    expect(arr.faces[faceAt(arr, { x: 500, y: 620 })]!.inside).toEqual([]);
    expect(arr.faces[faceAt(arr, { x: 500, y: 750 })]!.inside).toEqual(['ring']);
  });
});

describe('boolean operations', () => {
  const a = [circle(400, 500, 200).edges];
  const b = [circle(600, 500, 200).edges];
  const disc = Math.PI * 200 * 200;
  const lens = lensArea(200, 200, 200);

  it('two circles', () => {
    expect(rel(ringsArea(booleanOp('unite', a, b)), 2 * disc - lens)).toBeLessThan(1e-5);
    expect(rel(ringsArea(booleanOp('intersect', a, b)), lens)).toBeLessThan(1e-5);
    expect(rel(ringsArea(booleanOp('subtract', a, b)), disc - lens)).toBeLessThan(1e-5);
    expect(rel(ringsArea(booleanOp('exclude', a, b)), 2 * (disc - lens))).toBeLessThan(1e-5);
    expect(booleanOp('unite', a, b)[0]!.length).toBe(2);
    expect(booleanOp('exclude', a, b).length).toBe(2);
  });

  it('circle and square', () => {
    const c = [circle(500, 500, 100).edges];
    const s = [rect(500, 500, 400, 400).edges];
    expect(rel(ringsArea(booleanOp('subtract', s, c)), 160000 - Math.PI * 10000)).toBeLessThan(1e-5);
    expect(booleanOp('subtract', s, c).length).toBe(2);
    expect(rel(ringsArea(booleanOp('intersect', s, c)), Math.PI * 10000)).toBeLessThan(1e-5);
    expect(booleanOp('subtract', c, s)).toEqual([]);
    const s2 = [rect(500, 600, 150, 150).edges];
    const u = booleanOp('unite', c, s2);
    expect(u.length).toBe(1);
    expect(u[0]!.filter((e) => e.c.k === 'L').length).toBe(3);
    expect(u[0]!.filter((e) => e.c.k === 'E').length).toBe(1);
  });

  it('disjoint operands', () => {
    const far = [circle(1500, 500, 50).edges];
    expect(booleanOp('intersect', a, far)).toEqual([]);
    expect(booleanOp('unite', a, far).length).toBe(2);
    expect(rel(ringsArea(booleanOp('subtract', a, far)), disc)).toBeLessThan(1e-9);
  });

  it('normalizeRings resolves a figure-eight', () => {
    // A bow-tie: self-crossing quadrilateral.
    const bow = poly(300, 300, 700, 700, 700, 300, 300, 700).edges;
    const out = normalizeRings([bow]);
    expect(out.length).toBe(2);
    for (const r of out) expect(r.length).toBe(3);
    expect(rel(ringsArea(out), 2 * 0.5 * 400 * 200)).toBeLessThan(1e-6);
  });

  it('normalizeRings merges overlapping contours', () => {
    const out = normalizeRings([circle(420, 500, 150).edges, circle(580, 500, 150).edges]);
    expect(out.length).toBe(1);
    expect(out[0]!.length).toBe(2);
  });

  it('booleans of baked outlines stay exact', () => {
    const arr = buildArrangement([guide('a', circle(400, 500, 200)), guide('b', circle(600, 500, 200))]);
    const sorted = [...arr.faces].sort((p, q) => p.area - q.area);
    const lensRings = outline(arr, [sorted[0]!.id]);
    const moon = outline(arr, [sorted[1]!.id]);
    const u = booleanOp('unite', lensRings, moon);
    expect(u.length).toBe(1);
    expect(u[0]!.length).toBe(1);
    expect(rel(ringsArea(u), disc)).toBeLessThan(1e-6);
  });
});
