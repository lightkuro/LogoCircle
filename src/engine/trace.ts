/**
 * Tracing: from a set of faces back to outlines.
 *
 * `boundaryLoops` walks the half-edges that separate the set from the rest.
 * `outlineRings` then turns each loop of grid segments back into the exact
 * curves they came from, merging neighbouring segments of one carrier into a
 * single edge.
 */
import type { Carrier, Edge, Ring } from '@/geom';
import { evalC } from '@/geom';
import type { Internals } from './dcel';
import { canonAngle, labelSweep, TAUQ, type Label } from './noding';

/** Largest parameter gap (document units along the curve) still merged into one run. */
const GAP = 0.02;

/**
 * Loops of half-edges bounding the union of the given faces, the union kept on
 * the left. At a pinch vertex the walk turns as sharply as possible, so loops
 * touch but never cross.
 */
export function boundaryLoops(
  I: Internals,
  inSet: (f: number) => boolean,
  faces: Iterable<number>,
): number[][] {
  const { faceOfHe, faceHeStart, faceHeList, outStart, outList, pos, ea, eb } = I;
  const isBoundary = (he: number): boolean => {
    const f = faceOfHe[he]!;
    if (f < 0 || !inSet(f)) return false;
    const g = faceOfHe[he ^ 1]!;
    return g < 0 || !inSet(g);
  };
  const starts: number[] = [];
  for (const f of faces) {
    for (let k = faceHeStart[f]!; k < faceHeStart[f + 1]!; k++) {
      const he = faceHeList[k]!;
      if (isBoundary(he)) starts.push(he);
    }
  }
  const visited = new Set<number>();
  const loops: number[][] = [];
  for (const h0 of starts) {
    if (visited.has(h0)) continue;
    const loop: number[] = [];
    let h = h0;
    let guard = 0;
    do {
      visited.add(h);
      loop.push(h);
      const v = h & 1 ? ea[h >> 1]! : eb[h >> 1]!;
      const s = outStart[v]!;
      const deg = outStart[v + 1]! - s;
      const from = pos[h ^ 1]!;
      let nxt = -1;
      for (let k = 1; k <= deg; k++) {
        const cand = outList[s + ((from - k + deg) % deg)]!;
        if (isBoundary(cand)) {
          nxt = cand;
          break;
        }
      }
      if (nxt < 0) break;
      h = nxt;
    } while (h !== h0 && ++guard < 10_000_000);
    if (h === h0 && loop.length >= 2) loops.push(loop);
  }
  return loops;
}

interface Run {
  c: number;
  dir: 1 | -1;
  /** Parameter where the run starts / ends (canonical values from the breakpoint tables). */
  ta: number;
  tb: number;
  /** Signed total parameter travel. */
  sweep: number;
}

function oriented(I: Internals, he: number): Label[] {
  const labs = I.labels[he >> 1]!;
  if ((he & 1) === 0) return labs;
  return labs.map((l) => ({ c: l.c, ta: l.tb, tb: l.ta, dir: l.dir > 0 ? -1 : 1, fw: l.bw, bw: l.fw }));
}

/** Does label b continue label a along the same carrier? */
function continues(I: Internals, a: Label, b: Label): boolean {
  if (a.c !== b.c || a.dir !== b.dir) return false;
  let d = Math.abs(b.ta - a.tb);
  if (I.carriers[a.c]!.k === 'E' && d > TAUQ / 2) d = TAUQ - d;
  return d * I.speed[a.c]! <= GAP;
}

/** Exact outline of the union of the given faces. */
export function outlineRings(I: Internals, faceIds: Iterable<number>): Ring[] {
  const set = new Set<number>();
  for (const f of faceIds) if (f >= 0 && f < I.follow.length) set.add(f);
  if (set.size === 0) return [];
  const loops = boundaryLoops(I, (f) => set.has(f), set);
  const rings: Ring[] = [];
  for (const loop of loops) {
    const ring = loopToRing(I, loop);
    if (ring) rings.push(ring);
  }
  rings.sort((a, b) => {
    const p = evalC(a[0]!.c, a[0]!.t0);
    const q = evalC(b[0]!.c, b[0]!.t0);
    return p.x - q.x || p.y - q.y || a.length - b.length;
  });
  return rings;
}

function loopToRing(I: Internals, loop: number[]): Ring | null {
  const n = loop.length;
  const cand: Label[][] = loop.map((he) => {
    const ls = oriented(I, he);
    if (ls.length < 2) return ls;
    // Deterministic preference that does not depend on registration order.
    return [...ls].sort((a, b) => (I.carrierKeys[a.c]! < I.carrierKeys[b.c]! ? -1 : I.carrierKeys[a.c]! > I.carrierKeys[b.c]! ? 1 : 0));
  });
  for (const c of cand) if (c.length === 0) return null;

  // Start where a run necessarily begins, if there is such a place.
  let start = 0;
  for (let i = 0; i < n; i++) {
    const prev = cand[(i - 1 + n) % n]!;
    const cur = cand[i]!;
    let linked = false;
    for (const a of prev) {
      for (const b of cur) {
        if (continues(I, a, b)) {
          linked = true;
          break;
        }
      }
      if (linked) break;
    }
    if (!linked) {
      start = i;
      break;
    }
  }

  const runs: Run[] = [];
  let i = start;
  let consumed = 0;
  while (consumed < n) {
    let best: Run | null = null;
    let bestLen = 0;
    let bestOwn = -1;
    for (const first of cand[i]!) {
      const periodic = I.carriers[first.c]!.k === 'E';
      let len = 1;
      let cur = first;
      let sweep = labelSweep(periodic, first);
      // How much of the run a filled shape already walks in this very direction:
      // re-tracing a shape then lands on that shape's own carriers.
      let own = first.fw ? 1 : 0;
      while (len < n - consumed) {
        const options = cand[(i + len) % n]!;
        let nxt: Label | undefined;
        for (const b of options) {
          if (continues(I, cur, b)) {
            nxt = b;
            break;
          }
        }
        if (!nxt) break;
        cur = nxt;
        sweep += labelSweep(periodic, nxt);
        if (nxt.fw) own++;
        len++;
      }
      if (len > bestLen || (len === bestLen && own > bestOwn)) {
        bestLen = len;
        bestOwn = own;
        best = { c: first.c, dir: first.dir, ta: first.ta, tb: cur.tb, sweep };
      }
    }
    runs.push(best!);
    i = (i + bestLen) % n;
    consumed += bestLen;
  }

  // The arbitrary start may have cut one run in two.
  if (runs.length > 1) {
    const last = runs[runs.length - 1]!;
    const first = runs[0]!;
    if (
      continues(
        I,
        { c: last.c, dir: last.dir, ta: last.ta, tb: last.tb },
        { c: first.c, dir: first.dir, ta: first.ta, tb: first.tb },
      )
    ) {
      runs[0] = { c: last.c, dir: last.dir, ta: last.ta, tb: first.tb, sweep: last.sweep + first.sweep };
      runs.pop();
    }
  }

  let edges: Edge[] = [];
  if (runs.length === 1 && I.carriers[runs[0]!.c]!.k === 'E') {
    const r = runs[0]!;
    if (Math.abs(Math.abs(r.sweep) - TAUQ) < 1e-6) {
      // A whole ellipse: one edge, from angle 0.
      return [{ c: I.carriers[r.c]!, t0: 0, t1: r.dir * TAUQ }];
    }
  }
  for (const r of runs) {
    const c = I.carriers[r.c]!;
    if (c.k === 'E') {
      const t0 = r.ta;
      const k = Math.round((t0 + r.sweep - r.tb) / TAUQ);
      const t1 = k === 0 ? r.tb : k === 1 ? r.tb + TAUQ : k === -1 ? r.tb - TAUQ : r.tb + k * TAUQ;
      if (t1 === t0) continue;
      edges.push({ c, t0, t1 });
    } else {
      if (r.ta === r.tb) continue;
      edges.push({ c, t0: r.ta, t1: r.tb });
    }
  }
  edges = mergeCollinear(edges);
  if (edges.length === 0) return null;
  if (edges.length < 3 && edges.every((e) => e.c.k === 'L')) return null;

  // Canonical rotation: begin at the leftmost (then topmost) joint.
  let lead = 0;
  let lx = Infinity;
  let ly = Infinity;
  for (let k = 0; k < edges.length; k++) {
    const p = evalC(edges[k]!.c, edges[k]!.t0);
    if (p.x < lx || (p.x === lx && p.y < ly)) {
      lx = p.x;
      ly = p.y;
      lead = k;
    }
  }
  return lead === 0 ? edges : [...edges.slice(lead), ...edges.slice(0, lead)];
}

/** Join neighbouring straight edges that lie on one line. */
function mergeCollinear(edges: Edge[]): Edge[] {
  let out = edges;
  let changed = true;
  while (changed && out.length > 1) {
    changed = false;
    const next: Edge[] = [];
    for (let k = 0; k < out.length; k++) {
      const e = out[k]!;
      const prev = next[next.length - 1];
      const merged = prev ? joinLines(prev, e) : null;
      if (merged) {
        next[next.length - 1] = merged;
        changed = true;
      } else {
        next.push(e);
      }
    }
    if (next.length > 1) {
      const merged = joinLines(next[next.length - 1]!, next[0]!);
      if (merged) {
        next[0] = merged;
        next.pop();
        changed = true;
      }
    }
    out = next;
  }
  return out;
}

function joinLines(a: Edge, b: Edge): Edge | null {
  if (a.c.k !== 'L' || b.c.k !== 'L') return null;
  const a0 = evalC(a.c, a.t0);
  const a1 = evalC(a.c, a.t1);
  const b0 = evalC(b.c, b.t0);
  const b1 = evalC(b.c, b.t1);
  if (Math.hypot(a1.x - b0.x, a1.y - b0.y) > GAP) return null;
  const dx = b1.x - a0.x;
  const dy = b1.y - a0.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  // Same direction, and the shared joint lies on the straight line a0 → b1.
  if ((a1.x - a0.x) * dx + (a1.y - a0.y) * dy <= 0) return null;
  if ((b1.x - b0.x) * dx + (b1.y - b0.y) * dy <= 0) return null;
  const off = Math.abs((a1.x - a0.x) * dy - (a1.y - a0.y) * dx) / len;
  const off2 = Math.abs((b0.x - a0.x) * dy - (b0.y - a0.y) * dx) / len;
  if (off > 1e-5 || off2 > 1e-5) return null;
  if (sameCarrier(a.c, b.c)) return { c: a.c, t0: a.t0, t1: b.t1 };
  return { c: { k: 'L', x0: a0.x, y0: a0.y, x1: b1.x, y1: b1.y }, t0: 0, t1: 1 };
}

function sameCarrier(a: Carrier, b: Carrier): boolean {
  if (a === b) return true;
  if (a.k !== 'L' || b.k !== 'L') return false;
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

export { canonAngle };
