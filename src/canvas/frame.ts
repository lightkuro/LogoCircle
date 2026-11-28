import { evalC, mul, rotate, scale, translate, type Mat, type Pt } from '@/geom';
import type { Doc, Guide } from '@/model/types';
import { guideCenterline, guideHandles, guidePoints, guideRot, rectCorners } from '@/model/guides';
import { settings } from '@/store/settings';
import { refCorners, shapePolygons } from '@/model/ops';
import { board } from '@/model/doc';
import { followSet } from '@/model/link';

/** An oriented box around the selection, in document space. */
export interface Frame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type Handle =
  | { kind: 'box'; at: BoxHandle }
  | { kind: 'rot' }
  | { kind: 'pt'; index: number }
  | { kind: 'mid'; index: number }
  /** Bezier handle of a pen-path node (incoming / outgoing). */
  | { kind: 'hin'; index: number }
  | { kind: 'hout'; index: number };

export interface PlacedHandle {
  handle: Handle;
  /** Document-space position. */
  p: Pt;
}

const LOCAL: Record<BoxHandle, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

export function frameLocalToDoc(f: Frame, lx: number, ly: number): Pt {
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  return { x: f.cx + lx * c - ly * s, y: f.cy + lx * s + ly * c };
}

export function frameCorners(f: Frame): Pt[] {
  const hw = f.w / 2;
  const hh = f.h / 2;
  return [frameLocalToDoc(f, -hw, -hh), frameLocalToDoc(f, hw, -hh), frameLocalToDoc(f, hw, hh), frameLocalToDoc(f, -hw, hh)];
}

export function singleGuide(doc: Doc, ids: string[]): Guide | null {
  if (ids.length !== 1) return null;
  return doc.guides.find((g) => g.id === ids[0]) ?? null;
}

/** The tightest box around some points that is turned by `rot`. */
export function orientedBox(pts: Pt[], rot: number): Frame | null {
  if (!pts.length) return null;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    const x = p.x * c - p.y * s;
    const y = p.x * s + p.y * c;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const cb = Math.cos(rot);
  const sb = Math.sin(rot);
  return { cx: mx * cb - my * sb, cy: mx * sb + my * cb, w: x1 - x0, h: y1 - y0, rot };
}

/**
 * The frame to draw around the current selection (null when nothing is
 * selected). The box keeps the angle its contents were turned to: `hint` is
 * the angle of a group that was just rotated together, otherwise each thing
 * remembers its own.
 */
export function selectionFrame(doc: Doc, ids: string[], hint?: { key: string; rot: number } | null): Frame | null {
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    const g = doc.guides.find((x) => x.id === ids[0]);
    if (g?.type === 'ellipse' && !(g.width && g.band === 'out')) return { cx: g.cx, cy: g.cy, w: g.rx * 2, h: g.ry * 2, rot: g.rot };
    if (g?.type === 'rect' && !(g.width && g.band === 'out')) return { cx: g.cx, cy: g.cy, w: g.w, h: g.h, rot: g.rot };
    if (g?.type === 'line') {
      // Along the line, turned so its top faces up: the rotation knob sits above the middle.
      let a = Math.atan2(g.y1 - g.y0, g.x1 - g.x0);
      if (a > Math.PI / 2) a -= Math.PI;
      else if (a <= -Math.PI / 2) a += Math.PI;
      return { cx: (g.x0 + g.x1) / 2, cy: (g.y0 + g.y1) / 2, w: Math.hypot(g.x1 - g.x0, g.y1 - g.y0), h: g.width ?? 0, rot: a };
    }
    const r = doc.refs.find((x) => x.id === ids[0]);
    if (r) return { cx: r.cx, cy: r.cy, w: r.w, h: r.h, rot: r.rot };
  }
  // The box goes around everything that moves with the selection: a colored
  // piece brings the outlines it is made from.
  const set = new Set([...ids, ...followSet(doc, ids)]);
  const pts: Pt[] = [];
  let rot: number | null = null;
  let mixed = false;
  const note = (a: number): void => {
    if (rot === null) rot = a;
    else if (Math.abs(rot - a) > 1e-6) mixed = true;
  };
  for (const g of doc.guides) {
    if (!set.has(g.id)) continue;
    for (const poly of guidePoints(g)) pts.push(...poly);
    note(guideRot(g));
  }
  for (const s of doc.shapes) {
    if (!set.has(s.id)) continue;
    for (const poly of shapePolygons(s)) pts.push(...poly);
    note(s.rot ?? 0);
  }
  for (const r of doc.refs) {
    if (!set.has(r.id)) continue;
    pts.push(...refCorners(r));
    note(r.rot);
  }
  const key = [...ids].sort().join(',');
  const angle = hint && hint.key === key ? hint.rot : mixed ? 0 : (rot ?? 0);
  return orientedBox(pts, angle);
}

/** The export frame as a selection-style box. */
export function boardFrame(doc: Doc): Frame {
  const b = board(doc);
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rot: 0 };
}

/** The eight handles of an upright box (used for the export frame). */
export function boxHandles(f: Frame): PlacedHandle[] {
  return (Object.keys(LOCAL) as BoxHandle[]).map((at) => {
    const [lx, ly] = LOCAL[at];
    return { handle: { kind: 'box', at }, p: frameLocalToDoc(f, (lx * f.w) / 2, (ly * f.h) / 2) };
  });
}

/** The export frame after dragging one of its handles to `cur`. Corners and sides both resize freely. */
export function resizeBoard(b: { x: number; y: number; w: number; h: number }, at: BoxHandle, cur: Pt, keepRatio: boolean): { x: number; y: number; w: number; h: number } {
  const [lx, ly] = LOCAL[at];
  const MIN = 16;
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  if (lx < 0) x0 = Math.min(cur.x, x1 - MIN);
  if (lx > 0) x1 = Math.max(cur.x, x0 + MIN);
  if (ly < 0) y0 = Math.min(cur.y, y1 - MIN);
  if (ly > 0) y1 = Math.max(cur.y, y0 + MIN);
  if (keepRatio && lx !== 0 && ly !== 0) {
    const k = Math.max((x1 - x0) / b.w, (y1 - y0) / b.h);
    const w = b.w * k;
    const h = b.h * k;
    if (lx < 0) x0 = x1 - w;
    else x1 = x0 + w;
    if (ly < 0) y0 = y1 - h;
    else y1 = y0 + h;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Distance (document units) from the frame's top edge to the rotation knob. */
export const ROT_OFFSET_PX = 30;

/**
 * Which handles to offer. `k` is the zoom (screen px per document unit), used
 * to drop handles that would crowd each other on a small selection.
 */
export function placeHandles(doc: Doc, ids: string[], frame: Frame, k: number, moveOnly = false, pointsFirst = false): PlacedHandle[] {
  const out: PlacedHandle[] = [];
  const knob = (): PlacedHandle => ({ handle: { kind: 'rot' }, p: frameLocalToDoc(frame, 0, -frame.h / 2 - ROT_OFFSET_PX / k) });
  // "Move": only the knob for turning; the rest of it is for dragging.
  if (moveOnly) return [knob()];
  const lone = singleGuide(doc, ids);
  // Move points: a square's or polygon's corners come before resizing, which steps aside.
  if (pointsFirst && lone && (lone.type === 'rect' || lone.type === 'poly')) {
    out.push(knob());
    (lone.type === 'rect' ? rectCorners(lone) : lone.pts).forEach((p, index) => out.push({ handle: { kind: 'pt', index }, p }));
    if (lone.type === 'poly' && settings().addDots) {
      const n = lone.pts.length;
      for (let i = 0; i < n; i++) {
        const a = lone.pts[i]!;
        const b = lone.pts[(i + 1) % n]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) * k >= 70) out.push({ handle: { kind: 'mid', index: i }, p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
      }
    }
    return out;
  }
  const g = singleGuide(doc, ids);
  const hw = frame.w / 2;
  const hh = frame.h / 2;
  if (g?.type === 'line') {
    guideHandles(g).forEach((p, index) => out.push({ handle: { kind: 'pt', index }, p }));
    out.push({ handle: { kind: 'rot' }, p: frameLocalToDoc(frame, 0, -hh - ROT_OFFSET_PX / k) });
    return out;
  }
  const pointy = g && (g.type === 'poly' || g.type === 'curve' || g.type === 'path');
  // A polygon is stretched by its sides like a box; its points are for fine changes.
  const stretchy = g?.type === 'poly';
  const wPx = frame.w * k;
  const hPx = frame.h * k;
  for (const at of Object.keys(LOCAL) as BoxHandle[]) {
    const [lx, ly] = LOCAL[at];
    const corner = lx !== 0 && ly !== 0;
    if (!corner) {
      if (pointy && !stretchy) continue; // points already cover reshaping
      if (lx === 0 && wPx < 56) continue;
      if (ly === 0 && hPx < 56) continue;
      if (lx !== 0 && frame.w === 0) continue;
      if (ly !== 0 && frame.h === 0) continue;
    }
    out.push({ handle: { kind: 'box', at }, p: frameLocalToDoc(frame, lx * hw, ly * hh) });
  }
  out.push({ handle: { kind: 'rot' }, p: frameLocalToDoc(frame, 0, -hh - ROT_OFFSET_PX / k) });
  if (pointy && g) {
    const pts = guideHandles(g);
    if (g.type === 'path') {
      g.nodes.forEach((n, index) => {
        if (n.ix !== undefined && n.iy !== undefined) out.push({ handle: { kind: 'hin', index }, p: { x: n.ix, y: n.iy } });
        if (n.ox !== undefined && n.oy !== undefined) out.push({ handle: { kind: 'hout', index }, p: { x: n.ox, y: n.oy } });
      });
    }
    pts.forEach((p, index) => out.push({ handle: { kind: 'pt', index }, p }));
    // The small dots that add a point, on each side long enough for one (unless switched off in Settings).
    if ((g.type === 'curve' || g.type === 'poly') && settings().addDots) {
      const closed = g.type === 'poly' || g.closed;
      const n = pts.length;
      const count = closed ? n : n - 1;
      const edges = g.type === 'curve' ? guideCenterline(g)[0]?.edges : undefined;
      for (let i = 0; i < count; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % n]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) * k < 70) continue;
        // On a curve the "+" sits on the curve itself, not on the straight chord.
        const e = edges && edges.length === count ? edges[i] : undefined;
        const p = e ? evalC(e.c, (e.t0 + e.t1) / 2) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        out.push({ handle: { kind: 'mid', index: i }, p });
      }
    }
  }
  return out;
}

function toLocal(f: Frame, p: Pt, pivot: Pt): Pt {
  const c = Math.cos(-f.rot);
  const s = Math.sin(-f.rot);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

function scaleAbout(f: Frame, pivot: Pt, sx: number, sy: number): Mat {
  return mul(translate(pivot.x, pivot.y), mul(rotate(f.rot), mul(scale(sx, sy), mul(rotate(-f.rot), translate(-pivot.x, -pivot.y)))));
}

const MIN_SCALE = 0.02;

/** The transform produced by dragging a box handle to `cur`. Corners scale evenly; sides stretch. */
export function boxHandleMatrix(f: Frame, at: BoxHandle, cur: Pt): Mat {
  const [lx, ly] = LOCAL[at];
  const hw = f.w / 2;
  const hh = f.h / 2;
  const pivot = frameLocalToDoc(f, -lx * hw, -ly * hh);
  const local = toLocal(f, cur, pivot);
  if (lx !== 0 && ly !== 0) {
    const dx = lx * f.w;
    const dy = ly * f.h;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return scaleAbout(f, pivot, 1, 1);
    const s = Math.max(MIN_SCALE, (local.x * dx + local.y * dy) / len2);
    return scaleAbout(f, pivot, s, s);
  }
  if (lx !== 0) {
    const s = Math.max(MIN_SCALE, (local.x * lx) / f.w);
    return scaleAbout(f, pivot, s, 1);
  }
  const s = Math.max(MIN_SCALE, (local.y * ly) / f.h);
  return scaleAbout(f, pivot, 1, s);
}

const STEP = Math.PI / 12;

/** The transform produced by dragging the rotation knob from `start` to `cur` (snaps to 15°). */
export function rotateMatrix(f: Frame, start: Pt, cur: Pt, free: boolean): Mat {
  const a0 = Math.atan2(start.y - f.cy, start.x - f.cx);
  const a1 = Math.atan2(cur.y - f.cy, cur.x - f.cx);
  let delta = a1 - a0;
  if (!free) {
    const target = f.rot + delta;
    const snapped = Math.round(target / STEP) * STEP;
    if (Math.abs(target - snapped) < (3 * Math.PI) / 180) delta = snapped - f.rot;
  }
  return rotate(delta, f.cx, f.cy);
}
