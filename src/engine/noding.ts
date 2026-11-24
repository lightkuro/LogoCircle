/**
 * Noding: turn every source outline into straight segments on an integer grid
 * that only ever meet at shared vertices.
 *
 *  1. Carriers are registered by key, so a shape edge and the guide it was
 *     baked from are literally the same curve and get the same vertices.
 *  2. Exact intersections become "forced" parameters on both carriers.
 *  3. Each carrier is flattened on a fixed sample grid plus its forced
 *     parameters. Every segment remembers the carrier stretch it stands for.
 *  4. Vertices are snapped to the grid; leftover crossings and near-misses are
 *     resolved by hot-pixel snap rounding.
 */
import type { Carrier, Pt } from '@/geom';
import { carrierKey, evalC } from '@/geom';
import { cubicSecondDiff, cubicSpeed, intersectCarriers } from './intersect';
import type { Source } from './types';

/** Grid units per document unit. */
export const GRID = 1024;
/** Angular quantum: ellipse parameters are multiples of this, so unwrapping by a turn is exact. */
const Q = 2 ** -40;
/** One full turn, as a multiple of Q (differs from 2π by < 5e-13). */
export const TAUQ = Math.round((Math.PI * 2) / Q) * Q;
/** Parameters closer than this (document units along the curve) are one breakpoint. */
const MERGE = 1e-6;
/** Chain joints further apart than this are not treated as joints. */
const WELD = 1;
const COORD_LIMIT = 30000;

/** The carrier stretch a segment stands for, oriented a → b of the stored edge. */
export interface Label {
  c: number;
  ta: number;
  tb: number;
  /** +1: parameter increases along the segment (wrapping for ellipses), −1: decreases. */
  dir: 1 | -1;
  /** A filled source walks this stretch along a → b / against it. Used to keep a shape on its own carriers. */
  fw?: boolean;
  bw?: boolean;
}

/** A filled source walks this edge; d = +1 along a → b, −1 against. */
export interface Owner {
  s: number;
  d: 1 | -1;
}

export interface Noded {
  carriers: Carrier[];
  carrierKeys: string[];
  /** Upper bound of |dP/dt| per carrier. */
  speed: number[];
  vx: Int32Array;
  vy: Int32Array;
  ea: Int32Array;
  eb: Int32Array;
  labels: Label[][];
  owners: Owner[][];
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Reduce an ellipse parameter to [0, TAUQ), quantised. */
export function canonAngle(t: number): number {
  let q = Math.round(t / Q) * Q;
  q -= TAUQ * Math.floor(q / TAUQ);
  if (q >= TAUQ) q -= TAUQ;
  if (q < 0) q += TAUQ;
  return q;
}

/** Signed parameter travel of a label (wraps for ellipses). */
export function labelSweep(periodic: boolean, l: Label): number {
  if (!periodic) return l.tb - l.ta;
  if (l.dir > 0) {
    let d = l.tb - l.ta;
    if (d < 0) d += TAUQ;
    return d;
  }
  let d = l.ta - l.tb;
  if (d < 0) d += TAUQ;
  return -d;
}

interface Rec {
  c: Carrier;
  periodic: boolean;
  speed: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  forcedT: number[];
  forcedNode: number[];
  /** forced entry → breakpoint index */
  bpOfForced: Int32Array;
  bpT: number[];
  /** union-find node of the breakpoint, or −1 for a regular sample */
  bpNode: number[];
  bpVert: Int32Array;
}

interface Usage {
  rec: number;
  k0: number;
  k1: number;
  sweep: number;
  src: number;
  own: boolean;
}

export function defaultBounds(sources: Source[]): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number): void => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const s of sources) {
    for (const ch of s.chains) {
      for (const e of ch.edges) {
        const b = carrierBox(e.c);
        add(b[0], b[1]);
        add(b[2], b[3]);
      }
    }
  }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 1, h: 1 };
  const w = Math.max(x1 - x0, 1);
  const h = Math.max(y1 - y0, 1);
  return { x: x0 - w, y: y0 - h, w: 3 * w, h: 3 * h };
}

function carrierBox(c: Carrier): [number, number, number, number] {
  if (c.k === 'L') {
    return [Math.min(c.x0, c.x1), Math.min(c.y0, c.y1), Math.max(c.x0, c.x1), Math.max(c.y0, c.y1)];
  }
  if (c.k === 'E') {
    const cr = Math.cos(c.rot);
    const sr = Math.sin(c.rot);
    const hw = Math.hypot(c.rx * cr, c.ry * sr);
    const hh = Math.hypot(c.rx * sr, c.ry * cr);
    return [c.cx - hw, c.cy - hh, c.cx + hw, c.cy + hh];
  }
  return [
    Math.min(c.x0, c.x1, c.x2, c.x3),
    Math.min(c.y0, c.y1, c.y2, c.y3),
    Math.max(c.x0, c.x1, c.x2, c.x3),
    Math.max(c.y0, c.y1, c.y2, c.y3),
  ];
}

function carrierSpeed(c: Carrier): number {
  if (c.k === 'L') return Math.max(Math.hypot(c.x1 - c.x0, c.y1 - c.y0), 1e-12);
  if (c.k === 'E') return Math.max(c.rx, c.ry, 1e-12);
  return cubicSpeed(c);
}

/** Regular sample count of a carrier — a function of the carrier alone. */
function sampleCount(c: Carrier, tol: number): number {
  if (c.k === 'L') return 0;
  if (c.k === 'E') {
    const r = Math.max(c.rx, c.ry);
    let n = 8;
    if (r > tol) {
      const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)));
      n = Math.ceil((Math.PI * 2) / step);
    }
    n = Math.max(8, Math.min(2048, n));
    return Math.ceil(n / 4) * 4;
  }
  const dd = cubicSecondDiff(c);
  return Math.max(1, Math.min(256, Math.ceil(Math.sqrt((0.75 * dd) / tol))));
}

export function node(sources: Source[], boundsIn: Bounds, tol: number): Noded {
  // ---- bounds, clamped so integer predicates stay exact ---------------------
  const bx0d = Math.max(-COORD_LIMIT, boundsIn.x);
  const by0d = Math.max(-COORD_LIMIT, boundsIn.y);
  const bx1d = Math.min(COORD_LIMIT, boundsIn.x + boundsIn.w);
  const by1d = Math.min(COORD_LIMIT, boundsIn.y + boundsIn.h);
  const BX0 = Math.ceil(bx0d * GRID);
  const BY0 = Math.ceil(by0d * GRID);
  const BX1 = Math.floor(bx1d * GRID);
  const BY1 = Math.floor(by1d * GRID);

  // ---- union-find over forced breakpoints -----------------------------------
  const parent: number[] = [];
  const newNode = (): number => {
    parent.push(parent.length);
    return parent.length - 1;
  };
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[x] !== r) {
      const n = parent[x]!;
      parent[x] = r;
      x = n;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // ---- 1. carrier registry + usages -----------------------------------------
  const recs: Rec[] = [];
  const keys: string[] = [];
  const byKey = new Map<string, number>();
  const getRec = (c: Carrier): number => {
    const key = carrierKey(c);
    let i = byKey.get(key);
    if (i === undefined) {
      i = recs.length;
      byKey.set(key, i);
      keys.push(key);
      const b = carrierBox(c);
      recs.push({
        c,
        periodic: c.k === 'E',
        speed: carrierSpeed(c),
        x0: b[0],
        y0: b[1],
        x1: b[2],
        y1: b[3],
        forcedT: [],
        forcedNode: [],
        bpOfForced: new Int32Array(0),
        bpT: [],
        bpNode: [],
        bpVert: new Int32Array(0),
      });
    }
    return i;
  };
  /** Register a forced parameter; returns its entry index on the carrier. */
  const addForced = (ri: number, t: number): number => {
    const r = recs[ri]!;
    // Quantised, so the same point reached by two different computations is the same number.
    const tc = r.periodic ? canonAngle(t) : Math.round((t < 0 ? 0 : t > 1 ? 1 : t) / Q) * Q;
    const ft = r.forcedT;
    for (let i = 0; i < ft.length; i++) {
      let d = Math.abs(ft[i]! - tc);
      if (r.periodic && d > TAUQ / 2) d = TAUQ - d;
      if (d * r.speed < MERGE) return i;
    }
    ft.push(tc);
    r.forcedNode.push(newNode());
    return ft.length - 1;
  };

  const usages: Usage[] = [];
  for (let si = 0; si < sources.length; si++) {
    const src = sources[si]!;
    for (const chain of src.chains) {
      const first = usages.length;
      const ends: Pt[] = [];
      const starts: Pt[] = [];
      for (const e of chain.edges) {
        let sweep = e.t1 - e.t0;
        if (!(Math.abs(sweep) > 1e-12) || !isFinite(sweep)) continue;
        if (e.c.k === 'L' && Math.hypot(e.c.x1 - e.c.x0, e.c.y1 - e.c.y0) < 1e-9) continue;
        if (e.c.k === 'E') {
          if (!(e.c.rx > 1e-9) || !(e.c.ry > 1e-9)) continue;
          if (sweep > Math.PI * 2) sweep = Math.PI * 2;
          if (sweep < -Math.PI * 2) sweep = -Math.PI * 2;
        }
        const ri = getRec(e.c);
        const k0 = addForced(ri, e.t0);
        const k1 = addForced(ri, e.t1);
        usages.push({ rec: ri, k0, k1, sweep, src: si, own: false });
        starts.push(evalC(e.c, e.t0));
        ends.push(evalC(e.c, e.t1));
      }
      const n = usages.length - first;
      if (n === 0) continue;
      let sound = chain.closed;
      const joints = chain.closed ? n : n - 1;
      for (let j = 0; j < joints; j++) {
        const a = usages[first + j]!;
        const b = usages[first + ((j + 1) % n)]!;
        const p = ends[j]!;
        const q = starts[(j + 1) % n]!;
        if (Math.hypot(p.x - q.x, p.y - q.y) < WELD) {
          union(recs[a.rec]!.forcedNode[a.k1]!, recs[b.rec]!.forcedNode[b.k0]!);
        } else {
          sound = false;
        }
      }
      if (src.fill && sound) {
        for (let j = 0; j < n; j++) usages[first + j]!.own = true;
      }
    }
  }

  // ---- lines: break where they cross the (extended) bounds lines ------------
  for (let ri = 0; ri < recs.length; ri++) {
    const c = recs[ri]!.c;
    if (c.k !== 'L') continue;
    const dx = c.x1 - c.x0;
    const dy = c.y1 - c.y0;
    for (const bx of [bx0d, bx1d]) {
      if (dx !== 0) {
        const t = (bx - c.x0) / dx;
        if (t > 0 && t < 1) addForced(ri, t);
      }
    }
    for (const by of [by0d, by1d]) {
      if (dy !== 0) {
        const t = (by - c.y0) / dy;
        if (t > 0 && t < 1) addForced(ri, t);
      }
    }
  }

  // ---- 2. intersections → forced parameters ---------------------------------
  {
    const order = recs.map((_, i) => i).sort((a, b) => recs[a]!.x0 - recs[b]!.x0);
    const pad = 1e-6;
    for (let oi = 0; oi < order.length; oi++) {
      const i = order[oi]!;
      const A = recs[i]!;
      for (let oj = oi + 1; oj < order.length; oj++) {
        const j = order[oj]!;
        const B = recs[j]!;
        if (B.x0 > A.x1 + pad) break;
        if (B.y0 > A.y1 + pad || B.y1 < A.y0 - pad) continue;
        // Canonical operand order, so the result does not depend on input order.
        const swap = keys[i]! > keys[j]!;
        const ia = swap ? j : i;
        const ib = swap ? i : j;
        const hits = intersectCarriers(recs[ia]!.c, recs[ib]!.c);
        for (const h of hits) {
          const ka = addForced(ia, h.ta);
          const kb = addForced(ib, h.tb);
          union(recs[ia]!.forcedNode[ka]!, recs[ib]!.forcedNode[kb]!);
        }
      }
    }
  }

  // ---- 3. breakpoints per carrier -------------------------------------------
  for (const r of recs) {
    const nf = r.forcedT.length;
    const idx = Array.from({ length: nf }, (_, i) => i).sort((a, b) => r.forcedT[a]! - r.forcedT[b]!);
    const fT = idx.map((i) => r.forcedT[i]!);
    const n = sampleCount(r.c, tol);
    const samples: number[] = [];
    if (n > 0) {
      const period = r.periodic ? TAUQ : 1;
      const step = period / n;
      const guard = 0.3 * step;
      const kStart = r.periodic ? 0 : 1;
      for (let k = kStart; k < n; k++) {
        const t = r.periodic ? canonAngle(k * step) : k / n;
        // Skip a regular sample that sits right next to a forced parameter.
        let lo = 0;
        let hi = fT.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (fT[mid]! < t) lo = mid + 1;
          else hi = mid;
        }
        let near = false;
        if (lo < fT.length && fT[lo]! - t < guard) near = true;
        if (lo > 0 && t - fT[lo - 1]! < guard) near = true;
        if (r.periodic && fT.length > 0) {
          if (fT[0]! + TAUQ - t < guard) near = true;
          if (t + TAUQ - fT[fT.length - 1]! < guard) near = true;
        }
        if (!near) samples.push(t);
      }
    }
    const bpT: number[] = [];
    const bpNode: number[] = [];
    const bpOfForced = new Int32Array(nf);
    let a = 0;
    let b = 0;
    while (a < nf || b < samples.length) {
      if (b >= samples.length || (a < nf && fT[a]! <= samples[b]!)) {
        bpOfForced[idx[a]!] = bpT.length;
        bpT.push(fT[a]!);
        bpNode.push(r.forcedNode[idx[a]!]!);
        a++;
      } else {
        bpT.push(samples[b]!);
        bpNode.push(-1);
        b++;
      }
    }
    r.bpT = bpT;
    r.bpNode = bpNode;
    r.bpOfForced = bpOfForced;
    r.bpVert = new Int32Array(bpT.length).fill(-1);
  }

  // ---- cluster positions ----------------------------------------------------
  const sumX = new Float64Array(parent.length);
  const sumY = new Float64Array(parent.length);
  const cnt = new Int32Array(parent.length);
  for (const r of recs) {
    for (let i = 0; i < r.forcedT.length; i++) {
      const p = evalC(r.c, r.forcedT[i]!);
      const root = find(r.forcedNode[i]!);
      sumX[root]! += p.x;
      sumY[root]! += p.y;
      cnt[root]!++;
    }
  }

  // ---- vertices on the integer grid -----------------------------------------
  const vxs: number[] = [];
  const vys: number[] = [];
  const vmap = new Map<number, number>();
  const OFF = 2 ** 25;
  const gridVertex = (gx: number, gy: number): number => {
    if (gx < BX0) gx = BX0;
    else if (gx > BX1) gx = BX1;
    if (gy < BY0) gy = BY0;
    else if (gy > BY1) gy = BY1;
    const key = (gx + OFF) * 67108864 + (gy + OFF);
    let v = vmap.get(key);
    if (v === undefined) {
      v = vxs.length;
      vmap.set(key, v);
      vxs.push(gx);
      vys.push(gy);
    }
    return v;
  };
  const rootVert = new Int32Array(parent.length).fill(-1);
  const vertOf = (r: Rec, i: number): number => {
    let v = r.bpVert[i]!;
    if (v >= 0) return v;
    const nd = r.bpNode[i]!;
    if (nd >= 0) {
      const root = find(nd);
      v = rootVert[root]!;
      if (v < 0) {
        v = gridVertex(Math.round((sumX[root]! / cnt[root]!) * GRID), Math.round((sumY[root]! / cnt[root]!) * GRID));
        rootVert[root] = v;
      }
    } else {
      const p = evalC(r.c, r.bpT[i]!);
      v = gridVertex(Math.round(p.x * GRID), Math.round(p.y * GRID));
    }
    r.bpVert[i] = v;
    return v;
  };

  // ---- edge set with dedupe -------------------------------------------------
  let ea: number[] = [];
  let eb: number[] = [];
  let labels: Label[][] = [];
  let owners: Owner[][] = [];
  let emap = new Map<number, number>();
  const addEdge = (a: number, b: number, lab: Label[], own: Owner[]): void => {
    if (a === b) return;
    const flip = a > b;
    const lo = flip ? b : a;
    const hi = flip ? a : b;
    const key = lo * 67108864 + hi;
    let e = emap.get(key);
    if (e === undefined) {
      e = ea.length;
      emap.set(key, e);
      ea.push(lo);
      eb.push(hi);
      labels.push([]);
      owners.push([]);
    }
    const L = labels[e]!;
    for (const l of lab) {
      const nl: Label = flip
        ? { c: l.c, ta: l.tb, tb: l.ta, dir: l.dir > 0 ? -1 : 1, fw: l.bw, bw: l.fw }
        : { c: l.c, ta: l.ta, tb: l.tb, dir: l.dir, fw: l.fw, bw: l.bw };
      let dup = false;
      for (const o of L) {
        if (o.c === nl.c && o.dir === nl.dir && o.ta === nl.ta && o.tb === nl.tb) {
          if (nl.fw) o.fw = true;
          if (nl.bw) o.bw = true;
          dup = true;
          break;
        }
      }
      if (!dup) L.push(nl);
    }
    const O = owners[e]!;
    for (const o of own) O.push(flip ? { s: o.s, d: o.d > 0 ? -1 : 1 } : o);
  };

  // ---- walk every usage along its carrier's breakpoints ---------------------
  for (const u of usages) {
    const r = recs[u.rec]!;
    const n = r.bpT.length;
    const i0 = r.bpOfForced[u.k0]!;
    const i1 = r.bpOfForced[u.k1]!;
    const dir: 1 | -1 = u.sweep >= 0 ? 1 : -1;
    let steps: number;
    if (r.periodic) {
      if (i0 === i1) steps = Math.abs(u.sweep) > Math.PI ? n : 0;
      else steps = dir > 0 ? (i1 - i0 + n) % n : (i0 - i1 + n) % n;
    } else {
      steps = Math.abs(i1 - i0);
    }
    const own: Owner[] = u.own ? [{ s: u.src, d: 1 }] : [];
    let i = i0;
    for (let s = 0; s < steps; s++) {
      let j = i + (r.periodic ? dir : i1 > i0 ? 1 : -1);
      if (r.periodic) j = (j + n) % n;
      const ldir: 1 | -1 = r.periodic ? dir : i1 > i0 ? 1 : -1;
      const va = vertOf(r, i);
      const vb = vertOf(r, j);
      if (va !== vb) addEdge(va, vb, [{ c: u.rec, ta: r.bpT[i]!, tb: r.bpT[j]!, dir: ldir, fw: u.own }], own);
      i = j;
    }
  }

  // ---- 4. hot-pixel snap rounding until nothing crosses ---------------------
  const periodicOf = recs.map((r) => r.periodic);
  for (let iter = 0; iter < 16; iter++) {
    const nE = ea.length;
    if (nE === 0) break;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const used = new Uint8Array(vxs.length);
    for (let e = 0; e < nE; e++) {
      used[ea[e]!] = 1;
      used[eb[e]!] = 1;
    }
    for (let v = 0; v < vxs.length; v++) {
      if (!used[v]) continue;
      const x = vxs[v]!;
      const y = vys[v]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    minX -= 2;
    minY -= 2;
    const maxDim = Math.max(maxX - minX, maxY - minY, 1);
    let CS = 2048;
    while (CS < maxDim / 256) CS *= 2;
    const cells = new Map<number, number[]>();
    const put = (cx: number, cy: number, e: number): void => {
      const key = cx * 65536 + cy;
      const list = cells.get(key);
      if (list) list.push(e);
      else cells.set(key, [e]);
    };
    for (let e = 0; e < nE; e++) {
      const x0 = vxs[ea[e]!]!;
      const y0 = vys[ea[e]!]!;
      const x1 = vxs[eb[e]!]!;
      const y1 = vys[eb[e]!]!;
      const lx = Math.min(x0, x1);
      const hx = Math.max(x0, x1);
      const ly = Math.min(y0, y1);
      const hy = Math.max(y0, y1);
      const cx0 = Math.floor((lx - 1 - minX) / CS);
      const cx1 = Math.floor((hx + 1 - minX) / CS);
      const cy0 = Math.floor((ly - 1 - minY) / CS);
      const cy1 = Math.floor((hy + 1 - minY) / CS);
      if (cx1 - cx0 <= 1 || cy1 - cy0 <= 1) {
        for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) put(cx, cy, e);
      } else {
        // Long diagonal: only the cells the segment actually passes through.
        const slope = (y1 - y0) / (x1 - x0);
        for (let cx = cx0; cx <= cx1; cx++) {
          const xa = Math.max(lx, minX + cx * CS - 1);
          const xb = Math.min(hx, minX + (cx + 1) * CS + 1);
          const ya = y0 + (xa - x0) * slope;
          const yb = y0 + (xb - x0) * slope;
          const ra = Math.floor((Math.min(ya, yb) - 1 - minY) / CS);
          const rb = Math.floor((Math.max(ya, yb) + 1 - minY) / CS);
          for (let cy = Math.max(ra, cy0); cy <= Math.min(rb, cy1); cy++) put(cx, cy, e);
        }
      }
    }

    const splits = new Map<number, number[]>();
    const addSplit = (e: number, v: number): void => {
      const list = splits.get(e);
      if (!list) splits.set(e, [v]);
      else if (!list.includes(v)) list.push(v);
    };

    // (a) a vertex sitting on (or within half a grid unit of) another edge
    for (let v = 0; v < used.length; v++) {
      if (!used[v]) continue;
      const px = vxs[v]!;
      const py = vys[v]!;
      const list = cells.get(Math.floor((px - minX) / CS) * 65536 + Math.floor((py - minY) / CS));
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        const e = list[k]!;
        const a = ea[e]!;
        const b = eb[e]!;
        if (a === v || b === v) continue;
        const ax = vxs[a]!;
        const ay = vys[a]!;
        const dx = vxs[b]! - ax;
        const dy = vys[b]! - ay;
        const qx = px - ax;
        const qy = py - ay;
        const dot = qx * dx + qy * dy;
        if (dot <= 0) continue;
        const len2 = dx * dx + dy * dy;
        if (dot >= len2) continue;
        const cross = qx * dy - qy * dx;
        if (4 * cross * cross < len2) addSplit(e, v);
      }
    }

    // (b) two edges properly crossing
    for (const list of cells.values()) {
      const m = list.length;
      if (m < 2) continue;
      for (let i = 0; i < m; i++) {
        const e1 = list[i]!;
        const a = ea[e1]!;
        const b = eb[e1]!;
        const ax = vxs[a]!;
        const ay = vys[a]!;
        const bx = vxs[b]!;
        const by = vys[b]!;
        const l1x = Math.min(ax, bx);
        const h1x = Math.max(ax, bx);
        const l1y = Math.min(ay, by);
        const h1y = Math.max(ay, by);
        for (let j = i + 1; j < m; j++) {
          const e2 = list[j]!;
          const c = ea[e2]!;
          const d = eb[e2]!;
          if (c === a || c === b || d === a || d === b) continue;
          const cx = vxs[c]!;
          const cy = vys[c]!;
          const dx = vxs[d]!;
          const dy = vys[d]!;
          if (Math.max(cx, dx) < l1x || Math.min(cx, dx) > h1x || Math.max(cy, dy) < l1y || Math.min(cy, dy) > h1y) {
            continue;
          }
          const o1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
          const o2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
          if (!((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0))) continue;
          const o3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
          const o4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
          if (!((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) continue;
          const t = o3 / (o3 - o4);
          const w = gridVertex(Math.round(ax + t * (bx - ax)), Math.round(ay + t * (by - ay)));
          if (w !== a && w !== b) addSplit(e1, w);
          if (w !== c && w !== d) addSplit(e2, w);
        }
      }
    }

    if (splits.size === 0) break;

    // Apply every split of this round at once.
    const oa = ea;
    const ob = eb;
    const ol = labels;
    const oo = owners;
    ea = [];
    eb = [];
    labels = [];
    owners = [];
    emap = new Map();
    for (let e = 0; e < nE; e++) {
      const sp = splits.get(e);
      const a = oa[e]!;
      const b = ob[e]!;
      if (!sp) {
        addEdge(a, b, ol[e]!, oo[e]!);
        continue;
      }
      const ax = vxs[a]!;
      const ay = vys[a]!;
      const dx = vxs[b]! - ax;
      const dy = vys[b]! - ay;
      const len2 = dx * dx + dy * dy;
      const pts = sp
        .map((v) => ({ v, s: ((vxs[v]! - ax) * dx + (vys[v]! - ay) * dy) / len2 }))
        .filter((p) => p.s > 0 && p.s < 1)
        .sort((p, q) => p.s - q.s);
      let prevV = a;
      let prevS = 0;
      const emit = (v: number, s: number): void => {
        if (v !== prevV) {
          const lab: Label[] = ol[e]!.map((l) => {
            const sw = labelSweep(periodicOf[l.c]!, l);
            const at = (f: number): number => {
              if (f <= 0) return l.ta;
              if (f >= 1) return l.tb;
              const t = l.ta + sw * f;
              return periodicOf[l.c] ? canonAngle(t) : t;
            };
            return { c: l.c, ta: at(prevS), tb: at(s), dir: l.dir, fw: l.fw, bw: l.bw };
          });
          addEdge(prevV, v, lab, oo[e]!);
        }
        prevV = v;
        prevS = s;
      };
      for (const p of pts) emit(p.v, p.s);
      emit(b, 1);
    }
  }

  return {
    carriers: recs.map((r) => r.c),
    carrierKeys: keys,
    speed: recs.map((r) => r.speed),
    vx: Int32Array.from(vxs),
    vy: Int32Array.from(vys),
    ea: Int32Array.from(ea),
    eb: Int32Array.from(eb),
    labels,
    owners,
  };
}
