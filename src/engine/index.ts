/**
 * The region engine: turns a pile of overlapping outlines into the areas
 * ("faces") between them, and turns any set of those areas back into exact
 * curves. This is what powers tap-to-color, erasing and boolean operations.
 */
import type { Arrangement, BooleanOp, BuildOptions, Source } from './types';
import type { Chain, Pt, Ring } from '@/geom';
import { buildFaces, castLeft, type Internals } from './dcel';
import { defaultBounds, GRID, node } from './noding';
import { boundaryLoops, outlineRings } from './trace';
import { strokeChain } from './stroke';

export type { Arrangement, BooleanOp, BuildOptions, Face, Source } from './types';
export { TAUQ } from './noding';

const internals = (arr: Arrangement): Internals => arr._ as Internals;

/** Divide the plane by every source outline. */
export function buildArrangement(sources: Source[], opts?: BuildOptions): Arrangement {
  const tol = opts?.tolerance && opts.tolerance > 0 ? opts.tolerance : 0.01;
  const bounds = opts?.bounds ?? defaultBounds(sources);
  const noded = node(sources, bounds, tol);
  const { I, faces } = buildFaces(noded, sources, boundaryLoops);
  return { faces, _: I };
}

/** The face under a point, or −1. A sliver resolves to the face it follows. */
export function faceAt(arr: Arrangement, p: Pt): number {
  const I = internals(arr);
  const he = castLeft(I, p.x * GRID, p.y * GRID);
  if (he < 0) return -1;
  const f = I.faceOfHe[he]!;
  if (f < 0) return -1;
  const t = I.follow[f]!;
  return t >= 0 ? t : f;
}

/** Faces sharing an edge (not just a corner) with the given face. */
export function neighbors(arr: Arrangement, faceId: number): number[] {
  const I = internals(arr);
  if (faceId < 0 || faceId >= I.follow.length) return [];
  const seen = new Set<number>();
  for (let k = I.faceHeStart[faceId]!; k < I.faceHeStart[faceId + 1]!; k++) {
    const g = I.faceOfHe[I.faceHeList[k]! ^ 1]!;
    if (g >= 0 && g !== faceId) seen.add(g);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Like `neighbors`, but two faces whose only shared edges lie on one of the
 * given carriers do not count as neighbours. This is how a cut line separates
 * the two sides of a shape while everything else still hangs together.
 */
export function neighborsNotAcross(arr: Arrangement, faceId: number, carrierKeys: ReadonlySet<string>): number[] {
  const I = internals(arr);
  if (faceId < 0 || faceId >= I.follow.length) return [];
  const seen = new Set<number>();
  for (let k = I.faceHeStart[faceId]!; k < I.faceHeStart[faceId + 1]!; k++) {
    const he = I.faceHeList[k]!;
    const g = I.faceOfHe[he ^ 1]!;
    if (g < 0 || g === faceId || seen.has(g)) continue;
    const labels = I.labels[he >> 1]!;
    let onlyCut = labels.length > 0;
    for (const l of labels) {
      if (!carrierKeys.has(I.carrierKeys[l.c]!)) {
        onlyCut = false;
        break;
      }
    }
    if (!onlyCut) seen.add(g);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/** The carriers (by key) that run along a face's boundary. */
export function faceBoundaryKeys(arr: Arrangement, faceId: number): string[] {
  const I = internals(arr);
  if (faceId < 0 || faceId >= I.follow.length) return [];
  const keys = new Set<string>();
  for (let k = I.faceHeStart[faceId]!; k < I.faceHeStart[faceId + 1]!; k++) {
    for (const l of I.labels[I.faceHeList[k]! >> 1]!) keys.add(I.carrierKeys[l.c]!);
  }
  return [...keys];
}

/**
 * For every stretch of the outer boundary of a set of faces: the carriers that
 * run along it. (Edges between two faces of the set are not boundary.)
 */
export function regionBoundaryKeys(arr: Arrangement, faceIds: Iterable<number>): string[][] {
  const I = internals(arr);
  const set = faceIds instanceof Set ? (faceIds as Set<number>) : new Set(faceIds);
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const f of set) {
    if (f < 0 || f >= I.follow.length) continue;
    for (let k = I.faceHeStart[f]!; k < I.faceHeStart[f + 1]!; k++) {
      const he = I.faceHeList[k]!;
      if (set.has(I.faceOfHe[he ^ 1]!)) continue;
      const keys = I.labels[he >> 1]!.map((l) => I.carrierKeys[l.c]!);
      const id = keys.join('|');
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(keys);
    }
  }
  return out;
}

/** The given faces plus every sliver that follows one of them (transitively). */
export function withFollowers(arr: Arrangement, faceIds: Iterable<number>): Set<number> {
  const I = internals(arr);
  const out = new Set<number>();
  for (const f of faceIds) if (f >= 0 && f < I.follow.length) out.add(f);
  for (let f = 0; f < I.follow.length; f++) {
    const t = I.follow[f]!;
    if (t >= 0 && out.has(t)) out.add(f);
  }
  return out;
}

/**
 * The boundary of the union of the given faces as exact carrier edges.
 * Rings are oriented for nonzero fill (holes run opposite to outer rings).
 */
export function outline(arr: Arrangement, faceIds: Iterable<number>): Ring[] {
  return outlineRings(internals(arr), faceIds);
}

function regionSource(id: string, rings: Ring[]): Source {
  return { id, fill: true, chains: rings.map((r) => ({ edges: r, closed: true })) };
}

/** Boolean operation between two filled regions (each a set of rings, nonzero rule). */
export function booleanOp(op: BooleanOp, a: Ring[], b: Ring[]): Ring[] {
  const arr = buildArrangement([regionSource('a', a), regionSource('b', b)]);
  const keep: number[] = [];
  for (const f of arr.faces) {
    const inA = f.inside.includes('a');
    const inB = f.inside.includes('b');
    const on =
      op === 'unite' ? inA || inB : op === 'subtract' ? inA && !inB : op === 'intersect' ? inA && inB : inA !== inB;
    if (on) keep.push(f.id);
  }
  return outline(arr, keep);
}

/** Resolve self-overlaps: the same region as non-overlapping rings. */
export function normalizeRings(rings: Ring[]): Ring[] {
  const arr = buildArrangement([regionSource('a', rings)]);
  return outline(
    arr,
    arr.faces.filter((f) => f.inside.length > 0).map((f) => f.id),
  );
}

/** The closed outline(s) of a chain drawn with the given thickness, round caps and joins. */
export function strokeOutline(chain: Chain, width: number): Chain[] {
  return strokeChain(chain, width, (parts) => {
    const arr = buildArrangement(parts.map((rings, i) => regionSource(`s${i}`, rings)));
    return outline(
      arr,
      arr.faces.filter((f) => f.inside.length > 0).map((f) => f.id),
    );
  });
}

/** Graph statistics of an arrangement (for tests and diagnostics). */
export function arrangementStats(arr: Arrangement): Internals['stats'] {
  return internals(arr).stats;
}
