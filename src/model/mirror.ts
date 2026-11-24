/**
 * Mirror copy: copies of the selection, reflected across a straight line.
 *
 * The line can be any straight piece of an outline on the canvas (a line, a
 * side of a square or a polygon), one of the frame's two centre lines, or a
 * line drawn just for this.
 */
import { chainsToPath, edgeEnd, edgeStart, ringsToPath, transformRings, type Mat, type Pt } from '@/geom';
import { board } from './doc';
import { guideCenterline, transformGuide } from './guides';
import { duplicateItems } from './ops';
import type { Doc, Guide } from './types';

export interface Axis {
  a: Pt;
  b: Pt;
  /** The outline this line belongs to, when it is the whole of a line outline. */
  line?: string;
  /** One of the frame's centre lines. */
  frame?: boolean;
}

/** The reflection across the line through `a` and `b`; null when they are the same point. */
export function reflection(a: Pt, b: Pt): Mat | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ux = dx / len;
  const uy = dy / len;
  const c = ux * ux - uy * uy;
  const s = 2 * ux * uy;
  // x' = c·x + s·y + e, y' = s·x − c·y + f, with the points of the line left where they are
  return [c, s, s, -c, a.x - (c * a.x + s * a.y), a.y - (s * a.x - c * a.y)];
}

/** The lines that can be mirrored across: the frame's centre lines, then every straight piece of the outlines given. */
export function mirrorAxes(doc: Doc, guides: Guide[]): Axis[] {
  const b = board(doc);
  const out: Axis[] = [
    { a: { x: b.x + b.w / 2, y: b.y }, b: { x: b.x + b.w / 2, y: b.y + b.h }, frame: true },
    { a: { x: b.x, y: b.y + b.h / 2 }, b: { x: b.x + b.w, y: b.y + b.h / 2 }, frame: true },
  ];
  for (const g of guides) {
    for (const chain of guideCenterline(g)) {
      for (const e of chain.edges) {
        if (e.c.k !== 'L') continue;
        const a = edgeStart(e);
        const z = edgeEnd(e);
        if (Math.hypot(z.x - a.x, z.y - a.y) < 1e-6) continue;
        out.push({ a, b: z, line: g.type === 'line' ? g.id : undefined });
      }
    }
  }
  return out;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** The line under a point. A line of an outline wins over a centre line of the frame lying as close. */
export function axisAt(axes: Axis[], p: Pt, tol: number): Axis | null {
  let best: Axis | null = null;
  let bestD = Infinity;
  for (const ax of axes) {
    const d = distToSegment(p, ax.a, ax.b) + (ax.frame ? tol * 0.5 : 0);
    if (d <= tol * (ax.frame ? 1.5 : 1) && d < bestD) {
      best = ax;
      bestD = d;
    }
  }
  return best;
}

/** What of the selection gets mirrored: outlines and filled areas (photos stay as they are). */
export function mirrorable(doc: Doc, ids: string[]): string[] {
  const refs = new Set(doc.refs.map((r) => r.id));
  return ids.filter((id) => !refs.has(id));
}

/** The items to copy across `axis`: the line itself, when selected, is not copied onto itself. */
function toCopy(doc: Doc, ids: string[], axis: Axis): string[] {
  return mirrorable(doc, ids).filter((id) => id !== axis.line);
}

/** Copies of `ids` reflected across the axis, and their ids. Null when there is nothing to copy. */
export function mirrorCopy(doc: Doc, ids: string[], axis: Axis): { doc: Doc; ids: string[] } | null {
  const m = reflection(axis.a, axis.b);
  const copy = toCopy(doc, ids, axis);
  if (!m || !copy.length) return null;
  return duplicateItems(doc, copy, m);
}

/** Where the copies would go, as path data, for a preview. */
export function mirrorPreview(doc: Doc, ids: string[], axis: Axis): string {
  const m = reflection(axis.a, axis.b);
  if (!m) return '';
  const set = new Set(toCopy(doc, ids, axis));
  let d = '';
  for (const g of doc.guides) if (set.has(g.id)) d += chainsToPath(guideCenterline(transformGuide(g, m)));
  for (const s of doc.shapes) if (set.has(s.id) && s.rings.length) d += ringsToPath(transformRings(s.rings, m));
  return d;
}
