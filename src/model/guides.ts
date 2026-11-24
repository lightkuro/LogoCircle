import {
  apply,
  applyVec,
  bboxOfPoints,
  capsuleChain,
  cubicEdge,
  det,
  ellipseChain,
  ellipseEdge,
  flattenChain,
  lineChain,
  lineEdge,
  polygonChain,
  rectChain,
  splineChain,
  transformEdge,
  type BBox,
  type Chain,
  type Edge,
  type Mat,
  type Pt,
} from '@/geom';
import { strokeOutline } from '@/engine';
import type { Guide, PathGuide, PathNode } from './types';

const chainCache = new WeakMap<Guide, Chain[]>();
const centerCache = new WeakMap<Guide, Chain[]>();

function pathEdges(g: PathGuide): Chain {
  const edges: Edge[] = [];
  const n = g.nodes.length;
  const count = g.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = g.nodes[i]!;
    const b = g.nodes[(i + 1) % n]!;
    const hasA = a.ox !== undefined && a.oy !== undefined;
    const hasB = b.ix !== undefined && b.iy !== undefined;
    if (!hasA && !hasB) {
      if (a.x !== b.x || a.y !== b.y) edges.push(lineEdge(a.x, a.y, b.x, b.y));
    } else {
      edges.push(cubicEdge(a.x, a.y, a.ox ?? a.x, a.oy ?? a.y, b.ix ?? b.x, b.iy ?? b.y, b.x, b.y));
    }
  }
  return { edges, closed: g.closed && edges.length > 0 };
}

/** The centreline of a guide, ignoring thickness. */
export function guideCenterline(g: Guide): Chain[] {
  const hit = centerCache.get(g);
  if (hit) return hit;
  let out: Chain[];
  switch (g.type) {
    case 'ellipse':
      out = [ellipseChain(g.cx, g.cy, g.rx, g.ry, g.rot)];
      break;
    case 'rect':
      out = [rectChain(g.cx, g.cy, g.w, g.h, g.rot, g.radius)];
      break;
    case 'line':
      out = [lineChain(g.x0, g.y0, g.x1, g.y1)];
      break;
    case 'poly':
      out = [polygonChain(g.pts)];
      break;
    case 'curve':
      out = [splineChain(g.pts, g.closed)];
      break;
    case 'path':
      out = [pathEdges(g)];
      break;
  }
  out = out.filter((c) => c.edges.length > 0);
  centerCache.set(g, out);
  return out;
}

export function guideWidth(g: Guide): number {
  return g.type === 'line' || g.type === 'curve' || g.type === 'path' ? g.width : 0;
}

/**
 * The outline a guide contributes to the canvas: its centreline, or, for a
 * thick line/curve, the band around it.
 */
export function guideChains(g: Guide): Chain[] {
  const hit = chainCache.get(g);
  if (hit) return hit;
  let out: Chain[];
  const w = guideWidth(g);
  if (w > 0) {
    if (g.type === 'line') {
      out = [capsuleChain(g.x0, g.y0, g.x1, g.y1, w)];
    } else {
      out = [];
      for (const c of guideCenterline(g)) {
        try {
          out.push(...strokeOutline(c, w));
        } catch {
          out.push(c);
        }
      }
    }
  } else {
    out = guideCenterline(g);
  }
  chainCache.set(g, out);
  return out;
}

/** Does this guide enclose an area all by itself? */
export function isClosedGuide(g: Guide): boolean {
  return guideChains(g).some((c) => c.closed);
}

export function guidePoints(g: Guide, tol = 0.5): Pt[][] {
  return guideChains(g).map((c) => flattenChain(c, tol));
}

export function guideBBox(g: Guide): BBox {
  const pts: Pt[] = [];
  for (const c of guideChains(g)) pts.push(...flattenChain(c, 0.01));
  return bboxOfPoints(pts);
}

const scaleOf = (m: Mat): number => Math.sqrt(Math.abs(det(m)));

function transformNode(n: PathNode, m: Mat): PathNode {
  const p = apply(m, n);
  const out: PathNode = { x: p.x, y: p.y };
  if (n.ix !== undefined && n.iy !== undefined) {
    const q = apply(m, { x: n.ix, y: n.iy });
    out.ix = q.x;
    out.iy = q.y;
  }
  if (n.ox !== undefined && n.oy !== undefined) {
    const q = apply(m, { x: n.ox, y: n.oy });
    out.ox = q.x;
    out.oy = q.y;
  }
  return out;
}

/** Apply an affine transform to a guide, keeping it the same kind where geometry allows. */
export function transformGuide(g: Guide, m: Mat): Guide {
  switch (g.type) {
    case 'ellipse': {
      const e = transformEdge(ellipseEdge(g.cx, g.cy, g.rx, g.ry, g.rot), m);
      if (e.c.k !== 'E') return g;
      return { ...g, cx: e.c.cx, cy: e.c.cy, rx: e.c.rx, ry: e.c.ry, rot: e.c.rot };
    }
    case 'rect': {
      const c = apply(m, { x: g.cx, y: g.cy });
      const u = applyVec(m, { x: Math.cos(g.rot), y: Math.sin(g.rot) });
      const v = applyVec(m, { x: -Math.sin(g.rot), y: Math.cos(g.rot) });
      const lu = Math.hypot(u.x, u.y);
      const lv = Math.hypot(v.x, v.y);
      if (Math.abs(u.x * v.x + u.y * v.y) > 1e-6 * lu * lv) {
        // Sheared: it is no longer a rectangle.
        const hw = g.w / 2;
        const hh = g.h / 2;
        const cr = Math.cos(g.rot);
        const sr = Math.sin(g.rot);
        const P = (x: number, y: number): Pt =>
          apply(m, { x: g.cx + x * cr - y * sr, y: g.cy + x * sr + y * cr });
        return { id: g.id, type: 'poly', pts: [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)], hidden: g.hidden, locked: g.locked };
      }
      return {
        ...g,
        cx: c.x,
        cy: c.y,
        w: g.w * lu,
        h: g.h * lv,
        rot: Math.atan2(u.y, u.x),
        radius: g.radius * Math.min(lu, lv),
      };
    }
    case 'line': {
      const a = apply(m, { x: g.x0, y: g.y0 });
      const b = apply(m, { x: g.x1, y: g.y1 });
      return { ...g, x0: a.x, y0: a.y, x1: b.x, y1: b.y, width: g.width * scaleOf(m) };
    }
    case 'poly':
      return { ...g, pts: g.pts.map((p) => apply(m, p)) };
    case 'curve':
      return { ...g, pts: g.pts.map((p) => apply(m, p)), width: g.width * scaleOf(m) };
    case 'path':
      return { ...g, nodes: g.nodes.map((n) => transformNode(n, m)), width: g.width * scaleOf(m) };
  }
}

/** The points a person can grab and drag on a guide, in document space. */
export function guideHandles(g: Guide): Pt[] {
  switch (g.type) {
    case 'line':
      return [
        { x: g.x0, y: g.y0 },
        { x: g.x1, y: g.y1 },
      ];
    case 'poly':
    case 'curve':
      return g.pts;
    case 'path':
      return g.nodes.map((n) => ({ x: n.x, y: n.y }));
    default:
      return [];
  }
}

/** Move one draggable point of a guide. */
export function moveGuideHandle(g: Guide, index: number, p: Pt): Guide {
  switch (g.type) {
    case 'line':
      return index === 0 ? { ...g, x0: p.x, y0: p.y } : { ...g, x1: p.x, y1: p.y };
    case 'poly':
    case 'curve':
      return { ...g, pts: g.pts.map((q, i) => (i === index ? { x: p.x, y: p.y } : q)) };
    case 'path': {
      const nodes = g.nodes.map((n, i) => {
        if (i !== index) return n;
        const dx = p.x - n.x;
        const dy = p.y - n.y;
        const out: PathNode = { x: p.x, y: p.y };
        if (n.ix !== undefined && n.iy !== undefined) {
          out.ix = n.ix + dx;
          out.iy = n.iy + dy;
        }
        if (n.ox !== undefined && n.oy !== undefined) {
          out.ox = n.ox + dx;
          out.oy = n.oy + dy;
        }
        return out;
      });
      return { ...g, nodes };
    }
    default:
      return g;
  }
}

/** Points worth snapping to: centres, ends, corners. */
export function guideSnapPoints(g: Guide): Pt[] {
  switch (g.type) {
    case 'ellipse': {
      const cr = Math.cos(g.rot);
      const sr = Math.sin(g.rot);
      return [
        { x: g.cx, y: g.cy },
        { x: g.cx + g.rx * cr, y: g.cy + g.rx * sr },
        { x: g.cx - g.rx * cr, y: g.cy - g.rx * sr },
        { x: g.cx - g.ry * sr, y: g.cy + g.ry * cr },
        { x: g.cx + g.ry * sr, y: g.cy - g.ry * cr },
      ];
    }
    case 'rect': {
      const cr = Math.cos(g.rot);
      const sr = Math.sin(g.rot);
      const P = (x: number, y: number): Pt => ({ x: g.cx + x * cr - y * sr, y: g.cy + x * sr + y * cr });
      const hw = g.w / 2;
      const hh = g.h / 2;
      return [{ x: g.cx, y: g.cy }, P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)];
    }
    case 'line':
      return [
        { x: g.x0, y: g.y0 },
        { x: g.x1, y: g.y1 },
        { x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2 },
      ];
    case 'poly':
    case 'curve':
      return g.pts;
    case 'path':
      return g.nodes.map((n) => ({ x: n.x, y: n.y }));
  }
}

/** Drag one bezier handle of a pen-path node. Unless `free`, the opposite handle mirrors it. */
export function movePathControl(g: PathGuide, index: number, which: 'in' | 'out', p: Pt, free: boolean): PathGuide {
  const nodes = g.nodes.map((n, i) => {
    if (i !== index) return n;
    const out: PathNode = { ...n };
    if (which === 'in') {
      out.ix = p.x;
      out.iy = p.y;
      if (!free && n.ox !== undefined && n.oy !== undefined) {
        const len = Math.hypot(n.ox - n.x, n.oy - n.y);
        const d = Math.hypot(p.x - n.x, p.y - n.y) || 1;
        out.ox = n.x - ((p.x - n.x) / d) * len;
        out.oy = n.y - ((p.y - n.y) / d) * len;
      }
    } else {
      out.ox = p.x;
      out.oy = p.y;
      if (!free && n.ix !== undefined && n.iy !== undefined) {
        const len = Math.hypot(n.ix - n.x, n.iy - n.y);
        const d = Math.hypot(p.x - n.x, p.y - n.y) || 1;
        out.ix = n.x - ((p.x - n.x) / d) * len;
        out.iy = n.y - ((p.y - n.y) / d) * len;
      }
    }
    return out;
  });
  return { ...g, nodes };
}

/** Remove one point from a guide, if it can spare it. Returns null when it cannot. */
export function removeGuidePoint(g: Guide, index: number): Guide | null {
  switch (g.type) {
    case 'poly':
      return g.pts.length > 3 ? { ...g, pts: g.pts.filter((_, i) => i !== index) } : null;
    case 'curve':
      return g.pts.length > 2 ? { ...g, pts: g.pts.filter((_, i) => i !== index) } : null;
    case 'path':
      return g.nodes.length > 2 ? { ...g, nodes: g.nodes.filter((_, i) => i !== index) } : null;
    default:
      return null;
  }
}

/** Switch a pen-path node between a sharp corner and a smooth point. */
export function togglePathNode(g: PathGuide, index: number): PathGuide {
  const n = g.nodes.length;
  const nodes = g.nodes.map((node, i) => {
    if (i !== index) return node;
    if (node.ix !== undefined || node.ox !== undefined) return { x: node.x, y: node.y };
    const prev = g.nodes[(i - 1 + n) % n]!;
    const next = g.nodes[(i + 1) % n]!;
    const tx = (next.x - prev.x) / 6;
    const ty = (next.y - prev.y) / 6;
    return { x: node.x, y: node.y, ix: node.x - tx, iy: node.y - ty, ox: node.x + tx, oy: node.y + ty };
  });
  return { ...g, nodes };
}
