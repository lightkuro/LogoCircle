/**
 * From noded segments to faces: half-edge graph, face cycles, nesting of
 * disconnected pieces, per-source winding, sliver detection.
 *
 * Half-edge 2e runs ea[e] → eb[e], half-edge 2e+1 runs back. A half-edge's
 * face is the one on its left in grid coordinates.
 */
import type { Carrier, Pt } from '@/geom';
import type { Face, Source } from './types';
import { GRID, type Label, type Noded } from './noding';

export interface Internals {
  carriers: Carrier[];
  carrierKeys: string[];
  speed: number[];
  vx: Int32Array;
  vy: Int32Array;
  ea: Int32Array;
  eb: Int32Array;
  labels: Label[][];
  /** CSR: outgoing half-edges of each vertex, sorted by angle. */
  outStart: Int32Array;
  outList: Int32Array;
  /** Position of a half-edge inside its origin vertex's sorted list. */
  pos: Int32Array;
  /** Public face id on the left of each half-edge, −1 = outside everything. */
  faceOfHe: Int32Array;
  /** CSR: the half-edges whose left face is f. */
  faceHeStart: Int32Array;
  faceHeList: Int32Array;
  /** Horizontal bands of non-horizontal edges, for point location. */
  rowY0: number;
  rowH: number;
  rowStart: Int32Array;
  rowEdges: Int32Array;
  follow: Int32Array;
  /** Graph statistics, for tests and diagnostics. */
  stats: { vertices: number; edges: number; components: number; cycles: number; boundedCycles: number };
}

/**
 * Slivers: faces too thin to see or tap. "Thin" is area ÷ perimeter, roughly a
 * quarter of the mean width, in document units. Faces between just two curves
 * (the gap between two almost-coincident outlines) get the wider threshold.
 */
const SLIVER_ANY = 0.02;
const SLIVER_TWO = 0.03;

export const origin = (I: { ea: Int32Array; eb: Int32Array }, he: number): number =>
  he & 1 ? I.eb[he >> 1]! : I.ea[he >> 1]!;
export const head = (I: { ea: Int32Array; eb: Int32Array }, he: number): number =>
  he & 1 ? I.ea[he >> 1]! : I.eb[he >> 1]!;

/**
 * Nearest edge strictly to the left of (x, y) on the horizontal line through
 * it (taken as y + ε), returned as the half-edge whose left face contains the
 * point. −1 if there is none.
 */
export function castLeft(
  I: Pick<Internals, 'vx' | 'vy' | 'ea' | 'eb' | 'rowY0' | 'rowH' | 'rowStart' | 'rowEdges'>,
  x: number,
  y: number,
  skipComp = -1,
  compOfV?: Int32Array,
): number {
  const row = Math.floor((y - I.rowY0) / I.rowH);
  if (row < 0 || row >= I.rowStart.length - 1) return -1;
  let bestE = -1;
  let bestX = -Infinity;
  let bestDx = 0;
  let bestDy = 1;
  for (let k = I.rowStart[row]!; k < I.rowStart[row + 1]!; k++) {
    const e = I.rowEdges[k]!;
    const a = I.ea[e]!;
    const b = I.eb[e]!;
    let lx = I.vx[a]!;
    let ly = I.vy[a]!;
    let hx = I.vx[b]!;
    let hy = I.vy[b]!;
    if (ly > hy) {
      const tx = lx;
      const ty = ly;
      lx = hx;
      ly = hy;
      hx = tx;
      hy = ty;
    }
    if (!(ly <= y && y < hy)) continue;
    if (lx > x && hx > x) continue;
    if (skipComp >= 0 && compOfV![a] === skipComp) continue;
    const dx = hx - lx;
    const dy = hy - ly;
    const xi = lx + ((y - ly) * dx) / dy;
    if (xi > x) continue;
    if (xi > bestX + 1e-9) {
      bestX = xi;
      bestE = e;
      bestDx = dx;
      bestDy = dy;
    } else if (xi >= bestX - 1e-9) {
      // Same crossing point: the edge further right just above the line wins.
      if (dx * bestDy > bestDx * dy) {
        bestX = Math.max(bestX, xi);
        bestE = e;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  if (bestE < 0) return -1;
  // The downward half-edge has the query point on its left.
  return I.vy[I.ea[bestE]!]! > I.vy[I.eb[bestE]!]! ? 2 * bestE : 2 * bestE + 1;
}

function angleHalf(dx: number, dy: number): number {
  return dy > 0 || (dy === 0 && dx > 0) ? 0 : 1;
}

export interface Built {
  I: Internals;
  faces: Face[];
}

export function buildFaces(
  N: Noded,
  sources: Source[],
  boundaryLoops: (I: Internals, inSet: (f: number) => boolean, faces: Iterable<number>) => number[][],
): Built {
  const { vx, vy, ea, eb } = N;
  const nV = vx.length;
  const nE = ea.length;
  const nH = 2 * nE;

  // ---- outgoing half-edges per vertex, sorted by angle ----------------------
  const outStart = new Int32Array(nV + 1);
  for (let e = 0; e < nE; e++) {
    outStart[ea[e]! + 1]!++;
    outStart[eb[e]! + 1]!++;
  }
  for (let v = 0; v < nV; v++) outStart[v + 1]! += outStart[v]!;
  const outList = new Int32Array(nH);
  const fill = outStart.slice(0, nV);
  for (let e = 0; e < nE; e++) {
    outList[fill[ea[e]!]!++] = 2 * e;
    outList[fill[eb[e]!]!++] = 2 * e + 1;
  }
  const pos = new Int32Array(nH);
  const dirX = (he: number): number => (he & 1 ? vx[ea[he >> 1]!]! - vx[eb[he >> 1]!]! : vx[eb[he >> 1]!]! - vx[ea[he >> 1]!]!);
  const dirY = (he: number): number => (he & 1 ? vy[ea[he >> 1]!]! - vy[eb[he >> 1]!]! : vy[eb[he >> 1]!]! - vy[ea[he >> 1]!]!);
  for (let v = 0; v < nV; v++) {
    const s = outStart[v]!;
    const t = outStart[v + 1]!;
    if (t - s > 1) {
      const arr = Array.from(outList.subarray(s, t));
      arr.sort((p, q) => {
        const px = dirX(p);
        const py = dirY(p);
        const qx = dirX(q);
        const qy = dirY(q);
        const hp = angleHalf(px, py);
        const hq = angleHalf(qx, qy);
        if (hp !== hq) return hp - hq;
        const cross = px * qy - py * qx;
        return cross > 0 ? -1 : cross < 0 ? 1 : p - q;
      });
      for (let i = 0; i < arr.length; i++) outList[s + i] = arr[i]!;
    }
    for (let i = s; i < t; i++) pos[outList[i]!] = i - s;
  }

  // ---- next half-edge around the face on the left ---------------------------
  const next = new Int32Array(nH);
  for (let he = 0; he < nH; he++) {
    const twin = he ^ 1;
    const v = he & 1 ? ea[he >> 1]! : eb[he >> 1]!;
    const s = outStart[v]!;
    const deg = outStart[v + 1]! - s;
    next[he] = outList[s + ((pos[twin]! - 1 + deg) % deg)]!;
  }

  // ---- cycles ---------------------------------------------------------------
  const cycleOf = new Int32Array(nH).fill(-1);
  const cycleStart: number[] = [];
  const cycleArea2: number[] = [];
  for (let h0 = 0; h0 < nH; h0++) {
    if (cycleOf[h0]! >= 0) continue;
    const id = cycleStart.length;
    const o = he0Origin(h0);
    const ox = vx[o]!;
    const oy = vy[o]!;
    let sum = 0;
    let peak = 0;
    let h = h0;
    do {
      cycleOf[h] = id;
      const a = h & 1 ? eb[h >> 1]! : ea[h >> 1]!;
      const b = h & 1 ? ea[h >> 1]! : eb[h >> 1]!;
      sum += (vx[a]! - ox) * (vy[b]! - oy) - (vx[b]! - ox) * (vy[a]! - oy);
      const m = Math.abs(sum);
      if (m > peak) peak = m;
      h = next[h]!;
    } while (h !== h0);
    if (peak > 2 ** 52 && Math.abs(sum) < 2 ** 34) {
      // The running total left exact range; redo the sum exactly.
      let big = 0n;
      h = h0;
      do {
        const a = h & 1 ? eb[h >> 1]! : ea[h >> 1]!;
        const b = h & 1 ? ea[h >> 1]! : eb[h >> 1]!;
        big +=
          BigInt(vx[a]! - ox) * BigInt(vy[b]! - oy) - BigInt(vx[b]! - ox) * BigInt(vy[a]! - oy);
        h = next[h]!;
      } while (h !== h0);
      sum = Number(big);
    }
    cycleStart.push(h0);
    cycleArea2.push(sum);
  }
  function he0Origin(h: number): number {
    return h & 1 ? eb[h >> 1]! : ea[h >> 1]!;
  }
  const nC = cycleStart.length;

  // ---- connected components -------------------------------------------------
  const uf = new Int32Array(nV);
  for (let v = 0; v < nV; v++) uf[v] = v;
  const find = (x: number): number => {
    let r = x;
    while (uf[r] !== r) r = uf[r]!;
    while (uf[x] !== r) {
      const n = uf[x]!;
      uf[x] = r;
      x = n;
    }
    return r;
  };
  for (let e = 0; e < nE; e++) {
    const a = find(ea[e]!);
    const b = find(eb[e]!);
    if (a !== b) uf[a] = b;
  }
  const compOfV = new Int32Array(nV).fill(-1);
  const compLeft: number[] = []; // leftmost-lowest vertex per component
  {
    const rootComp = new Map<number, number>();
    const touched = new Uint8Array(nV);
    for (let e = 0; e < nE; e++) {
      touched[ea[e]!] = 1;
      touched[eb[e]!] = 1;
    }
    for (let v = 0; v < nV; v++) {
      if (!touched[v]) continue;
      const r = find(v);
      let c = rootComp.get(r);
      if (c === undefined) {
        c = compLeft.length;
        rootComp.set(r, c);
        compLeft.push(v);
      } else {
        const w = compLeft[c]!;
        if (vx[v]! < vx[w]! || (vx[v]! === vx[w]! && vy[v]! < vy[w]!)) compLeft[c] = v;
      }
      compOfV[v] = c;
    }
  }
  const nComp = compLeft.length;

  // ---- bounded cycles become faces ------------------------------------------
  const faceOfCycle = new Int32Array(nC).fill(-1);
  const faceCycle: number[] = [];
  for (let c = 0; c < nC; c++) {
    if (cycleArea2[c]! > 0) {
      faceOfCycle[c] = faceCycle.length;
      faceCycle.push(c);
    }
  }
  const nF = faceCycle.length;

  // ---- row index for point location -----------------------------------------
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let e = 0; e < nE; e++) {
    const y0 = vy[ea[e]!]!;
    const y1 = vy[eb[e]!]!;
    if (y0 < yMin) yMin = y0;
    if (y1 < yMin) yMin = y1;
    if (y0 > yMax) yMax = y0;
    if (y1 > yMax) yMax = y1;
  }
  if (!isFinite(yMin)) {
    yMin = 0;
    yMax = 1;
  }
  const rows = Math.max(1, Math.min(2048, Math.ceil(Math.sqrt(Math.max(nE, 1)) * 2)));
  const rowH = Math.max(1, Math.ceil((yMax - yMin + 1) / rows));
  const nRows = Math.max(1, Math.ceil((yMax - yMin + 1) / rowH));
  const rowStart = new Int32Array(nRows + 1);
  const rowRange = (e: number): [number, number] => {
    const y0 = vy[ea[e]!]!;
    const y1 = vy[eb[e]!]!;
    const lo = Math.min(y0, y1);
    const hi = Math.max(y0, y1);
    // The edge covers y ∈ [lo, hi).
    return [Math.floor((lo - yMin) / rowH), Math.floor((hi - 1 - yMin) / rowH)];
  };
  for (let e = 0; e < nE; e++) {
    if (vy[ea[e]!] === vy[eb[e]!]) continue;
    const [r0, r1] = rowRange(e);
    for (let r = r0; r <= r1; r++) rowStart[r + 1]!++;
  }
  for (let r = 0; r < nRows; r++) rowStart[r + 1]! += rowStart[r]!;
  const rowEdges = new Int32Array(rowStart[nRows]!);
  {
    const cur = rowStart.slice(0, nRows);
    for (let e = 0; e < nE; e++) {
      if (vy[ea[e]!] === vy[eb[e]!]) continue;
      const [r0, r1] = rowRange(e);
      for (let r = r0; r <= r1; r++) rowEdges[cur[r]!++] = e;
    }
  }
  const locator = { vx, vy, ea, eb, rowY0: yMin, rowH, rowStart, rowEdges };

  // ---- nest each component inside the face that contains it -----------------
  const parentFace = new Int32Array(nComp).fill(-1);
  {
    const order = Array.from({ length: nComp }, (_, i) => i).sort((p, q) => {
      const a = compLeft[p]!;
      const b = compLeft[q]!;
      return vx[a]! - vx[b]! || vy[a]! - vy[b]! || p - q;
    });
    for (const c of order) {
      const v = compLeft[c]!;
      const he = castLeft(locator, vx[v]!, vy[v]!, c, compOfV);
      if (he < 0) continue;
      const cyc = cycleOf[he]!;
      const f = faceOfCycle[cyc]!;
      parentFace[c] = f >= 0 ? f : parentFace[compOfV[ea[he >> 1]!]!]!;
    }
  }

  const faceOfHe = new Int32Array(nH);
  for (let he = 0; he < nH; he++) {
    const f = faceOfCycle[cycleOf[he]!]!;
    faceOfHe[he] = f >= 0 ? f : parentFace[compOfV[ea[he >> 1]!]!]!;
  }

  // ---- half-edges per face --------------------------------------------------
  const faceHeStart = new Int32Array(nF + 1);
  const outside: number[] = [];
  for (let he = 0; he < nH; he++) {
    const f = faceOfHe[he]!;
    if (f >= 0) faceHeStart[f + 1]!++;
    else outside.push(he);
  }
  for (let f = 0; f < nF; f++) faceHeStart[f + 1]! += faceHeStart[f]!;
  const faceHeList = new Int32Array(faceHeStart[nF]!);
  {
    const cur = faceHeStart.slice(0, nF);
    for (let he = 0; he < nH; he++) {
      const f = faceOfHe[he]!;
      if (f >= 0) faceHeList[cur[f]!++] = he;
    }
  }

  // ---- areas: outer cycle minus nested components ---------------------------
  const area2 = new Float64Array(nF);
  for (let f = 0; f < nF; f++) area2[f] = cycleArea2[faceCycle[f]!]!;
  {
    const seen = new Uint8Array(nC);
    for (let c = 0; c < nC; c++) {
      if (faceOfCycle[c]! >= 0 || seen[c]) continue;
      seen[c] = 1;
      const comp = compOfV[he0Origin(cycleStart[c]!)]!;
      const pf = parentFace[comp]!;
      if (pf >= 0) area2[pf]! += cycleArea2[c]!; // negative: carves a hole
    }
  }

  // ---- winding numbers of every filled source, by BFS from outside ----------
  const wind: (Map<number, number> | undefined)[] = new Array(nF + 1);
  {
    const OUT = nF;
    wind[OUT] = new Map();
    const queue: number[] = [OUT];
    for (let qi = 0; qi < queue.length; qi++) {
      const g = queue[qi]!;
      const wg = wind[g]!;
      const lo = g === OUT ? 0 : faceHeStart[g]!;
      const hi = g === OUT ? outside.length : faceHeStart[g + 1]!;
      for (let k = lo; k < hi; k++) {
        const he = g === OUT ? outside[k]! : faceHeList[k]!;
        const t = he ^ 1;
        const f2raw = faceOfHe[t]!;
        const f2 = f2raw < 0 ? OUT : f2raw;
        if (wind[f2]) continue;
        const own = N.owners[he >> 1]!;
        let w2 = wg;
        if (own.length > 0) {
          w2 = new Map(wg);
          const sign = t & 1 ? -1 : 1;
          for (const o of own) {
            const v = (w2.get(o.s) ?? 0) + sign * o.d;
            if (v === 0) w2.delete(o.s);
            else w2.set(o.s, v);
          }
        }
        wind[f2] = w2;
        queue.push(f2);
      }
    }
  }

  const I: Internals = {
    carriers: N.carriers,
    carrierKeys: N.carrierKeys,
    speed: N.speed,
    vx,
    vy,
    ea,
    eb,
    labels: N.labels,
    outStart,
    outList,
    pos,
    faceOfHe,
    faceHeStart,
    faceHeList,
    rowY0: yMin,
    rowH,
    rowStart,
    rowEdges,
    follow: new Int32Array(nF).fill(-1),
    stats: {
      vertices: compOfV.reduce((n, c) => n + (c >= 0 ? 1 : 0), 0),
      edges: nE,
      components: nComp,
      cycles: nC,
      boundedCycles: nF,
    },
  };

  // ---- public faces ---------------------------------------------------------
  const faces: Face[] = [];
  const perimeter = new Float64Array(nF);
  const carrierCount = new Int32Array(nF);
  for (let f = 0; f < nF; f++) {
    const loopsHe = boundaryLoops(I, (g) => g === f, [f]);
    const loops: Pt[][] = [];
    const loopArea: number[] = [];
    const seenCarriers = new Set<number>();
    let per = 0;
    for (const lh of loopsHe) {
      const pts: Pt[] = [];
      let a2 = 0;
      for (const he of lh) {
        const a = he & 1 ? eb[he >> 1]! : ea[he >> 1]!;
        const b = he & 1 ? ea[he >> 1]! : eb[he >> 1]!;
        pts.push({ x: vx[a]! / GRID, y: vy[a]! / GRID });
        a2 += vx[a]! * vy[b]! - vx[b]! * vy[a]!;
        per += Math.hypot(vx[b]! - vx[a]!, vy[b]! - vy[a]!);
        const lab = N.labels[he >> 1]!;
        if (lab.length > 0) seenCarriers.add(lab[0]!.c);
      }
      loops.push(pts);
      loopArea.push(a2);
    }
    // Outer loop first.
    let outer = 0;
    for (let i = 1; i < loops.length; i++) if (Math.abs(loopArea[i]!) > Math.abs(loopArea[outer]!)) outer = i;
    if (outer !== 0) {
      const t = loops[0]!;
      loops[0] = loops[outer]!;
      loops[outer] = t;
    }
    perimeter[f] = per / GRID;
    carrierCount[f] = seenCarriers.size;
    const w = wind[f];
    const inside: string[] = [];
    if (w) {
      for (const s of Array.from(w.keys()).sort((p, q) => p - q)) inside.push(sources[s]!.id);
    }
    faces.push({
      id: f,
      area: area2[f]! / 2 / (GRID * GRID),
      loops,
      inside,
      follow: -1,
      center: interiorPoint(loops),
    });
  }

  // ---- slivers follow their largest proper neighbour ------------------------
  {
    const sliver = new Uint8Array(nF);
    for (let f = 0; f < nF; f++) {
      const thin = faces[f]!.area / Math.max(perimeter[f]!, 1e-12);
      if (thin < SLIVER_ANY || (carrierCount[f]! <= 2 && thin < SLIVER_TWO)) sliver[f] = 1;
    }
    const target = new Int32Array(nF).fill(-1);
    const neighboursOf = (f: number): number[] => {
      const out: number[] = [];
      for (let k = faceHeStart[f]!; k < faceHeStart[f + 1]!; k++) {
        const g = faceOfHe[faceHeList[k]! ^ 1]!;
        if (g >= 0 && g !== f && !out.includes(g)) out.push(g);
      }
      return out;
    };
    let pending = 0;
    for (let f = 0; f < nF; f++) {
      if (!sliver[f]) continue;
      let best = -1;
      for (const g of neighboursOf(f)) {
        if (sliver[g]) continue;
        if (best < 0 || faces[g]!.area > faces[best]!.area) best = g;
      }
      target[f] = best;
      if (best < 0) pending++;
    }
    // Slivers surrounded only by slivers borrow a neighbour's target.
    for (let round = 0; round < 64 && pending > 0; round++) {
      let progress = false;
      for (let f = 0; f < nF; f++) {
        if (!sliver[f] || target[f]! >= 0) continue;
        let best = -1;
        for (const g of neighboursOf(f)) {
          if (!sliver[g] || target[g]! < 0) continue;
          if (best < 0 || faces[g]!.area > faces[best]!.area) best = g;
        }
        if (best >= 0) {
          target[f] = target[best]!;
          pending--;
          progress = true;
        }
      }
      if (!progress) break;
    }
    for (let f = 0; f < nF; f++) {
      I.follow[f] = target[f]!;
      faces[f]!.follow = target[f]!;
    }
  }

  return { I, faces };
}

/** A point strictly inside a region given by its loops (document coordinates). */
function interiorPoint(loops: Pt[][]): Pt {
  const outer = loops[0];
  if (!outer || outer.length === 0) return { x: 0, y: 0 };
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of outer) {
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  // Vertices sit on grid lines; a scanline half a grid unit off never hits one.
  const gy = Math.floor(((yMin + yMax) / 2) * GRID) + 0.5;
  const tryLine = (y: number): Pt | null => {
    const xs: number[] = [];
    for (const loop of loops) {
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[j]!;
        const b = loop[i]!;
        if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    if (xs.length < 2) return null;
    xs.sort((p, q) => p - q);
    let best = -1;
    let width = 0;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1]! - xs[i]!;
      if (w > width) {
        width = w;
        best = i;
      }
    }
    if (best < 0) return null;
    return { x: (xs[best]! + xs[best + 1]!) / 2, y };
  };
  const candidates = [gy / GRID, (Math.floor(yMin * GRID) + 0.5) / GRID, (Math.ceil(yMax * GRID) - 0.5) / GRID];
  for (const y of candidates) {
    const p = tryLine(y);
    if (p) return p;
  }
  let sx = 0;
  let sy = 0;
  for (const p of outer) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / outer.length, y: sy / outer.length };
}
