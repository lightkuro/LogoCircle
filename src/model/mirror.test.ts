import { describe, expect, it } from 'vitest';
import { apply } from '@/geom';
import { board, newDoc } from './doc';
import { axisAt, mirrorAxes, mirrorCopy, mirrorPreview, reflection } from './mirror';
import type { Doc, EllipseGuide, Guide, LineGuide, PolyGuide, RectGuide } from './types';

const circle = (id: string, cx: number, cy: number, r: number): EllipseGuide => ({ id, type: 'ellipse', cx, cy, rx: r, ry: r, rot: 0, width: 0 });
const line = (id: string, x0: number, y0: number, x1: number, y1: number): LineGuide => ({ id, type: 'line', x0, y0, x1, y1, width: 0 });
const close = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('reflection', () => {
  it('leaves the line in place and swaps the sides', () => {
    const m = reflection({ x: 100, y: 0 }, { x: 100, y: 50 })!;
    close(apply(m, { x: 100, y: 37 }), { x: 100, y: 37 });
    close(apply(m, { x: 130, y: 10 }), { x: 70, y: 10 });
  });

  it('works across a slanted line, and twice is no change', () => {
    const m = reflection({ x: 0, y: 0 }, { x: 10, y: 10 })!;
    close(apply(m, { x: 3, y: 0 }), { x: 0, y: 3 });
    const p = { x: 17, y: -4 };
    close(apply(m, apply(m, p)), p);
  });

  it('has no answer for a line of no length', () => {
    expect(reflection({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe('the lines to mirror across', () => {
  it('are the frame centre lines and every straight piece of an outline', () => {
    const doc = newDoc();
    const sq: RectGuide = { id: 'sq', type: 'rect', cx: 300, cy: 300, w: 100, h: 60, rot: 0, radius: 0 };
    const tri: PolyGuide = {
      id: 'tri',
      type: 'poly',
      pts: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 20, y: 30 },
      ],
    };
    const axes = mirrorAxes(doc, [circle('c', 0, 0, 10), line('l', 0, 0, 5, 5), sq, tri]);
    expect(axes.filter((a) => a.frame)).toHaveLength(2);
    expect(axes.filter((a) => a.line === 'l')).toHaveLength(1);
    // four sides of the square and three of the triangle; a circle has none
    expect(axes.filter((a) => !a.frame && !a.line)).toHaveLength(7);
  });

  it('a line of an outline wins over the frame centre line next to it', () => {
    const doc = newDoc();
    const b = board(doc);
    const x = b.x + b.w / 2;
    const axes = mirrorAxes(doc, [line('l', x + 2, b.y, x + 2, b.y + 100)]);
    expect(axisAt(axes, { x: x + 1, y: b.y + 50 }, 6)?.line).toBe('l');
    expect(axisAt(axes, { x, y: b.y + 300 }, 6)?.frame).toBe(true);
    expect(axisAt(axes, { x: x + 200, y: b.y + 300 }, 6)).toBeNull();
  });
});

describe('mirror copy', () => {
  const doc = (): Doc => ({ ...newDoc(), guides: [circle('c', 100, 50, 20), line('axis', 200, 0, 200, 100)] });

  it('adds a reflected copy and keeps the original', () => {
    const d = doc();
    const r = mirrorCopy(d, ['c'], { a: { x: 200, y: 0 }, b: { x: 200, y: 100 }, line: 'axis' })!;
    expect(r.ids).toHaveLength(1);
    expect(r.doc.guides).toHaveLength(3);
    const copy = r.doc.guides.find((g) => g.id === r.ids[0]) as EllipseGuide;
    expect(copy.cx).toBeCloseTo(300, 6);
    expect(copy.cy).toBeCloseTo(50, 6);
    expect(copy.rx).toBeCloseTo(20, 6);
  });

  it('does not copy the line onto itself when it is part of the selection', () => {
    const r = mirrorCopy(doc(), ['c', 'axis'], { a: { x: 200, y: 0 }, b: { x: 200, y: 100 }, line: 'axis' })!;
    expect(r.ids).toHaveLength(1);
    expect(r.doc.guides.filter((g: Guide) => g.type === 'line')).toHaveLength(1);
  });

  it('has nothing to do with only the line selected', () => {
    expect(mirrorCopy(doc(), ['axis'], { a: { x: 200, y: 0 }, b: { x: 200, y: 100 }, line: 'axis' })).toBeNull();
  });

  it('previews where the copies go', () => {
    expect(mirrorPreview(doc(), ['c'], { a: { x: 200, y: 0 }, b: { x: 200, y: 100 } })).toMatch(/^M/);
  });
});
