/**
 * Pattern: copies of the selection laid out in a row, around a circle or in a
 * grid. The original stays where it is and counts as the first of them.
 */
import { rotate, translate, type BBox, type Mat } from '@/geom';
import { duplicateItems, selectionBBox } from './ops';
import type { Doc } from './types';

export type PatternKind = 'row' | 'circle' | 'grid';

export interface PatternSpec {
  kind: PatternKind;
  /** How many in all (row and circle), or across (grid). */
  count: number;
  /** Grid: how many down. */
  rows: number;
  /** Row and grid: the space between neighbours (negative overlaps them). Circle: the radius. */
  distance: number;
  /** Row: the direction it runs in, in degrees (0 = to the right, 90 = down). */
  angle: number;
}

/** A starting point that suits the selection: neighbours a fifth of its size apart. */
export function defaultPattern(kind: PatternKind, box: BBox): PatternSpec {
  const size = Math.max(box.w, box.h, 1);
  const count = kind === 'circle' ? 8 : kind === 'grid' ? 3 : 4;
  return {
    kind,
    count,
    rows: 3,
    // around a circle: just far enough out for the copies to sit side by side
    distance: Math.round(kind === 'circle' ? Math.max(size * 0.8, (size * count) / (2 * Math.PI)) : size * 0.2),
    angle: 0,
  };
}

/** Where each copy goes, as a transform of the original (the original itself not included). */
export function patternMatrices(spec: PatternSpec, box: BBox): Mat[] {
  const out: Mat[] = [];
  const n = Math.max(1, Math.round(spec.count));
  if (spec.kind === 'row') {
    const a = (spec.angle * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // from one to the next: the selection's own extent that way, plus the space between
    const step = Math.abs(ux) * box.w + Math.abs(uy) * box.h + spec.distance;
    for (let i = 1; i < n; i++) out.push(translate(ux * step * i, uy * step * i));
  } else if (spec.kind === 'circle') {
    // around a centre below the selection, so the original sits at the top
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2 + Math.max(1, spec.distance);
    for (let i = 1; i < n; i++) out.push(rotate((2 * Math.PI * i) / n, cx, cy));
  } else {
    const rows = Math.max(1, Math.round(spec.rows));
    const sx = box.w + spec.distance;
    const sy = box.h + spec.distance;
    for (let r = 0; r < rows; r++) for (let c = 0; c < n; c++) if (r || c) out.push(translate(c * sx, r * sy));
  }
  return out;
}

/** The document with the copies added, and the ids of all the copies. */
export function applyPattern(doc: Doc, ids: string[], spec: PatternSpec): { doc: Doc; ids: string[] } {
  const box = selectionBBox(doc, ids);
  if (!box || !ids.length) return { doc, ids: [] };
  let next = doc;
  const made: string[] = [];
  for (const m of patternMatrices(spec, box)) {
    const r = duplicateItems(next, ids, m);
    next = r.doc;
    made.push(...r.ids);
  }
  return { doc: next, ids: made };
}
