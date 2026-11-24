import { buildArrangement, neighbors, outline, withFollowers, type Arrangement, type Source } from '@/engine';
import { derivC, evalC, lineEdge, type Chain, type Ring } from '@/geom';
import type { Doc, Fill, Shape } from './types';
import { guideChains } from './guides';
import { isPlain } from './doc';
import { uid } from './ids';

/**
 * How far (document units) an open outline is allowed to fall short of another
 * and still close the area. Lines that look like they touch should count.
 */
export const GAP = 4;

/** An open chain with both ends pushed out by GAP along their direction. */
function reach(chain: Chain): Chain {
  if (chain.closed || chain.edges.length === 0) return chain;
  const edges = chain.edges.slice();
  const first = edges[0]!;
  const last = edges[edges.length - 1]!;
  const a = evalC(first.c, first.t0);
  const da = derivC(first.c, first.t0);
  const sa = Math.sign(first.t1 - first.t0) || 1;
  const la = Math.hypot(da.x, da.y);
  if (la > 1e-9) edges.unshift(lineEdge(a.x - ((da.x * sa) / la) * GAP, a.y - ((da.y * sa) / la) * GAP, a.x, a.y));
  const b = evalC(last.c, last.t1);
  const db = derivC(last.c, last.t1);
  const sb = Math.sign(last.t1 - last.t0) || 1;
  const lb = Math.hypot(db.x, db.y);
  if (lb > 1e-9) edges.push(lineEdge(b.x, b.y, b.x + ((db.x * sb) / lb) * GAP, b.y + ((db.y * sb) / lb) * GAP));
  return { edges, closed: false };
}

/**
 * Everything that divides the canvas into areas right now. Only outlines and
 * shapes count: the open background around them is not an area, so a stray tap
 * beside the artwork never floods the whole artboard (Paper sets a background).
 */
export function docSources(doc: Doc, showGuides: boolean): Source[] {
  const sources: Source[] = [];
  if (showGuides) {
    for (const g of doc.guides) {
      if (g.hidden) continue;
      const chains = guideChains(g).map(reach);
      if (chains.length) sources.push({ id: g.id, fill: false, chains });
    }
  }
  for (const s of doc.shapes) {
    if (s.hidden || s.rings.length === 0) continue;
    sources.push({ id: s.id, fill: true, chains: s.rings.map((r) => ({ edges: r, closed: true })) });
  }
  return sources;
}

export function buildDocArrangement(doc: Doc, showGuides: boolean): Arrangement {
  const { w, h } = doc.artboard;
  return buildArrangement(docSources(doc, showGuides), {
    bounds: { x: -w, y: -h, w: w * 3, h: h * 3 },
  });
}

/** The visible color of a face: the topmost shape covering it. */
export function faceTopShape(doc: Doc, arr: Arrangement, faceId: number): Shape | null {
  const inside = arr.faces[faceId]?.inside;
  if (!inside || inside.length === 0) return null;
  const set = new Set(inside);
  for (let i = doc.shapes.length - 1; i >= 0; i--) {
    const s = doc.shapes[i]!;
    if (set.has(s.id)) return s;
  }
  return null;
}

/**
 * Color the given faces (or erase them when `fill` is null).
 *
 * Shapes are edited locally: the painted faces are cut out of every shape
 * covering them, then added to the neighbouring shapes of the same color,
 * which merge into one. Shapes that are not involved are left untouched.
 * Returns the same document object when nothing would change.
 */
export function paintFaces(doc: Doc, arr: Arrangement, faceIds: Iterable<number>, fill: Fill | null): Doc {
  const P = withFollowers(arr, faceIds);
  if (P.size === 0) return doc;

  // Faces covered by each shape.
  const facesOf = new Map<string, number[]>();
  for (const f of arr.faces) {
    for (const id of f.inside) {
      let list = facesOf.get(id);
      if (!list) facesOf.set(id, (list = []));
      list.push(f.id);
    }
  }
  const byId = new Map(doc.shapes.map((s) => [s.id, s]));
  const matches = (s: Shape): boolean => fill !== null && isPlain(s) && s.fill === fill;

  // Is there anything to do? Every painted face already shows this color and nothing lies beneath.
  if (fill !== null) {
    let noop = true;
    for (const f of P) {
      const inside = arr.faces[f]!.inside;
      if (inside.length !== 1 || !matches(byId.get(inside[0]!)!)) {
        noop = false;
        break;
      }
    }
    if (noop) {
      // Painting could still merge two same-colored neighbours; only skip when one shape owns it all.
      const owners = new Set<string>();
      for (const f of P) owners.add(arr.faces[f]!.inside[0]!);
      if (owners.size === 1) {
        const owner = [...owners][0]!;
        let touchesOther = false;
        for (const f of P) {
          for (const n of neighbors(arr, f)) {
            for (const id of arr.faces[n]!.inside) {
              if (id !== owner && matches(byId.get(id)!)) touchesOther = true;
            }
          }
        }
        if (!touchesOther) return doc;
      }
    }
  }

  const cut = new Set<string>(); // shapes that lose the painted faces
  const merge = new Set<string>(); // same-colored shapes that absorb them
  for (const f of P) {
    for (const id of arr.faces[f]!.inside) {
      const s = byId.get(id);
      if (!s) continue;
      if (matches(s)) merge.add(id);
      else cut.add(id);
    }
    if (fill !== null) {
      for (const n of neighbors(arr, f)) {
        if (P.has(n)) continue;
        for (const id of arr.faces[n]!.inside) {
          const s = byId.get(id);
          if (s && matches(s)) merge.add(id);
        }
      }
    }
  }

  const replaced = new Map<string, Ring[] | null>();
  for (const id of cut) {
    const rest = (facesOf.get(id) ?? []).filter((f) => !P.has(f));
    replaced.set(id, rest.length ? outline(arr, rest) : null);
  }

  let merged: Shape | null = null;
  let mergedAt = -1;
  if (fill !== null) {
    const all = new Set<number>(P);
    let group: string | undefined;
    let first = true;
    for (const id of merge) {
      for (const f of facesOf.get(id) ?? []) all.add(f);
      const g = byId.get(id)!.group;
      if (first) group = g;
      else if (group !== g) group = undefined;
      first = false;
      mergedAt = Math.max(mergedAt, doc.shapes.findIndex((s) => s.id === id));
    }
    const rings = outline(arr, all);
    if (rings.length) {
      const keep = merge.size ? byId.get([...merge][0]!)! : null;
      merged = { id: keep?.id ?? uid('s'), rings, fill, group: merge.size ? group : undefined };
    }
  }

  const shapes: Shape[] = [];
  const dirtyGroups = new Set<string>();
  doc.shapes.forEach((s, i) => {
    if (merge.has(s.id)) {
      if (s.group) dirtyGroups.add(s.group);
      if (i === mergedAt && merged) shapes.push(merged);
      return;
    }
    if (replaced.has(s.id)) {
      if (s.group) dirtyGroups.add(s.group);
      const rings = replaced.get(s.id);
      if (rings && rings.length) shapes.push({ ...s, rings });
      return;
    }
    shapes.push(s);
  });
  if (merged && mergedAt < 0) shapes.push(merged);

  // Groups: anything cut or merged is no longer "as typed"; drop emptied groups.
  const used = new Set<string>();
  for (const s of shapes) if (s.group) used.add(s.group);
  const groups: Doc['groups'] = {};
  for (const [id, g] of Object.entries(doc.groups)) {
    if (!used.has(id)) continue;
    groups[id] = dirtyGroups.has(id) && g.text?.pristine ? { ...g, text: { ...g.text, pristine: false } } : g;
  }

  return { ...doc, shapes, groups, updatedAt: Date.now() };
}
