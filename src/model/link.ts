/**
 * Keeping fills in step with their outlines.
 *
 * A shape that was colored in between outlines remembers *which* outlines and
 * *where it lay relative to them* ("inside the circle, outside the ellipse,
 * above the line"), not coordinates. When one of those outlines is moved,
 * reshaped or thickened, the shape is worked out again from that description,
 * so the fill follows instead of being left behind.
 *
 * A shape stops following once it is moved on its own, cut, or its outlines
 * are deleted: from then on it stands by itself.
 */
import { buildArrangement, faceBoundaryKeys, outline, regionBoundaryKeys, withFollowers, type Arrangement, type Source } from '@/engine';
import { carrierKey, flattenChain, windingOfPolygon, type Chain, type Pt, type Ring } from '@/geom';
import { board } from './doc';
import { guideArea, guideChains, reach } from './guides';
import type { Doc, Guide, Link, Seed, Shape } from './types';

interface ChainInfo {
  key: string;
  closed: boolean;
  poly: Pt[];
}

/** The outlines' chains as the engine sees them, and which chain each carrier belongs to. */
export function chainIndex(guides: Guide[]): { sources: Source[]; byCarrier: Map<string, string[]>; chains: Map<string, ChainInfo> } {
  const sources: Source[] = [];
  const byCarrier = new Map<string, string[]>();
  const chains = new Map<string, ChainInfo>();
  for (const g of guides) {
    const list = guideChains(g);
    if (!list.length) continue;
    const reached: Chain[] = [];
    list.forEach((c, i) => {
      const key = `${g.id}#${i}`;
      const r = reach(c);
      reached.push(r);
      chains.set(key, { key, closed: c.closed, poly: flattenChain(c, 0.25) });
      for (const e of r.edges) {
        const k = carrierKey(e.c);
        const have = byCarrier.get(k);
        if (!have) byCarrier.set(k, [key]);
        else if (!have.includes(key)) have.push(key);
      }
    });
    sources.push({ id: g.id, fill: false, chains: reached });
  }
  return { sources, byCarrier, chains };
}

/** Which side of an open chain a point is on: the sign of the turn at its nearest stretch. */
function sideOf(p: Pt, poly: Pt[]): 1 | -1 {
  let best = Infinity;
  let side: 1 | -1 = 1;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best) {
      best = d;
      side = dx * (p.y - a.y) - dy * (p.x - a.x) >= 0 ? 1 : -1;
    }
  }
  return side;
}

/** Where a face lies relative to the given chains. */
function describe(arr: Arrangement, faceId: number, relevant: Set<string>, idx: ReturnType<typeof chainIndex>): Seed {
  const c = arr.faces[faceId]!.center;
  const along = new Set<string>();
  for (const k of faceBoundaryKeys(arr, faceId)) for (const key of idx.byCarrier.get(k) ?? []) along.add(key);
  const seed: Seed = { in: [], sides: {} };
  for (const key of relevant) {
    const info = idx.chains.get(key);
    if (!info) continue;
    if (info.closed) {
      if (windingOfPolygon(c, info.poly) !== 0) seed.in.push(key);
    } else if (along.has(key)) {
      seed.sides[key] = sideOf(c, info.poly);
    }
  }
  seed.in.sort();
  return seed;
}

const sameIn = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Describe a set of faces of the document's arrangement as a link to the
 * outlines around it. Undefined when part of its edge is not an outline (the
 * edge of a letter, say): such a shape cannot follow anything.
 */
export function linkForFaces(arr: Arrangement, faces: Iterable<number>, idx: ReturnType<typeof chainIndex>): Link | undefined {
  const set = faces instanceof Set ? (faces as Set<number>) : new Set(faces);
  const relevant = new Set<string>();
  for (const keys of regionBoundaryKeys(arr, set)) {
    let found = false;
    for (const k of keys) {
      for (const key of idx.byCarrier.get(k) ?? []) {
        relevant.add(key);
        found = true;
      }
    }
    if (!found) return undefined;
  }
  if (!relevant.size) return undefined;
  const seeds: Seed[] = [];
  const seen = new Set<string>();
  for (const f of set) {
    if (arr.faces[f]!.follow >= 0) continue;
    const seed = describe(arr, f, relevant, idx);
    const id = JSON.stringify(seed);
    if (!seen.has(id)) {
      seen.add(id);
      seeds.push(seed);
    }
  }
  if (!seeds.length) return undefined;
  const guides = [...new Set([...relevant].map((k) => k.slice(0, k.lastIndexOf('#'))))];
  return { guides, seeds };
}

/** Work a linked shape out again from its outlines as they are now. Null = its outlines are gone. */
export function rederive(doc: Doc, link: Link): Ring[] | null {
  if ('area' in link) {
    const g = doc.guides.find((x) => x.id === link.area);
    if (!g) return null;
    return guideArea(g);
  }
  const guides: Guide[] = [];
  for (const id of link.guides) {
    const g = doc.guides.find((x) => x.id === id);
    if (!g) return null;
    guides.push(g);
  }
  const idx = chainIndex(guides);
  const b = board(doc);
  const arr = buildArrangement(idx.sources, { bounds: { x: b.x - b.w, y: b.y - b.h, w: b.w * 3, h: b.h * 3 } });
  const relevant = new Set<string>(idx.chains.keys());
  const match: number[] = [];
  for (const f of arr.faces) {
    if (f.follow >= 0) continue;
    const here = describe(arr, f.id, relevant, idx);
    for (const seed of link.seeds) {
      if (!sameIn(seed.in, here.in)) continue;
      let ok = true;
      for (const [key, side] of Object.entries(here.sides)) {
        const want = seed.sides[key];
        if (want !== undefined && want !== side) {
          ok = false;
          break;
        }
      }
      if (ok) {
        match.push(f.id);
        break;
      }
    }
  }
  return match.length ? outline(arr, withFollowers(arr, match)) : [];
}

const linkGuides = (link: Link): string[] => ('area' in link ? [link.area] : link.guides);

/**
 * After a change to the document: bring every linked shape whose outlines
 * changed back in step. Shapes the change itself already rewrote are left
 * alone. Shapes whose outlines are gone keep their look and stop following.
 */
export function syncLinks(prev: Doc, next: Doc): Doc {
  if (prev.guides === next.guides) return next;
  if (!next.shapes.some((s) => s.from)) return next;
  const before = new Map(prev.guides.map((g) => [g.id, g]));
  const now = new Map(next.guides.map((g) => [g.id, g]));
  const changed = new Set<string>();
  for (const g of next.guides) if (before.get(g.id) !== g) changed.add(g.id);
  for (const g of prev.guides) if (!now.has(g.id)) changed.add(g.id);
  if (!changed.size) return next;
  const was = new Map(prev.shapes.map((s) => [s.id, s]));
  let touched = false;
  const shapes: Shape[] = [];
  for (const s of next.shapes) {
    if (!s.from || was.get(s.id) !== s || !linkGuides(s.from).some((id) => changed.has(id))) {
      shapes.push(s);
      continue;
    }
    touched = true;
    let rings: Ring[] | null = null;
    try {
      rings = rederive(next, s.from);
    } catch {
      rings = null;
    }
    if (rings === null) shapes.push({ ...s, from: undefined }); // outlines gone: stand alone
    else if (rings.length) shapes.push({ ...s, rings });
    // else: the area no longer exists (two circles pulled apart): the fill goes with it
  }
  return touched ? { ...next, shapes } : next;
}

/**
 * What has to move so that the given things move. A fill that follows outlines
 * is moved by moving those outlines: the fill then comes along by itself, and
 * the two can never drift apart.
 */
export function followSet(doc: Doc, ids: Iterable<string>): Set<string> {
  const set = new Set(ids);
  const have = new Set(doc.guides.map((g) => g.id));
  for (const s of doc.shapes) {
    if (!set.has(s.id) || !s.from) continue;
    const gids = linkGuides(s.from);
    if (!gids.every((id) => have.has(id))) continue; // its outlines are gone: it moves as itself
    set.delete(s.id);
    for (const id of gids) set.add(id);
  }
  return set;
}

/** True when every outline a link depends on is in the given set. */
export function linkWithin(link: Link, ids: ReadonlySet<string>): boolean {
  return linkGuides(link).every((id) => ids.has(id));
}

