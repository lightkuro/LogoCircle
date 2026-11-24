import type { Edge, Mat, Ring } from './types';
import { cubicEdge, ellipseFromAxes, evalC, lineEdge } from './carrier';
import { IDENTITY, mul, rotate, scale, translate } from './mat';

/** One subpath of parsed SVG path data. */
export interface SubPath {
  edges: Edge[];
  closed: boolean;
}

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/**
 * An SVG elliptical-arc segment (endpoint form) as an edge on an ellipse
 * carrier. Follows the conversion in the SVG 1.1 implementation notes (F.6.5).
 */
export function svgArc(x1: number, y1: number, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): Edge {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx < 1e-9 || ry < 1e-9 || (x1 === x2 && y1 === y2)) return lineEdge(x1, y1, x2, y2);
  const phi = (phiDeg * Math.PI) / 180;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy;
  const y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let k = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cxp = (k * rx * y1p) / ry;
  const cyp = (-k * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const a1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  const a2 = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx);
  let da = a2 - a1;
  if (sweep && da < 0) da += Math.PI * 2;
  else if (!sweep && da > 0) da -= Math.PI * 2;
  const r = ellipseFromAxes(cx, cy, rx * cp, rx * sp, -ry * sp, ry * cp);
  return { c: r.c, t0: r.sign * a1 + r.shift, t1: r.sign * (a1 + da) + r.shift };
}

/** Parse SVG path data into subpaths of exact edges. */
export function parsePath(d: string): SubPath[] {
  const subs: SubPath[] = [];
  let cur: Edge[] = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let px = 0; // previous control point, for S and T
  let py = 0;
  let prev = '';
  const n = d.length;

  const skip = (): void => {
    while (i < n && (d.charCodeAt(i) <= 32 || d[i] === ',')) i++;
  };
  const num = (): number => {
    skip();
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) throw new Error(`Bad path data at ${i}`);
    i = NUM.lastIndex;
    return parseFloat(m[0]);
  };
  const flag = (): boolean => {
    skip();
    const c = d[i];
    if (c !== '0' && c !== '1') throw new Error(`Bad arc flag at ${i}`);
    i++;
    return c === '1';
  };
  const hasNum = (): boolean => {
    skip();
    if (i >= n) return false;
    const c = d[i]!;
    return (c >= '0' && c <= '9') || c === '-' || c === '+' || c === '.';
  };
  const flush = (closed: boolean): void => {
    if (cur.length) subs.push({ edges: cur, closed });
    cur = [];
  };
  const lineTo = (nx: number, ny: number): void => {
    if (Math.hypot(nx - x, ny - y) > 1e-9) cur.push(lineEdge(x, y, nx, ny));
    x = nx;
    y = ny;
  };

  while (true) {
    skip();
    if (i >= n) break;
    const c = d[i]!;
    if (/[a-zA-Z]/.test(c)) {
      cmd = c;
      i++;
    } else if (!cmd) {
      throw new Error('Path data must start with a command');
    } else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        flush(false);
        x = sx = ox + num();
        y = sy = oy + num();
        break;
      }
      case 'L':
        lineTo(ox + num(), oy + num());
        break;
      case 'H':
        lineTo(ox + num(), y);
        break;
      case 'V':
        lineTo(x, oy + num());
        break;
      case 'C': {
        const x1 = ox + num();
        const y1 = oy + num();
        const x2 = ox + num();
        const y2 = oy + num();
        const nx = ox + num();
        const ny = oy + num();
        cur.push(cubicEdge(x, y, x1, y1, x2, y2, nx, ny));
        px = x2;
        py = y2;
        x = nx;
        y = ny;
        break;
      }
      case 'S': {
        const smooth = prev === 'C' || prev === 'S';
        const x1 = smooth ? 2 * x - px : x;
        const y1 = smooth ? 2 * y - py : y;
        const x2 = ox + num();
        const y2 = oy + num();
        const nx = ox + num();
        const ny = oy + num();
        cur.push(cubicEdge(x, y, x1, y1, x2, y2, nx, ny));
        px = x2;
        py = y2;
        x = nx;
        y = ny;
        break;
      }
      case 'Q':
      case 'T': {
        let qx: number;
        let qy: number;
        if (cmd.toUpperCase() === 'Q') {
          qx = ox + num();
          qy = oy + num();
        } else {
          const smooth = prev === 'Q' || prev === 'T';
          qx = smooth ? 2 * x - px : x;
          qy = smooth ? 2 * y - py : y;
        }
        const nx = ox + num();
        const ny = oy + num();
        cur.push(cubicEdge(x, y, x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny));
        px = qx;
        py = qy;
        x = nx;
        y = ny;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = flag();
        const sweep = flag();
        const nx = ox + num();
        const ny = oy + num();
        if (Math.hypot(nx - x, ny - y) > 1e-9) cur.push(svgArc(x, y, rx, ry, rot, large, sweep, nx, ny));
        x = nx;
        y = ny;
        break;
      }
      case 'Z': {
        if (Math.hypot(sx - x, sy - y) > 1e-6) cur.push(lineEdge(x, y, sx, sy));
        x = sx;
        y = sy;
        flush(true);
        break;
      }
      default:
        throw new Error(`Unknown path command ${cmd}`);
    }
    prev = cmd.toUpperCase();
    if (prev === 'Z') cmd = '';
    // Implicit repeats: more numbers after a command re-run it. Anything else must be a new command.
    skip();
    if (i < n && !hasNum() && !/[a-zA-Z]/.test(d[i]!)) break;
  }
  flush(false);
  return subs;
}

/** Subpaths as rings for filling: open ones are closed with a straight line, as SVG does. */
export function subPathsToRings(subs: SubPath[]): Ring[] {
  const rings: Ring[] = [];
  for (const s of subs) {
    if (!s.edges.length) continue;
    const edges = s.edges.slice();
    if (!s.closed) {
      const a = evalC(edges[edges.length - 1]!.c, edges[edges.length - 1]!.t1);
      const b = evalC(edges[0]!.c, edges[0]!.t0);
      if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) edges.push(lineEdge(a.x, a.y, b.x, b.y));
    }
    if (edges.length < 2 && edges[0]!.c.k !== 'E') continue; // a lone line or curve encloses nothing
    rings.push(edges);
  }
  return rings;
}

/** Parse an SVG `transform` attribute. */
export function parseTransform(t: string | null | undefined): Mat {
  if (!t) return IDENTITY;
  let m: Mat = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(t))) {
    const a = hit[2]!.split(/[\s,]+/).filter(Boolean).map(Number);
    let next: Mat = IDENTITY;
    switch (hit[1]) {
      case 'matrix':
        if (a.length >= 6) next = [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!];
        break;
      case 'translate':
        next = translate(a[0] ?? 0, a[1] ?? 0);
        break;
      case 'scale':
        next = scale(a[0] ?? 1, a[1] ?? a[0] ?? 1);
        break;
      case 'rotate':
        next = rotate(((a[0] ?? 0) * Math.PI) / 180, a[1] ?? 0, a[2] ?? 0);
        break;
      case 'skewX':
        next = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        next = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, next);
  }
  return m;
}
