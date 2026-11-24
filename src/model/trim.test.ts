import { describe, expect, it } from 'vitest';
import { flattenChain, ringArea } from '@/geom';
import { newDoc } from './doc';
import { cutAlong, cutMarks, markAt, outlinePieces, pieceAt, restoreMark, trimPiece } from './cut';
import { cornerRadius, guideArea, guideCenterline, setCornerRadius } from './guides';
import { transformGuide } from './guides';
import { colorize } from './trim.helpers';
import type { Doc, Guide, RectGuide, Shape } from './types';

const circle = (id: string, cx: number, cy: number, r: number, width = 0): Guide => ({ id, type: 'ellipse', cx, cy, rx: r, ry: r, rot: 0, width });
const line = (id: string, x0: number, y0: number, x1: number, y1: number, width = 0): Guide => ({ id, type: 'line', x0, y0, x1, y1, width });
const area = (s: Shape): number => Math.abs(s.rings.reduce((a, r) => a + ringArea(r, 0.01), 0));
const length = (g: Guide): number => {
  let len = 0;
  for (const c of guideCenterline(g)) {
    const pts = flattenChain(c, 0.05);
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return len;
};
const near = (got: number, want: number, tol = 5e-3): void => expect(Math.abs(got - want) / want).toBeLessThan(tol);

const R = 200;
const two = (): Doc => ({ ...newDoc(), guides: [circle('a', 400, 500, R), circle('b', 600, 500, R)] });

describe('trimming a piece of an outline', () => {
  it('divides outlines where they cross', () => {
    const pieces = outlinePieces(two().guides);
    // each circle is crossed twice by the other: two arcs each
    expect(pieces.filter((p) => p.guide === 'a')).toHaveLength(2);
    expect(pieces.filter((p) => p.guide === 'b')).toHaveLength(2);
  });

  it('an outline nothing crosses is one piece, and trimming it removes it', () => {
    const doc: Doc = { ...newDoc(), guides: [circle('a', 300, 300, 100), circle('far', 800, 800, 50)] };
    const piece = pieceAt(doc.guides, { x: 400, y: 300 }, 4)!;
    expect(piece.guide).toBe('a');
    expect(piece.of).toBe(1);
    const next = trimPiece(doc, doc.guides, piece);
    expect(next.guides.map((g) => g.id)).toEqual(['far']);
  });

  it('removes just the arc that was picked', () => {
    const doc = two();
    // the right-hand arc of a lies inside b
    const piece = pieceAt(doc.guides, { x: 600, y: 500 }, 4)!;
    expect(piece.guide).toBe('a');
    const next = trimPiece(doc, doc.guides, piece);
    expect(next.guides).toHaveLength(2);
    const rest = next.guides.find((g) => g.id !== 'b')!;
    expect(rest.type).toBe('edges');
    expect(rest.type === 'edges' && rest.closed).toBe(false);
    // the arc inside b spans 120 degrees: two thirds of the circle stay
    near(length(rest), ((2 * Math.PI * R) * 2) / 3);
    // b is untouched
    expect(next.guides.find((g) => g.id === 'b')).toBe(doc.guides[1]);
  });

  it('a line crossed twice loses its middle and stays two straight lines', () => {
    const doc: Doc = { ...newDoc(), guides: [circle('c', 500, 500, 100), line('l', 200, 500, 800, 500)] };
    const pieces = outlinePieces(doc.guides).filter((p) => p.guide === 'l');
    expect(pieces).toHaveLength(3);
    const next = trimPiece(doc, doc.guides, pieceAt(doc.guides, { x: 500, y: 500 }, 4)!);
    const lines = next.guides.filter((g) => g.type === 'line');
    expect(lines).toHaveLength(2);
    near(lines.reduce((a, g) => a + length(g), 0), 400);
  });

  it('prefers the piece nearest the pointer', () => {
    const doc: Doc = { ...newDoc(), guides: [circle('c', 500, 500, 100), line('l', 200, 500, 800, 500)] };
    expect(pieceAt(doc.guides, { x: 250, y: 501 }, 6)!.guide).toBe('l');
    expect(pieceAt(doc.guides, { x: 500, y: 401 }, 6)!.guide).toBe('c');
    expect(pieceAt(doc.guides, { x: 900, y: 900 }, 6)).toBeNull();
  });

  it('a fill that was following the outline keeps its look and lets go', () => {
    const doc = colorize(two(), [[300, 500]], 0);
    const before = area(doc.shapes[0]!);
    const next = trimPiece(doc, doc.guides, pieceAt(doc.guides, { x: 600, y: 500 }, 4)!);
    expect(next.shapes).toHaveLength(1);
    expect(next.shapes[0]!.from).toBeUndefined();
    near(area(next.shapes[0]!), before);
  });

  it('a colored thick ring loses the same piece', () => {
    const ring = circle('ring', 500, 500, 200, 40);
    const doc: Doc = {
      ...newDoc(),
      guides: [ring, line('l', 100, 500, 900, 500)],
      shapes: [{ id: 's', rings: guideArea(ring)!, fill: 0, from: { area: 'ring' } }],
    };
    const full = area(doc.shapes[0]!);
    // the ring's band lies inside the circle: its middle is at radius 180
    const piece = pieceAt(doc.guides, { x: 500, y: 320 }, 4)!;
    expect(piece.guide).toBe('ring');
    const next = trimPiece(doc, doc.guides, piece);
    expect(next.shapes).toHaveLength(1);
    const left = next.shapes[0]!;
    expect(left.from && 'area' in left.from && next.guides.some((g) => 'area' in left.from! && g.id === left.from.area)).toBe(true);
    // about half the ring is left (the round ends add a little)
    expect(area(left)).toBeGreaterThan(full * 0.45);
    expect(area(left)).toBeLessThan(full * 0.62);
  });
});

describe('bringing pieces back', () => {
  it('a removed piece is kept aside, not as an outline', () => {
    const doc = two();
    const next = trimPiece(doc, doc.guides, pieceAt(doc.guides, { x: 600, y: 500 }, 4)!);
    expect(next.trimmed).toHaveLength(1);
    expect(next.guides.some((g) => g.id === next.trimmed![0]!.id)).toBe(false);
    // a third of the circle
    near(length(next.trimmed![0]!), (2 * Math.PI * R) / 3);
  });

  it('can be brought back as an outline', () => {
    const doc = two();
    const cut = trimPiece(doc, doc.guides, pieceAt(doc.guides, { x: 600, y: 500 }, 4)!);
    const mark = markAt(cut, { x: 600, y: 500 }, 4)!;
    expect(mark.kind).toBe('trimmed');
    const back = restoreMark(cut, mark);
    expect(back.trimmed).toBeUndefined();
    expect(back.guides).toHaveLength(3);
    expect(back.guides.some((g) => g.id === mark.id)).toBe(true);
  });

  it('a whole outline removed comes back closed', () => {
    const doc: Doc = { ...newDoc(), guides: [circle('a', 300, 300, 100)] };
    const cut = trimPiece(doc, doc.guides, pieceAt(doc.guides, { x: 400, y: 300 }, 4)!);
    expect(cut.guides).toHaveLength(0);
    const back = restoreMark(cut, cutMarks(cut)[0]!);
    expect(guideArea(back.guides[0]!)).not.toBeNull();
  });

  it('a line left by slicing can become an ordinary line', () => {
    const doc = colorize(two(), [[300, 500]], 0);
    const sliced = cutAlong(doc, { x: 250, y: 200 }, { x: 250, y: 800 }, { outlines: false });
    const line = sliced.guides.find((g) => g.type === 'line' && g.cut)!;
    const mark = markAt(sliced, { x: 250, y: 500 }, 4)!;
    expect(mark).toMatchObject({ id: line.id, kind: 'cut' });
    const back = restoreMark(sliced, mark);
    expect(back.guides.find((g) => g.id === line.id)).toMatchObject({ type: 'line', cut: undefined });
  });
});

describe('rounding one corner of a square', () => {
  const square: RectGuide = { id: 'r', type: 'rect', cx: 500, cy: 500, w: 200, h: 200, rot: 0, radius: 0 };

  it('rounds only that corner', () => {
    const g = setCornerRadius(square, 1, 50) as RectGuide;
    expect(g.radii).toEqual([0, 50, 0, 0]);
    expect(cornerRadius(g, 1)).toBe(50);
    expect(cornerRadius(g, 0)).toBe(0);
    // one quarter-circle corner: the square loses r² − πr²/4
    near(Math.abs(ringArea(guideArea(g)![0]!, 0.01)), 200 * 200 - (50 * 50 - (Math.PI * 50 * 50) / 4));
  });

  it('goes back to plain rounding when all four match', () => {
    let g: Guide = square;
    for (let i = 0; i < 4; i++) g = setCornerRadius(g, i, 30);
    expect((g as RectGuide).radii).toBeUndefined();
    expect((g as RectGuide).radius).toBe(30);
  });

  it('keeps the rounding on the same corner when mirrored', () => {
    const g = setCornerRadius(square, 0, 40) as RectGuide; // top-left
    const flipped = transformGuide(g, [1, 0, 0, -1, 0, 1000]) as RectGuide; // upside down about y = 500
    // what was the top-left corner is now at the bottom-left
    const pts = flattenChain(guideCenterline(flipped)[0]!, 0.05);
    const hasCorner = (x: number, y: number): boolean => pts.some((p) => Math.hypot(p.x - x, p.y - y) < 0.5);
    expect(hasCorner(400, 600)).toBe(false); // rounded away
    expect(hasCorner(600, 600)).toBe(true);
    expect(hasCorner(400, 400)).toBe(true);
    expect(hasCorner(600, 400)).toBe(true);
  });

  it('a thick band follows the rounded corner', () => {
    const g = { ...(setCornerRadius(square, 2, 60) as RectGuide), width: 20 };
    const rings = guideArea(g)!;
    expect(rings).toHaveLength(2);
    const band = Math.abs(rings.reduce((a, r) => a + ringArea(r, 0.01), 0));
    expect(band).toBeGreaterThan(0.9 * (200 * 200 - 160 * 160));
    expect(band).toBeLessThan(200 * 200 - 160 * 160);
  });
});

describe('thickness that cannot go inside', () => {
  it('a figure of eight falls back to a band on both sides', () => {
    // a bow-tie: its "inside" is two triangles meeting at a point
    const bow: Guide = { id: 'p', type: 'poly', pts: [{ x: 300, y: 300 }, { x: 700, y: 700 }, { x: 700, y: 300 }, { x: 300, y: 700 }], width: 30, band: 'in' };
    const rings = guideArea(bow);
    expect(rings).not.toBeNull();
    const got = Math.abs(rings!.reduce((a, r) => a + ringArea(r, 0.05), 0));
    expect(got).toBeGreaterThan(1000);
  });

  it('an ordinary triangle still thickens inward', () => {
    const tri: Guide = { id: 'p', type: 'poly', pts: [{ x: 500, y: 200 }, { x: 800, y: 700 }, { x: 200, y: 700 }], width: 30, band: 'in' };
    const outer = Math.abs(ringArea(guideCenterline(tri)[0]!.edges, 0.01));
    const band = Math.abs(guideArea(tri)!.reduce((a, r) => a + ringArea(r, 0.05), 0));
    // inside only: the band is smaller than the triangle and no bigger than perimeter × width
    expect(band).toBeLessThan(outer);
    expect(band).toBeGreaterThan(0.5 * 30 * 1000);
  });
});
