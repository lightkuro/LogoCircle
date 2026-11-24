import {
  apply,
  applyVec,
  bboxOfPoints,
  flattenRing,
  mul,
  ringsBBox,
  transformRings,
  unionBBox,
  emptyBBox,
  type BBox,
  type Mat,
  type Pt,
} from '@/geom';
import type { Doc, Fill, Guide, RefImage, Shape } from './types';
import { guideBBox, transformGuide } from './guides';
import { uid } from './ids';

function touch(doc: Doc): Doc {
  return { ...doc, updatedAt: Date.now() };
}

/** Drop groups that no longer have any member. */
function pruneGroups(doc: Doc): Doc {
  const used = new Set<string>();
  for (const s of doc.shapes) if (s.group) used.add(s.group);
  let changed = false;
  const groups: Doc['groups'] = {};
  for (const [id, g] of Object.entries(doc.groups)) {
    if (used.has(id)) groups[id] = g;
    else changed = true;
  }
  return changed ? { ...doc, groups } : doc;
}

/** Mark text groups as no longer retypable once one of their letters changes on its own. */
function unpristine(doc: Doc, groupIds: Iterable<string>): Doc {
  let groups = doc.groups;
  for (const id of groupIds) {
    const g = groups[id];
    if (g?.text?.pristine) {
      if (groups === doc.groups) groups = { ...groups };
      groups[id] = { ...g, text: { ...g.text, pristine: false } };
    }
  }
  return groups === doc.groups ? doc : { ...doc, groups };
}

export function addGuide(doc: Doc, guide: Guide): Doc {
  return touch({ ...doc, guides: [...doc.guides, guide] });
}

export function addShapes(doc: Doc, shapes: Shape[]): Doc {
  return touch({ ...doc, shapes: [...doc.shapes, ...shapes] });
}

export function addRef(doc: Doc, ref: RefImage, replace: boolean): Doc {
  return touch({ ...doc, refs: replace ? [ref] : [...doc.refs, ref] });
}

export function updateGuide(doc: Doc, id: string, next: Guide): Doc {
  return touch({ ...doc, guides: doc.guides.map((g) => (g.id === id ? next : g)) });
}

export function updateRef(doc: Doc, id: string, patch: Partial<RefImage>): Doc {
  return touch({ ...doc, refs: doc.refs.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
}

export function updateShapes(doc: Doc, ids: Iterable<string>, patch: (s: Shape) => Shape): Doc {
  const set = new Set(ids);
  return touch({ ...doc, shapes: doc.shapes.map((s) => (set.has(s.id) ? patch(s) : s)) });
}

export function removeItems(doc: Doc, ids: Iterable<string>): Doc {
  const set = new Set(ids);
  const touched = new Set<string>();
  for (const s of doc.shapes) if (set.has(s.id) && s.group) touched.add(s.group);
  let next: Doc = {
    ...doc,
    guides: doc.guides.filter((g) => !set.has(g.id)),
    shapes: doc.shapes.filter((s) => !set.has(s.id)),
    refs: doc.refs.filter((r) => !set.has(r.id)),
  };
  next = unpristine(next, touched);
  return touch(pruneGroups(next));
}

function transformRef(r: RefImage, m: Mat): RefImage {
  const c = apply(m, { x: r.cx, y: r.cy });
  const u = applyVec(m, { x: Math.cos(r.rot), y: Math.sin(r.rot) });
  const v = applyVec(m, { x: -Math.sin(r.rot), y: Math.cos(r.rot) });
  return { ...r, cx: c.x, cy: c.y, w: r.w * Math.hypot(u.x, u.y), h: r.h * Math.hypot(v.x, v.y), rot: Math.atan2(u.y, u.x) };
}

/** Which text groups are only partly covered by this selection? */
function partialGroups(doc: Doc, set: Set<string>): Set<string> {
  const total = new Map<string, number>();
  const picked = new Map<string, number>();
  for (const s of doc.shapes) {
    if (!s.group) continue;
    total.set(s.group, (total.get(s.group) ?? 0) + 1);
    if (set.has(s.id)) picked.set(s.group, (picked.get(s.group) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [g, n] of picked) if (n < (total.get(g) ?? 0)) out.add(g);
  return out;
}

export function transformItems(doc: Doc, ids: Iterable<string>, m: Mat): Doc {
  const set = new Set(ids);
  if (set.size === 0) return doc;
  const partial = partialGroups(doc, set);
  let groups = doc.groups;
  // A whole word moved together keeps its text editable: carry the transform along.
  const whole = new Set<string>();
  for (const s of doc.shapes) if (set.has(s.id) && s.group && !partial.has(s.group)) whole.add(s.group);
  for (const gid of whole) {
    const g = groups[gid];
    if (g?.text) {
      if (groups === doc.groups) groups = { ...groups };
      groups[gid] = { ...g, text: { ...g.text, m: mul(m, g.text.m) } };
    }
  }
  const next: Doc = {
    ...doc,
    groups,
    guides: doc.guides.map((g) => (set.has(g.id) ? transformGuide(g, m) : g)),
    shapes: doc.shapes.map((s) => (set.has(s.id) ? { ...s, rings: transformRings(s.rings, m) } : s)),
    refs: doc.refs.map((r) => (set.has(r.id) ? transformRef(r, m) : r)),
  };
  return touch(unpristine(next, partial));
}

/** Copy the selection, transformed by `m`. Returns the new document and the copies' ids. */
export function duplicateItems(doc: Doc, ids: Iterable<string>, m: Mat): { doc: Doc; ids: string[] } {
  const set = new Set(ids);
  const newIds: string[] = [];
  const guides = [...doc.guides];
  const shapes = [...doc.shapes];
  const refs = [...doc.refs];
  const groups = { ...doc.groups };
  const groupMap = new Map<string, string>();
  const partial = partialGroups(doc, set);
  for (const g of doc.guides) {
    if (!set.has(g.id)) continue;
    const id = uid('g');
    guides.push({ ...transformGuide(g, m), id });
    newIds.push(id);
  }
  for (const s of doc.shapes) {
    if (!set.has(s.id)) continue;
    const id = uid('s');
    let group = s.group;
    if (group) {
      if (partial.has(group)) {
        group = undefined; // a lone copied letter stands on its own
      } else {
        let ng = groupMap.get(group);
        if (!ng) {
          ng = uid('w');
          groupMap.set(group, ng);
          const src = doc.groups[group];
          if (src) groups[ng] = { ...src, id: ng, text: src.text ? { ...src.text, m: mul(m, src.text.m) } : undefined };
        }
        group = ng;
      }
    }
    shapes.push({ ...s, id, group, rings: transformRings(s.rings, m) });
    newIds.push(id);
  }
  for (const r of doc.refs) {
    if (!set.has(r.id)) continue;
    const id = uid('r');
    refs.push({ ...transformRef(r, m), id });
    newIds.push(id);
  }
  return { doc: touch({ ...doc, guides, shapes, refs, groups }), ids: newIds };
}

export function setFill(doc: Doc, ids: Iterable<string>, fill: Fill | null): Doc {
  return updateShapes(doc, ids, (s) => ({ ...s, fill }));
}

export function shapeBBox(s: Shape): BBox {
  return ringsBBox(s.rings);
}

export function refCorners(r: RefImage): Pt[] {
  const cr = Math.cos(r.rot);
  const sr = Math.sin(r.rot);
  const hw = r.w / 2;
  const hh = r.h / 2;
  const P = (x: number, y: number): Pt => ({ x: r.cx + x * cr - y * sr, y: r.cy + x * sr + y * cr });
  return [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)];
}

const bboxCache = new WeakMap<object, BBox>();

/** Bounding box of one item, cached per (immutable) item object. */
export function itemBBox(doc: Doc, id: string): BBox | null {
  const g = doc.guides.find((x) => x.id === id);
  const s = g ? undefined : doc.shapes.find((x) => x.id === id);
  const r = g || s ? undefined : doc.refs.find((x) => x.id === id);
  const item = g ?? s ?? r;
  if (!item) return null;
  const hit = bboxCache.get(item);
  if (hit) return hit;
  const b = g ? guideBBox(g) : s ? shapeBBox(s) : bboxOfPoints(refCorners(r!));
  bboxCache.set(item, b);
  return b;
}

export function selectionBBox(doc: Doc, ids: Iterable<string>): BBox | null {
  let b = emptyBBox();
  for (const id of ids) {
    const ib = itemBBox(doc, id);
    if (ib) b = unionBBox(b, ib);
  }
  return isFinite(b.x) ? b : null;
}

/** Bounding box of everything that would be exported. */
export function contentBBox(doc: Doc): BBox | null {
  let b = emptyBBox();
  for (const s of doc.shapes) if (!s.hidden) b = unionBBox(b, shapeBBox(s));
  return isFinite(b.x) ? b : null;
}

const polyCache = new WeakMap<Shape, Pt[][]>();

/** A shape's rings as polygons, for hit-testing. */
export function shapePolygons(s: Shape): Pt[][] {
  let p = polyCache.get(s);
  if (!p) {
    p = s.rings.map((r) => flattenRing(r, 0.5));
    polyCache.set(s, p);
  }
  return p;
}

/** Move items within their own list (Advanced layers). */
export function reorderShape(doc: Doc, id: string, toIndex: number): Doc {
  const from = doc.shapes.findIndex((s) => s.id === id);
  if (from < 0) return doc;
  const shapes = [...doc.shapes];
  const [s] = shapes.splice(from, 1);
  shapes.splice(Math.max(0, Math.min(shapes.length, toIndex)), 0, s!);
  return touch({ ...doc, shapes });
}
