import { buildArrangement, neighbors, outline, withFollowers, type Arrangement, type Source } from '@/engine';
import { derivC, evalC, lineEdge, type Chain } from '@/geom';
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
  // What each painted face joins up with: other painted faces and same-colored shapes.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const join = (a: string, b: string): void => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const faceKey = (f: number): string => `f${f}`;
  const shapeKey = (id: string): string => `s${id}`;

  for (const f of P) {
    if (!parent.has(faceKey(f))) parent.set(faceKey(f), faceKey(f));
    for (const id of arr.faces[f]!.inside) {
      const s = byId.get(id);
      if (!s) continue;
      if (matches(s)) {
        merge.add(id);
        join(faceKey(f), shapeKey(id));
      } else cut.add(id);
    }
    if (fill !== null) {
      for (const n of neighbors(arr, f)) {
        if (P.has(n)) {
          join(faceKey(f), faceKey(n));
          continue;
        }
        for (const id of arr.faces[n]!.inside) {
          const s = byId.get(id);
          if (s && matches(s)) {
            merge.add(id);
            join(faceKey(f), shapeKey(id));
          }
        }
      }
    }
  }

  /** Split a set of faces into pieces that hang together edge to edge. */
  const pieces = (faces: number[]): number[][] => {
    const left = new Set(faces);
    const out: number[][] = [];
    for (const start of faces) {
      if (!left.has(start)) continue;
      const piece: number[] = [];
      const stack = [start];
      left.delete(start);
      while (stack.length) {
        const f = stack.pop()!;
        piece.push(f);
        for (const n of neighbors(arr, f)) {
          if (left.has(n)) {
            left.delete(n);
            stack.push(n);
          }
        }
      }
      out.push(piece);
    }
    return out;
  };

  // Shapes that lose faces. A cut that separates a shape leaves separate pieces.
  const replaced = new Map<string, Shape[]>();
  for (const id of cut) {
    const s = byId.get(id)!;
    const rest = (facesOf.get(id) ?? []).filter((f) => !P.has(f));
    const before = pieces(facesOf.get(id) ?? []).length;
    const after = pieces(rest);
    const out: Shape[] = [];
    if (after.length <= before) {
      // Still as many islands as it had (the dot of an i stays with its stem).
      const rings = rest.length ? outline(arr, rest) : [];
      if (rings.length) out.push({ ...s, rings });
    } else {
      after.forEach((piece, i) => {
        const rings = outline(arr, piece);
        if (rings.length) out.push({ ...s, id: i === 0 ? s.id : uid('s'), rings });
      });
    }
    replaced.set(id, out);
  }

  // Newly colored areas: one shape per connected patch, absorbing same-colored neighbours.
  const placed = new Map<number, Shape>(); // index in doc.shapes → shape that takes that place
  const fresh: Shape[] = [];
  if (fill !== null) {
    const clusters = new Map<string, { faces: Set<number>; shapes: string[] }>();
    const cluster = (key: string) => {
      const root = find(key);
      let c = clusters.get(root);
      if (!c) clusters.set(root, (c = { faces: new Set(), shapes: [] }));
      return c;
    };
    for (const f of P) cluster(faceKey(f)).faces.add(f);
    for (const id of merge) {
      const c = cluster(shapeKey(id));
      c.shapes.push(id);
      for (const f of facesOf.get(id) ?? []) c.faces.add(f);
    }
    for (const c of clusters.values()) {
      const rings = outline(arr, c.faces);
      if (!rings.length) continue;
      if (!c.shapes.length) {
        fresh.push({ id: uid('s'), rings, fill });
        continue;
      }
      // Takes the place (and identity) of the topmost shape it absorbed.
      let top = -1;
      let group: string | undefined;
      c.shapes.forEach((id, i) => {
        top = Math.max(top, doc.shapes.findIndex((s) => s.id === id));
        const g = byId.get(id)!.group;
        if (i === 0) group = g;
        else if (group !== g) group = undefined;
      });
      const keep = doc.shapes[top]!;
      placed.set(top, { ...keep, rings, fill, group });
    }
  }

  const shapes: Shape[] = [];
  const dirtyGroups = new Set<string>();
  doc.shapes.forEach((s, i) => {
    if (merge.has(s.id)) {
      if (s.group) dirtyGroups.add(s.group);
      const p = placed.get(i);
      if (p) shapes.push(p);
      return;
    }
    const r = replaced.get(s.id);
    if (r) {
      if (s.group) dirtyGroups.add(s.group);
      shapes.push(...r);
      return;
    }
    shapes.push(s);
  });
  shapes.push(...fresh);

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
