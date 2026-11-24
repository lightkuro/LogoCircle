import { describe, expect, it } from 'vitest';
import { faceAt } from '@/engine';
import { ringArea, ringsBBox, roundedPolygonChain, translate } from '@/geom';
import { newDoc } from './doc';
import { cutAlong } from './cut';
import { guideArea } from './guides';
import { syncLinks } from './link';
import { removeColor, removeItems, transformItems } from './ops';
import { buildDocArrangement, paintFaces } from './paint';
import type { Doc, Guide, Shape } from './types';

const circle = (id: string, cx: number, cy: number, r: number, width = 0): Guide => ({ id, type: 'ellipse', cx, cy, rx: r, ry: r, rot: 0, width });
const area = (s: Shape): number => Math.abs(s.rings.reduce((a, r) => a + ringArea(r, 0.01), 0));
const near = (got: number, want: number): void => expect(Math.abs(got - want) / want).toBeLessThan(2e-3);

function paintAt(doc: Doc, points: [number, number][], fill: number | null): Doc {
  const arr = buildDocArrangement(doc, true);
  return paintFaces(doc, arr, points.map(([x, y]) => faceAt(arr, { x, y })), fill);
}
/** Apply a change the way the app does: linked fills are brought back in step afterwards. */
const apply = (doc: Doc, change: (d: Doc) => Doc): Doc => syncLinks(doc, change(doc));

const R = 200;
const DISC = Math.PI * R * R;
const LENS = 2 * R * R * Math.acos(0.5) - (R / 2) * Math.sqrt(4 * R * R - R * R);
const two = (): Doc => ({ ...newDoc(), guides: [circle('a', 400, 500, R), circle('b', 600, 500, R)] });

describe('fills follow their outlines', () => {
  it('a colored area remembers the outlines around it', () => {
    const doc = paintAt(two(), [[300, 500]], 0);
    const from = doc.shapes[0]!.from;
    expect(from && 'guides' in from && [...from.guides].sort()).toEqual(['a', 'b']);
  });

  it('moving one outline reshapes the fill between them', () => {
    const doc = paintAt(two(), [[300, 500]], 0); // the part of a outside b
    near(area(doc.shapes[0]!), DISC - LENS);
    // pull b clear of a: nothing is cut out of a any more
    const moved = apply(doc, (d) => transformItems(d, ['b'], translate(600, 0)));
    expect(moved.shapes).toHaveLength(1);
    near(area(moved.shapes[0]!), DISC);
    expect(moved.shapes[0]!.from).toBeTruthy();
    // and back again
    const back = apply(moved, (d) => transformItems(d, ['b'], translate(-600, 0)));
    near(area(back.shapes[0]!), DISC - LENS);
  });

  it('an overlap disappears when its outlines no longer overlap', () => {
    const doc = paintAt(two(), [[500, 500]], 1);
    near(area(doc.shapes[0]!), LENS);
    const apart = apply(doc, (d) => transformItems(d, ['b'], translate(600, 0)));
    expect(apart.shapes).toHaveLength(0);
  });

  it('dragging a fill carries its outlines with it', () => {
    const doc = paintAt(two(), [[300, 500]], 0);
    const id = doc.shapes[0]!.id;
    const moved = apply(doc, (d) => transformItems(d, [id], translate(50, -30)));
    const a = moved.guides.find((g) => g.id === 'a')!;
    const b = moved.guides.find((g) => g.id === 'b')!;
    expect(a.type === 'ellipse' && [a.cx, a.cy]).toEqual([450, 470]);
    expect(b.type === 'ellipse' && [b.cx, b.cy]).toEqual([650, 470]);
    const before = ringsBBox(doc.shapes[0]!.rings);
    const after = ringsBBox(moved.shapes[0]!.rings);
    expect(after.x - before.x).toBeCloseTo(50, 1);
    expect(after.y - before.y).toBeCloseTo(-30, 1);
    near(area(moved.shapes[0]!), DISC - LENS);
  });

  it('a fill keeps its look and stands alone once its outline is deleted', () => {
    const doc = paintAt(two(), [[300, 500]], 0);
    const gone = apply(doc, (d) => removeItems(d, ['b']));
    expect(gone.shapes).toHaveLength(1);
    expect(gone.shapes[0]!.from).toBeUndefined();
    near(area(gone.shapes[0]!), DISC - LENS);
  });

  it('a colored thick outline follows its thickness', () => {
    const g = circle('c', 500, 500, R, 40);
    const ring: Shape = { id: 's', rings: guideArea(g)!, fill: 0, from: { area: 'c' } };
    const doc: Doc = { ...newDoc(), guides: [g], shapes: [ring] };
    near(area(ring), Math.PI * (R * R - 160 * 160)); // thickens inward by default
    const thicker = apply(doc, (d) => ({ ...d, guides: [{ ...g, width: 100 } as Guide] }));
    near(area(thicker.shapes[0]!), Math.PI * (R * R - 100 * 100));
    const outward = apply(doc, (d) => ({ ...d, guides: [{ ...g, band: 'out' } as Guide] }));
    near(area(outward.shapes[0]!), Math.PI * (240 * 240 - R * R));
  });
});

describe('cutting', () => {
  const disc = (): Doc => paintAt({ ...newDoc(), guides: [circle('a', 500, 500, R)] }, [[500, 500]], 0);

  it('a line all the way across splits a shape into free pieces', () => {
    const doc = disc();
    const cut = cutAlong(doc, { x: 500, y: 200 }, { x: 500, y: 800 }, { outlines: true });
    expect(cut.shapes).toHaveLength(2);
    near(area(cut.shapes[0]!) + area(cut.shapes[1]!), DISC);
    near(area(cut.shapes[0]!), DISC / 2);
    expect(cut.shapes.every((s) => !s.from)).toBe(true);
    expect(cut.shapes[0]!.id).toBe(doc.shapes[0]!.id);
  });

  it('leaves a dashed cut line behind', () => {
    const cut = cutAlong(disc(), { x: 500, y: 200 }, { x: 500, y: 800 }, { outlines: true });
    expect(cut.guides.filter((g) => g.type === 'line' && g.cut)).toHaveLength(1);
  });

  it('splits the outline it crosses into segments', () => {
    const doc: Doc = { ...newDoc(), guides: [circle('a', 500, 500, R)] };
    const cut = cutAlong(doc, { x: 500, y: 200 }, { x: 500, y: 800 }, { outlines: true });
    const pieces = cut.guides.filter((g) => g.type === 'edges');
    expect(pieces).toHaveLength(2);
    expect(pieces.every((g) => g.type === 'edges' && !g.closed)).toBe(true);
    expect(pieces[0]!.id).toBe('a');
  });

  it('does nothing when the line stops short', () => {
    const doc = disc();
    const outlinesOff = cutAlong(doc, { x: 500, y: 450 }, { x: 500, y: 550 }, { outlines: false });
    expect(outlinesOff).toBe(doc);
  });

  it('a piece of a cut straight line is still a straight line', () => {
    const doc: Doc = { ...newDoc(), guides: [{ id: 'l', type: 'line', x0: 200, y0: 500, x1: 800, y1: 500, width: 0 }] };
    const cut = cutAlong(doc, { x: 500, y: 300 }, { x: 500, y: 700 }, { outlines: true });
    const lines = cut.guides.filter((g) => g.type === 'line' && !g.cut);
    expect(lines).toHaveLength(2);
    expect(lines.map((g) => (g.type === 'line' ? [g.x0, g.x1] : [])).flat().sort((a, b) => a - b)).toEqual([200, 500, 500, 800]);
  });

  it('a colored ring cut in two keeps no outline to drift away from', () => {
    const g = circle('c', 500, 500, R, 40);
    const doc: Doc = { ...newDoc(), guides: [g], shapes: [{ id: 's', rings: guideArea(g)!, fill: 0, from: { area: 'c' } }] };
    const cut = cutAlong(doc, { x: 200, y: 500 }, { x: 800, y: 500 }, { outlines: true });
    expect(cut.shapes).toHaveLength(2);
    expect(cut.guides.some((x) => x.id === 'c')).toBe(false);
  });
});

describe('rounded corners and colors', () => {
  it('rounds a square exactly', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const chain = roundedPolygonChain(pts, [20, 20, 20, 20]);
    expect(chain.edges).toHaveLength(8);
    expect(chain.edges.filter((e) => e.c.k === 'E')).toHaveLength(4);
    near(Math.abs(ringArea(chain.edges, 0.001)), 100 * 100 - (4 - Math.PI) * 20 * 20);
  });

  it('holds a corner back to half its shorter side', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }];
    const chain = roundedPolygonChain(pts, [500, 0, 0, 0]);
    const arc = chain.edges.find((e) => e.c.k === 'E')!;
    expect(arc.c.k === 'E' && arc.c.rx).toBeCloseTo(20, 6);
  });

  it('removing a swatch keeps what was painted with it', () => {
    const doc: Doc = { ...newDoc(), palette: ['#111111', '#ff0000', '#00ff00'], shapes: [{ id: 'a', rings: [], fill: 1 }, { id: 'b', rings: [], fill: 2 }] };
    const next = removeColor(doc, 1);
    expect(next.palette).toEqual(['#111111', '#00ff00']);
    expect(next.shapes.map((s) => s.fill)).toEqual(['#ff0000', 1]);
    expect(removeColor({ ...doc, palette: ['#111111'] }, 0).palette).toEqual(['#111111']);
  });
});
