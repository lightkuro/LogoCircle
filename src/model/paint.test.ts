import { describe, expect, it } from 'vitest';
import { faceAt } from '@/engine';
import { ellipseChain, polygonChain, ringArea } from '@/geom';
import { newDoc } from './doc';
import { buildDocArrangement, paintFaces } from './paint';
import type { Doc, Guide, Shape } from './types';

const circle = (id: string, cx: number, cy: number, r: number): Guide => ({ id, type: 'ellipse', cx, cy, rx: r, ry: r, rot: 0 });
const hline = (id: string, y: number, x0 = 0, x1 = 1024): Guide => ({ id, type: 'line', x0, y0: y, x1, y1: y, width: 0 });

function withGuides(...guides: Guide[]): Doc {
  return { ...newDoc(), guides };
}

/** Color (or erase, with fill null) the areas under the given points, as one stroke. */
function paintAt(doc: Doc, points: [number, number][], fill: number | null): Doc {
  const arr = buildDocArrangement(doc, true);
  const faces = points.map(([x, y]) => faceAt(arr, { x, y }));
  expect(faces.every((f) => f >= 0)).toBe(true);
  return paintFaces(doc, arr, faces, fill);
}

const area = (s: Shape): number => Math.abs(s.rings.reduce((a, r) => a + ringArea(r, 0.01), 0));
/** Areas are measured on a fine polygon, so compare to a part in a thousand. */
const near = (got: number, want: number): void => expect(Math.abs(got - want) / want).toBeLessThan(1e-3);

describe('paintFaces', () => {
  const two = withGuides(circle('a', 400, 500, 200), circle('b', 600, 500, 200));

  it('colors one area as one shape', () => {
    const doc = paintAt(two, [[500, 500]], 0);
    expect(doc.shapes).toHaveLength(1);
    expect(doc.shapes[0]!.fill).toBe(0);
    // lens of two r=200 circles 200 apart
    const lens = 2 * 200 * 200 * Math.acos(0.5) - (200 / 2) * Math.sqrt(4 * 200 * 200 - 200 * 200);
    near(area(doc.shapes[0]!), lens);
  });

  it('merges a neighbouring area of the same color into the same shape', () => {
    const one = paintAt(two, [[500, 500]], 0);
    const merged = paintAt(one, [[300, 500]], 0);
    expect(merged.shapes).toHaveLength(1);
    expect(merged.shapes[0]!.id).toBe(one.shapes[0]!.id);
    near(area(merged.shapes[0]!), Math.PI * 200 * 200);
    // the merged shape is the whole left circle: a single full-turn edge
    expect(merged.shapes[0]!.rings).toHaveLength(1);
    expect(merged.shapes[0]!.rings[0]).toHaveLength(1);
  });

  it('keeps a neighbouring area of another color separate', () => {
    const doc = paintAt(paintAt(two, [[500, 500]], 0), [[300, 500]], 1);
    expect(doc.shapes.map((s) => s.fill).sort()).toEqual([0, 1]);
  });

  it('makes separate shapes for separate areas colored in one stroke', () => {
    const doc = paintAt(two, [[300, 500], [700, 500]], 0);
    expect(doc.shapes).toHaveLength(2);
  });

  it('recoloring cuts the area out of the shape it belonged to', () => {
    const whole = paintAt(two, [[300, 500], [500, 500]], 0);
    expect(whole.shapes).toHaveLength(1);
    const doc = paintAt(whole, [[500, 500]], 2);
    expect(doc.shapes).toHaveLength(2);
    const total = doc.shapes.reduce((a, s) => a + area(s), 0);
    near(total, Math.PI * 200 * 200);
  });

  it('does nothing when the area already has that color', () => {
    const one = paintAt(two, [[500, 500]], 0);
    expect(paintAt(one, [[500, 500]], 0)).toBe(one);
  });

  it('erasing after coloring leaves nothing behind', () => {
    const doc = paintAt(paintAt(two, [[500, 500], [300, 500]], 1), [[500, 500], [300, 500]], null);
    expect(doc.shapes).toHaveLength(0);
  });

  it('erasing a band across a shape leaves two pieces', () => {
    const base = withGuides(circle('a', 500, 500, 200), hline('l1', 470), hline('l2', 530));
    const full = paintAt(base, [[500, 400], [500, 500], [500, 600]], 0);
    expect(full.shapes).toHaveLength(1);
    const cut = paintAt(full, [[500, 500]], null);
    expect(cut.shapes).toHaveLength(2);
    expect(cut.shapes[0]!.id).toBe(full.shapes[0]!.id);
  });

  it('a shape made of two islands stays one shape when a cut does not split it further', () => {
    // like the letter i: a dot and a stem in one shape
    const dot = ellipseChain(300, 300, 40, 40).edges;
    const stem = polygonChain([{ x: 260, y: 400 }, { x: 340, y: 400 }, { x: 340, y: 700 }, { x: 260, y: 700 }]).edges;
    const letter: Shape = { id: 'i', rings: [dot, stem], fill: 0 };
    const doc: Doc = { ...newDoc(), shapes: [letter], guides: [hline('l', 650, 200, 400)] };
    const cut = paintAt(doc, [[300, 680]], null);
    expect(cut.shapes).toHaveLength(1);
    expect(cut.shapes[0]!.rings).toHaveLength(2);
  });

  it('an untouched shape is left exactly as it was', () => {
    const one = paintAt(two, [[300, 500]], 0);
    const doc = paintAt(one, [[700, 500]], 1);
    expect(doc.shapes.find((s) => s.id === one.shapes[0]!.id)).toBe(one.shapes[0]);
  });

  it('a line that stops just short of an outline still closes the area', () => {
    // the chord ends 2 units inside the circle on both sides
    const r = 200;
    const half = Math.sqrt(r * r - 50 * 50) - 2;
    const doc = withGuides(circle('a', 500, 500, r), { id: 'l', type: 'line', x0: 500 - half, y0: 450, x1: 500 + half, y1: 450, width: 0 });
    const arr = buildDocArrangement(doc, true);
    expect(faceAt(arr, { x: 500, y: 350 })).not.toBe(faceAt(arr, { x: 500, y: 600 }));
  });

  it('the open background is not an area', () => {
    const arr = buildDocArrangement(two, true);
    expect(faceAt(arr, { x: 50, y: 50 })).toBe(-1);
  });

  it('hidden outlines do not divide anything', () => {
    const doc = paintAt(two, [[500, 500]], 0);
    const arr = buildDocArrangement(doc, false);
    expect(arr.faces.filter((f) => f.follow < 0)).toHaveLength(1);
  });

  it('cutting a letter marks its word as no longer retypable', () => {
    const letter: Shape = { id: 'o', rings: [ellipseChain(500, 500, 100, 100).edges], fill: 0, group: 'w' };
    const doc: Doc = {
      ...newDoc(),
      shapes: [letter],
      groups: { w: { id: 'w', kind: 'text', text: { value: 'o', fontId: 'poppins', size: 200, spacing: 0, fill: 0, m: [1, 0, 0, 1, 0, 0], pristine: true } } },
      guides: [circle('c', 560, 440, 60)],
    };
    const cut = paintAt(doc, [[550, 450]], null);
    expect(cut.groups.w!.text!.pristine).toBe(false);
    expect(cut.shapes[0]!.group).toBe('w');
  });

  it('coloring keeps groups made only of outlines', () => {
    const doc: Doc = { ...withGuides({ ...circle('a', 400, 500, 100), group: 'g' }, { ...circle('b', 700, 500, 100), group: 'g' }), groups: { g: { id: 'g', kind: 'group', name: 'Group' } } };
    expect(paintAt(doc, [[400, 500]], 0).groups.g).toBeDefined();
  });
});
