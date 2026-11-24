import {
  apply,
  applyVec,
  bboxOfPoints,
  barChain,
  capsuleChain,
  cubicEdge,
  derivC,
  det,
  ellipseChain,
  ellipseEdge,
  evalC,
  flattenChain,
  lineChain,
  lineEdge,
  rectChain,
  reverseRing,
  ringArea,
  roundedPolygonChain,
  splineChain,
  transformEdge,
  type BBox,
  type Chain,
  type Edge,
  type Mat,
  type Pt,
  type Ring,
} from '@/geom';
import { booleanOp, strokeOutline } from '@/engine';
import type { Band, Guide, PathGuide, PathNode, PolyGuide, RectGuide } from './types';

const centerCache = new WeakMap<Guide, Chain[]>();
const areaCache = new WeakMap<Guide, Ring[] | null>();
const chainCache = new WeakMap<Guide, Chain[]>();

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

/** The outline itself, ignoring thickness. */
export function guideCenterline(g: Guide): Chain[] {
  const hit = centerCache.get(g);
  if (hit) return hit;
  let out: Chain[];
  switch (g.type) {
    case 'ellipse':
      out = [ellipseChain(g.cx, g.cy, g.rx, g.ry, g.rot)];
      break;
    case 'rect':
      out = [rectOutline(g)];
      break;
    case 'line':
      out = [lineChain(g.x0, g.y0, g.x1, g.y1)];
      break;
    case 'poly':
      out = [roundedPolygonChain(g.pts, g.radii)];
      break;
    case 'curve':
      out = [splineChain(g.pts, g.closed)];
      break;
    case 'path':
      out = [pathEdges(g)];
      break;
    case 'edges':
      out = [{ edges: g.edges, closed: g.closed }];
      break;
  }
  out = out.filter((c) => c.edges.length > 0);
  centerCache.set(g, out);
  return out;
}

export function guideWidth(g: Guide): number {
  return Math.max(0, g.width ?? 0);
}

export function guideBand(g: Guide): Band {
  return (g.type !== 'line' && g.band) || 'in';
}

/** Does the outline close on itself (ignoring thickness)? */
export function isClosedOutline(g: Guide): boolean {
  return guideCenterline(g).some((c) => c.closed);
}

/**
 * A rectangle's outline, grown by `grow` on every side (negative shrinks it).
 * Rounded corners grow with it, as the band of a thick outline needs.
 */
export function rectOutline(g: RectGuide, grow = 0): Chain {
  const w = g.w + grow * 2;
  const h = g.h + grow * 2;
  const round = (r: number): number => (r > 0 ? Math.max(0, r + grow) : 0);
  if (!g.radii) return rectChain(g.cx, g.cy, w, h, g.rot, round(g.radius));
  const cr = Math.cos(g.rot);
  const sr = Math.sin(g.rot);
  const P = (x: number, y: number): Pt => ({ x: g.cx + x * cr - y * sr, y: g.cy + x * sr + y * cr });
  return roundedPolygonChain([P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2)], g.radii.map(round));
}

/** Rough length of a chain, for judging whether a band came out whole. */
function chainLength(c: Chain): number {
  const pts = flattenChain(c, 0.5);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return len;
}

/** Rings of a band along a closed outline: the outline itself and its offset copy. */
function closedBand(g: Guide, center: Chain, w: number, band: Band): Ring[] {
  const inner = band === 'in' ? w : band === 'mid' ? w / 2 : 0;
  const outer = band === 'out' ? w : band === 'mid' ? w / 2 : 0;
  // Circles, ellipses and rectangles stay exact.
  if (g.type === 'ellipse') {
    const rings: Ring[] = [ellipseChain(g.cx, g.cy, g.rx + outer, g.ry + outer, g.rot).edges];
    if (g.rx - inner > 0.5 && g.ry - inner > 0.5) rings.push(reverseRing(ellipseChain(g.cx, g.cy, g.rx - inner, g.ry - inner, g.rot).edges));
    return rings;
  }
  if (g.type === 'rect') {
    const rings: Ring[] = [rectOutline(g, outer).edges];
    if (g.w - inner * 2 > 0.5 && g.h - inner * 2 > 0.5) rings.push(reverseRing(rectOutline(g, -inner).edges));
    return rings;
  }
  // Anything else: a stroke centred on the outline, kept only on the wanted side.
  if (band === 'mid') return centredBand(center, w);
  return sidedBand(center, w, band) ?? centredBand(center, w);
}

function centredBand(center: Chain, w: number): Ring[] {
  return strokeOutline(center, w)
    .filter((c) => c.closed)
    .map((c) => c.edges);
}

/**
 * A band on one side of a closed outline, or null when that cannot be built:
 * some outlines have no usable inside (they cross themselves, or are too tight
 * for the thickness). The caller then lays the band on both sides instead.
 */
function sidedBand(center: Chain, w: number, band: 'in' | 'out'): Ring[] | null {
  try {
    const stroke = centredBand(center, w * 2);
    const sided = booleanOp(band === 'in' ? 'intersect' : 'subtract', stroke, [center.edges]);
    const got = sided.reduce((a, r) => a + ringArea(r, 0.5), 0);
    const whole = chainLength(center) * w;
    return sided.length && Math.abs(got) > whole * 0.35 ? sided : null;
  } catch {
    return null;
  }
}

const spineCache = new WeakMap<Guide, Chain[]>();

/**
 * The line a thick outline is thick around: the middle of its band. For a
 * band laid inside or outside a closed outline that is not the outline itself
 * but its copy half a thickness in (or out). Pieces cut from an outline are
 * made along this line, so they keep exactly the band they had.
 */
export function bandSpine(g: Guide): Chain[] {
  const hit = spineCache.get(g);
  if (hit) return hit;
  const w = guideWidth(g);
  const band = guideBand(g);
  const out = guideCenterline(g).map((c): Chain => {
    if (!(w > 0) || !c.closed || band === 'mid') return c;
    const half = band === 'in' ? -w / 2 : w / 2;
    if (g.type === 'ellipse') return g.rx + half > 0.5 && g.ry + half > 0.5 ? ellipseChain(g.cx, g.cy, g.rx + half, g.ry + half, g.rot) : c;
    if (g.type === 'rect') return g.w + half * 2 > 0.5 && g.h + half * 2 > 0.5 ? rectOutline(g, half) : c;
    if (!sidedBand(c, w, band)) return c; // the band fell back to both sides
    const rings = sidedBand(c, w / 2, band);
    if (!rings || rings.length !== 2) return c;
    // Of the half band's two edges one is the outline; the other is the middle line.
    const [a, b] = rings as [Ring, Ring];
    const bigger = Math.abs(ringArea(a, 0.5)) >= Math.abs(ringArea(b, 0.5)) ? a : b;
    const edges = band === 'out' ? bigger : bigger === a ? b : a;
    return { edges, closed: true };
  });
  spineCache.set(g, out);
  return out;
}

/**
 * The area a guide encloses on its own, as rings ready to become a shape:
 * the inside of a closed outline, or the band of a thick one. Null for a thin
 * open line, which encloses nothing.
 */
export function guideArea(g: Guide): Ring[] | null {
  if (areaCache.has(g)) return areaCache.get(g)!;
  const w = guideWidth(g);
  let rings: Ring[] = [];
  let any = false;
  for (const c of guideCenterline(g)) {
    try {
      if (w > 0) {
        if (c.closed) rings.push(...closedBand(g, c, w, guideBand(g)));
        else if (g.type === 'line') rings.push((g.ends === 'flat' ? barChain : capsuleChain)(g.x0, g.y0, g.x1, g.y1, w).edges);
        else
          rings.push(
            ...strokeOutline(c, w)
              .filter((x) => x.closed)
              .map((x) => x.edges),
          );
        any = true;
      } else if (c.closed) {
        rings.push(c.edges);
        any = true;
      }
    } catch {
      if (c.closed) {
        rings.push(c.edges);
        any = true;
      }
    }
  }
  const out = any && rings.length ? rings : null;
  areaCache.set(g, out);
  return out;
}

/**
 * Every line a guide puts on the canvas: its outline, or — for a thick one —
 * the edges of its band.
 */
export function guideChains(g: Guide): Chain[] {
  const hit = chainCache.get(g);
  if (hit) return hit;
  let out: Chain[];
  if (guideWidth(g) > 0) {
    const area = guideArea(g);
    out = area ? area.map((edges) => ({ edges, closed: true })) : guideCenterline(g);
  } else {
    out = guideCenterline(g);
  }
  chainCache.set(g, out);
  return out;
}

/** Does this guide enclose an area all by itself? */
export function isClosedGuide(g: Guide): boolean {
  return guideArea(g) !== null;
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

/** Where a direction at angle `rot` points after the transform: keeps selection boxes turning with their object. */
export function turned(rot: number | undefined, m: Mat): number | undefined {
  const u = applyVec(m, { x: Math.cos(rot ?? 0), y: Math.sin(rot ?? 0) });
  const a = Math.atan2(u.y, u.x);
  return Math.abs(a) < 1e-9 ? undefined : a;
}

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
  const k = scaleOf(m);
  const width = g.width !== undefined ? g.width * k : undefined;
  switch (g.type) {
    case 'ellipse': {
      const c = apply(m, { x: g.cx, y: g.cy });
      const u = applyVec(m, { x: Math.cos(g.rot) * g.rx, y: Math.sin(g.rot) * g.rx });
      const v = applyVec(m, { x: -Math.sin(g.rot) * g.ry, y: Math.cos(g.rot) * g.ry });
      const lu = Math.hypot(u.x, u.y);
      const lv = Math.hypot(v.x, v.y);
      if (Math.abs(u.x * v.x + u.y * v.y) <= 1e-6 * lu * lv) {
        // Still upright in its own frame: keep which axis is which, so its box does not jump.
        return { ...g, cx: c.x, cy: c.y, rx: lu, ry: lv, rot: Math.atan2(u.y, u.x), width };
      }
      const e = transformEdge(ellipseEdge(g.cx, g.cy, g.rx, g.ry, g.rot), m);
      if (e.c.k !== 'E') return g;
      return { ...g, cx: e.c.cx, cy: e.c.cy, rx: e.c.rx, ry: e.c.ry, rot: e.c.rot, width };
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
        const P = (x: number, y: number): Pt => apply(m, { x: g.cx + x * cr - y * sr, y: g.cy + x * sr + y * cr });
        const rr = g.radii ?? (g.radius > 0 ? [g.radius, g.radius, g.radius, g.radius] : undefined);
        return { id: g.id, type: 'poly', pts: [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)], radii: rr && [...rr], hidden: g.hidden, locked: g.locked, group: g.group, width, band: g.band };
      }
      const grow = Math.min(lu, lv);
      // Mirrored: the corners swap top for bottom in the rectangle's own frame.
      const mirrored = u.x * v.y - u.y * v.x < 0;
      const r = g.radii;
      const radii: RectGuide['radii'] = r && (mirrored ? [r[3] * grow, r[2] * grow, r[1] * grow, r[0] * grow] : [r[0] * grow, r[1] * grow, r[2] * grow, r[3] * grow]);
      return { ...g, cx: c.x, cy: c.y, w: g.w * lu, h: g.h * lv, rot: Math.atan2(u.y, u.x), radius: g.radius * grow, radii, width };
    }
    case 'line': {
      const a = apply(m, { x: g.x0, y: g.y0 });
      const b = apply(m, { x: g.x1, y: g.y1 });
      return { ...g, x0: a.x, y0: a.y, x1: b.x, y1: b.y, width: g.width * k };
    }
    case 'poly':
      return { ...g, pts: g.pts.map((p) => apply(m, p)), radii: g.radii?.map((r) => r * k), width, rot: turned(g.rot, m) };
    case 'curve':
      return { ...g, pts: g.pts.map((p) => apply(m, p)), width: g.width * k, rot: turned(g.rot, m) };
    case 'path':
      return { ...g, nodes: g.nodes.map((n) => transformNode(n, m)), width: g.width * k, rot: turned(g.rot, m) };
    case 'edges':
      return { ...g, edges: g.edges.map((e) => transformEdge(e, m)), width: g.width * k, rot: turned(g.rot, m) };
  }
}

/** The angle of a guide's selection box. */
export function guideRot(g: Guide): number {
  return g.type === 'line' ? 0 : (g.rot ?? 0);
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
/** A square's corners, in the order its corner rounding uses: top left, top right, bottom right, bottom left. */
export function rectCorners(g: RectGuide): Pt[] {
  const hw = g.w / 2;
  const hh = g.h / 2;
  const c = Math.cos(g.rot);
  const s = Math.sin(g.rot);
  const P = (x: number, y: number): Pt => ({ x: g.cx + x * c - y * s, y: g.cy + x * s + y * c });
  return [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)];
}

/** A square as four free points, so one corner can move on its own (its rounding kept). */
export function rectToPoly(g: RectGuide): PolyGuide {
  const r = g.radii ?? (g.radius > 0 ? [g.radius, g.radius, g.radius, g.radius] : undefined);
  return { id: g.id, type: 'poly', pts: rectCorners(g), radii: r && [...r], hidden: g.hidden, locked: g.locked, group: g.group, width: g.width, band: g.band, rot: g.rot };
}

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

/** Add a point after `index` on a polygon or curve. */
export function insertGuidePoint(g: Guide, index: number, p: Pt): Guide {
  if (g.type === 'poly') {
    const pts = g.pts.slice();
    pts.splice(index + 1, 0, { x: p.x, y: p.y });
    const radii = g.radii ? g.radii.slice() : undefined;
    radii?.splice(index + 1, 0, 0);
    return { ...g, pts, radii };
  }
  if (g.type === 'curve') {
    const pts = g.pts.slice();
    pts.splice(index + 1, 0, { x: p.x, y: p.y });
    return { ...g, pts };
  }
  return g;
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
    case 'edges': {
      if (!g.edges.length) return [];
      const a = g.edges[0]!;
      const b = g.edges[g.edges.length - 1]!;
      return [evalC(a.c, a.t0), evalC(b.c, b.t1)];
    }
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
      return g.pts.length > 3 ? { ...g, pts: g.pts.filter((_, i) => i !== index), radii: g.radii?.filter((_, i) => i !== index) } : null;
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

/** How round a corner can usefully get: half of its shorter side. */
export function maxCornerRadius(g: Guide, index: number): number {
  if (g.type === 'rect') return Math.min(g.w, g.h) / 2;
  if (g.type !== 'poly') return 0;
  const n = g.pts.length;
  const v = g.pts[index]!;
  const a = g.pts[(index - 1 + n) % n]!;
  const b = g.pts[(index + 1) % n]!;
  return Math.min(Math.hypot(a.x - v.x, a.y - v.y), Math.hypot(b.x - v.x, b.y - v.y)) / 2;
}

/** A corner's rounding. Index −1 asks about all corners together (the largest). */
export function cornerRadius(g: Guide, index: number): number {
  if (g.type === 'rect') return g.radii ? (index < 0 ? Math.max(...g.radii) : (g.radii[index] ?? 0)) : g.radius;
  if (g.type === 'poly') return index < 0 ? Math.max(0, ...(g.radii ?? [0])) : (g.radii?.[index] ?? 0);
  return 0;
}

/** Round one corner (index −1: every corner alike). Rectangle corners count from the top-left, clockwise. */
export function setCornerRadius(g: Guide, index: number, r: number): Guide {
  const v = Math.max(0, r);
  if (g.type === 'rect') {
    if (index < 0) return { ...g, radius: v, radii: undefined };
    const radii: [number, number, number, number] = g.radii ? [...g.radii] : [g.radius, g.radius, g.radius, g.radius];
    radii[index] = v;
    const same = radii.every((x) => Math.abs(x - radii[0]) < 1e-9);
    return same ? { ...g, radius: radii[0], radii: undefined } : { ...g, radius: Math.max(...radii), radii };
  }
  if (g.type !== 'poly') return g;
  const radii = g.pts.map((_, i) => g.radii?.[i] ?? 0);
  if (index < 0) radii.fill(v);
  else radii[index] = v;
  return { ...g, radii: radii.some((x) => x > 0) ? radii : undefined };
}

/**
 * How far (document units) an open outline is allowed to fall short of another
 * and still close the area. Lines that look like they touch should count.
 */
export const GAP = 4;

/** An open chain with both ends pushed out by GAP along their direction. */
export function reach(chain: Chain): Chain {
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
