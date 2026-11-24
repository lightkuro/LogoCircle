import { describe, expect, it } from 'vitest';
import { newDoc } from './doc';
import { applyPattern, defaultPattern, patternMatrices } from './pattern';
import type { Doc, EllipseGuide } from './types';

const circle = (id: string, cx: number, cy: number, r: number): EllipseGuide => ({ id, type: 'ellipse', cx, cy, rx: r, ry: r, rot: 0, width: 0 });
const doc = (): Doc => ({ ...newDoc(), guides: [circle('c', 100, 100, 10)] });
const centres = (d: Doc): [number, number][] => d.guides.map((g) => [Math.round((g as EllipseGuide).cx), Math.round((g as EllipseGuide).cy)]);

describe('patterns', () => {
  it('a row: copies along a direction with a gap between them', () => {
    const r = applyPattern(doc(), ['c'], { kind: 'row', count: 3, rows: 1, distance: 5, angle: 0 });
    expect(r.ids).toHaveLength(2);
    expect(centres(r.doc)).toEqual([
      [100, 100],
      [125, 100],
      [150, 100],
    ]);
  });

  it('a row can run downwards', () => {
    const r = applyPattern(doc(), ['c'], { kind: 'row', count: 2, rows: 1, distance: 0, angle: 90 });
    expect(centres(r.doc)[1]).toEqual([100, 120]);
  });

  it('a circle: evenly around a centre below the original', () => {
    const r = applyPattern(doc(), ['c'], { kind: 'circle', count: 4, rows: 1, distance: 50, angle: 0 });
    expect(centres(r.doc)).toEqual([
      [100, 100],
      [150, 150],
      [100, 200],
      [50, 150],
    ]);
  });

  it('a grid: across and down', () => {
    const r = applyPattern(doc(), ['c'], { kind: 'grid', count: 3, rows: 2, distance: 0, angle: 0 });
    expect(r.ids).toHaveLength(5);
    expect(centres(r.doc)).toContainEqual([140, 120]);
  });

  it('one in all is just the original', () => {
    expect(patternMatrices({ kind: 'row', count: 1, rows: 1, distance: 0, angle: 0 }, { x: 0, y: 0, w: 10, h: 10 })).toHaveLength(0);
    expect(defaultPattern('circle', { x: 0, y: 0, w: 10, h: 10 }).count).toBe(8);
  });
});
