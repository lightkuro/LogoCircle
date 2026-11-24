import { describe, expect, it } from 'vitest';
import { edgeEnd, edgeStart } from '@/geom';
import { newDoc } from './doc';
import { applyFillet, crossingAt, maxFillet } from './fillet';
import type { Doc, EdgesGuide, LineGuide } from './types';

const line = (id: string, x0: number, y0: number, x1: number, y1: number): LineGuide => ({ id, type: 'line', x0, y0, x1, y1, width: 0 });
const near = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('fillet', () => {
  it('rounds the corner where two lines meet, cutting them back to the arc', () => {
    // an L: along the top to the corner at (100, 0), then down
    const doc: Doc = { ...newDoc(), guides: [line('h', 0, 0, 100, 0), line('v', 100, 0, 100, 100)] };
    const c = crossingAt(doc.guides, { x: 98, y: 2 }, 6)!;
    expect(c).not.toBeNull();
    expect(maxFillet(c)).toBeCloseTo(100, 6);
    const next = applyFillet(doc, c, 20);
    const h = next.guides.find((g) => g.id === 'h') as LineGuide;
    const v = next.guides.find((g) => g.id === 'v') as LineGuide;
    expect(h.x1).toBeCloseTo(80, 6);
    expect(v.y0).toBeCloseTo(20, 6);
    const arc = next.guides.find((g) => g.type === 'edges') as EdgesGuide;
    near(edgeStart(arc.edges[0]!), { x: 80, y: 0 });
    near(edgeEnd(arc.edges[0]!), { x: 100, y: 20 });
  });

  it('rounds one corner of a crossing, on the side clicked; the other arms stay', () => {
    const doc: Doc = { ...newDoc(), guides: [line('h', 0, 50, 100, 50), line('v', 50, 0, 50, 100)] };
    const c = crossingAt(doc.guides, { x: 53, y: 53 }, 6)!; // the lower right corner
    const next = applyFillet(doc, c, 10);
    const lines = next.guides.filter((g) => g.type === 'line') as LineGuide[];
    // each line keeps its far arm and loses 10 units into the corner
    expect(lines).toHaveLength(4);
    const arc = next.guides.find((g) => g.type === 'edges') as EdgesGuide;
    near(edgeStart(arc.edges[0]!), { x: 60, y: 50 });
    near(edgeEnd(arc.edges[0]!), { x: 50, y: 60 });
  });

  it('finds nothing away from a crossing, and keeps the radius within the lines', () => {
    const doc: Doc = { ...newDoc(), guides: [line('h', 0, 0, 100, 0), line('v', 100, 0, 100, 100)] };
    expect(crossingAt(doc.guides, { x: 50, y: 50 }, 6)).toBeNull();
    const next = applyFillet(doc, crossingAt(doc.guides, { x: 99, y: 1 }, 6)!, 1000);
    expect(next.guides.filter((g) => g.type === 'line')).toHaveLength(0);
  });
});
