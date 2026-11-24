import { evalC, mul, rotate, scale, translate, type Mat, type Pt } from '@/geom';
import type { Doc, Guide } from '@/model/types';
import { guideCenterline, guideHandles } from '@/model/guides';
import { selectionBBox } from '@/model/ops';

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
  return [
    frameLocalToDoc(f, -hw, -hh),
    frameLocalToDoc(f, hw, -hh),
    frameLocalToDoc(f, hw, hh),
    frameLocalToDoc(f, -hw, hh),
  ];
}

export function singleGuide(doc: Doc, ids: string[]): Guide | null {
  if (ids.length !== 1) return null;
  return doc.guides.find((g) => g.id === ids[0]) ?? null;
}

/** The frame to draw around the current selection (null when nothing is selected). */
export function selectionFrame(doc: Doc, ids: string[]): Frame | null {
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    const g = doc.guides.find((x) => x.id === ids[0]);
    if (g?.type === 'ellipse') return { cx: g.cx, cy: g.cy, w: g.rx * 2, h: g.ry * 2, rot: g.rot };
    if (g?.type === 'rect') return { cx: g.cx, cy: g.cy, w: g.w, h: g.h, rot: g.rot };
    const r = doc.refs.find((x) => x.id === ids[0]);
    if (r) return { cx: r.cx, cy: r.cy, w: r.w, h: r.h, rot: r.rot };
  }
  const b = selectionBBox(doc, ids);
  if (!b) return null;
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rot: 0 };
}

/** Distance (document units) from the frame's top edge to the rotation knob. */
export const ROT_OFFSET_PX = 30;

/**
 * Which handles to offer. `k` is the zoom (screen px per document unit), used
 * to drop handles that would crowd each other on a small selection.
 */
export function placeHandles(doc: Doc, ids: string[], frame: Frame, k: number): PlacedHandle[] {
  const out: PlacedHandle[] = [];
  const g = singleGuide(doc, ids);
  if (g?.type === 'line') {
    guideHandles(g).forEach((p, index) => out.push({ handle: { kind: 'pt', index }, p }));
    return out;
  }
  const hw = frame.w / 2;
  const hh = frame.h / 2;
  const pointy = g && (g.type === 'poly' || g.type === 'curve' || g.type === 'path');
  const wPx = frame.w * k;
  const hPx = frame.h * k;
  for (const at of Object.keys(LOCAL) as BoxHandle[]) {
    const [lx, ly] = LOCAL[at];
    const corner = lx !== 0 && ly !== 0;
    if (!corner) {
      if (pointy) continue; // points already cover reshaping
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
    if (g.type === 'curve' || g.type === 'poly') {
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
  return mul(
    translate(pivot.x, pivot.y),
    mul(rotate(f.rot), mul(scale(sx, sy), mul(rotate(-f.rot), translate(-pivot.x, -pivot.y)))),
  );
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
