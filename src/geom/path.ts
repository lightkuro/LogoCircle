import type { Chain, Edge, Pt, Ring } from './types';
import { evalC, subCubic, TAU } from './carrier';

/** Compact number formatting for SVG output. */
export function fmt(n: number, digits = 2): string {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return (r === 0 ? 0 : r).toString();
}

const RAD2DEG = 180 / Math.PI;

/**
 * Append the drawing commands for one edge, assuming the pen is already at the
 * edge's start. `end` overrides the end point so that neighbouring edges meet
 * exactly even if their carriers disagree by a hair.
 */
function edgeCommands(e: Edge, end: Pt, digits: number, out: string[]): void {
  const c = e.c;
  if (c.k === 'L') {
    out.push(`L${fmt(end.x, digits)} ${fmt(end.y, digits)}`);
    return;
  }
  if (c.k === 'C') {
    const s = e.t0 === 0 && e.t1 === 1 ? c : subCubic(c, e.t0, e.t1);
    out.push(
      `C${fmt(s.x1, digits)} ${fmt(s.y1, digits)} ${fmt(s.x2, digits)} ${fmt(s.y2, digits)} ${fmt(end.x, digits)} ${fmt(end.y, digits)}`,
    );
    return;
  }
  // Ellipse: SVG arcs must each sweep at most half a turn.
  const sweep = e.t1 - e.t0;
  const abs = Math.abs(sweep);
  if (abs < 1e-12) {
    out.push(`L${fmt(end.x, digits)} ${fmt(end.y, digits)}`);
    return;
  }
  const pieces = Math.max(1, Math.ceil(abs / Math.PI - 1e-9));
  const rot = fmt(c.rot * RAD2DEG, 3);
  const rx = fmt(c.rx, digits);
  const ry = fmt(c.ry, digits);
  const flag = sweep > 0 ? 1 : 0;
  for (let i = 1; i <= pieces; i++) {
    const p = i === pieces ? end : evalC(c, e.t0 + (sweep * i) / pieces);
    out.push(`A${rx} ${ry} ${rot} 0 ${flag} ${fmt(p.x, digits)} ${fmt(p.y, digits)}`);
  }
}

function joint(a: Edge, b: Edge): Pt {
  const p = evalC(a.c, a.t1);
  const q = evalC(b.c, b.t0);
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

/** SVG path data for one closed ring. */
export function ringToPath(ring: Ring, digits = 2): string {
  const n = ring.length;
  if (n === 0) return '';
  const out: string[] = [];
  // A ring made of a single full-turn ellipse edge has no distinct joint.
  const start = n === 1 ? evalC(ring[0]!.c, ring[0]!.t0) : joint(ring[n - 1]!, ring[0]!);
  out.push(`M${fmt(start.x, digits)} ${fmt(start.y, digits)}`);
  for (let i = 0; i < n; i++) {
    const e = ring[i]!;
    const end = i === n - 1 ? start : joint(e, ring[i + 1]!);
    edgeCommands(e, end, digits, out);
  }
  out.push('Z');
  return out.join('');
}

export function ringsToPath(rings: Ring[], digits = 2): string {
  return rings.map((r) => ringToPath(r, digits)).join('');
}

/** SVG path data for an open or closed chain. */
export function chainToPath(chain: Chain, digits = 2): string {
  if (chain.edges.length === 0) return '';
  if (chain.closed) return ringToPath(chain.edges, digits);
  const out: string[] = [];
  const edges = chain.edges;
  const s = evalC(edges[0]!.c, edges[0]!.t0);
  out.push(`M${fmt(s.x, digits)} ${fmt(s.y, digits)}`);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    const end = i === edges.length - 1 ? evalC(e.c, e.t1) : joint(e, edges[i + 1]!);
    edgeCommands(e, end, digits, out);
  }
  return out.join('');
}

export function chainsToPath(chains: Chain[], digits = 2): string {
  return chains.map((c) => chainToPath(c, digits)).join('');
}

/** A polygon (flattened loop) as path data — used for live previews. */
export function polygonToPath(pts: Pt[], digits = 2): string {
  if (pts.length === 0) return '';
  let d = `M${fmt(pts[0]!.x, digits)} ${fmt(pts[0]!.y, digits)}`;
  for (let i = 1; i < pts.length; i++) d += `L${fmt(pts[i]!.x, digits)} ${fmt(pts[i]!.y, digits)}`;
  return d + 'Z';
}

export { TAU };
