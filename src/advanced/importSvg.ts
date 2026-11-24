import {
  apply,
  ellipseChain,
  mul,
  parsePath,
  parseTransform,
  polygonChain,
  rectChain,
  ringsBBox,
  scale,
  subPathsToRings,
  transformRings,
  translate,
  unionBBox,
  emptyBBox,
  IDENTITY,
  type Mat,
  type Pt,
  type Ring,
} from '@/geom';
import { commit, getDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import type { Shape, Stroke } from '@/model/types';
import { uid } from '@/model/ids';
import { board } from '@/model/doc';

interface Paint {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
}

let probe: CanvasRenderingContext2D | null = null;

/** Any CSS color → #rrggbb (alpha is returned separately). */
function toHex(value: string): { hex: string; alpha: number } | null {
  const v = value.trim();
  if (!v || v === 'none' || v === 'transparent') return null;
  if (v.startsWith('url(')) return { hex: '#888888', alpha: 1 }; // gradients and patterns are not supported yet
  if (v === 'currentColor') return { hex: '#000000', alpha: 1 };
  probe ??= document.createElement('canvas').getContext('2d');
  if (!probe) return null;
  probe.fillStyle = '#010203';
  probe.fillStyle = v;
  const out = String(probe.fillStyle);
  if (out === '#010203' && v.toLowerCase() !== '#010203') return null;
  if (out.startsWith('#')) return { hex: out, alpha: 1 };
  const m = /rgba?\(([^)]+)\)/.exec(out);
  if (!m) return null;
  const [r, g, b, a] = m[1]!.split(',').map((x) => parseFloat(x));
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
  return { hex: `#${h(r!)}${h(g!)}${h(b!)}`, alpha: a ?? 1 };
}

function styleOf(el: Element, name: string): string | null {
  const style = el.getAttribute('style');
  if (style) {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style);
    if (m) return m[1]!.trim();
  }
  return el.getAttribute(name);
}

function paintOf(el: Element, parent: Paint): Paint {
  const p: Paint = { ...parent };
  const fill = styleOf(el, 'fill');
  if (fill !== null) p.fill = fill === 'none' ? null : (toHex(fill)?.hex ?? p.fill);
  const stroke = styleOf(el, 'stroke');
  if (stroke !== null) p.stroke = stroke === 'none' ? null : (toHex(stroke)?.hex ?? p.stroke);
  const sw = styleOf(el, 'stroke-width');
  if (sw !== null && !Number.isNaN(parseFloat(sw))) p.strokeWidth = parseFloat(sw);
  const op = styleOf(el, 'opacity');
  if (op !== null && !Number.isNaN(parseFloat(op))) p.opacity = parent.opacity * parseFloat(op);
  const fo = styleOf(el, 'fill-opacity');
  if (fo !== null && !Number.isNaN(parseFloat(fo))) p.opacity *= parseFloat(fo);
  return p;
}

const num = (el: Element, name: string, fallback = 0): number => {
  const v = parseFloat(el.getAttribute(name) ?? '');
  return Number.isFinite(v) ? v : fallback;
};

function points(el: Element): Pt[] {
  const nums = (el.getAttribute('points') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const out: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i]!, y: nums[i + 1]! });
  return out;
}

function ringsOf(el: Element): Ring[] {
  switch (el.tagName.toLowerCase()) {
    case 'path':
      return subPathsToRings(parsePath(el.getAttribute('d') ?? ''));
    case 'rect': {
      const w = num(el, 'width');
      const h = num(el, 'height');
      if (w <= 0 || h <= 0) return [];
      const r = Math.max(num(el, 'rx', num(el, 'ry')), 0);
      return [rectChain(num(el, 'x') + w / 2, num(el, 'y') + h / 2, w, h, 0, r).edges];
    }
    case 'circle': {
      const r = num(el, 'r');
      return r > 0 ? [ellipseChain(num(el, 'cx'), num(el, 'cy'), r, r).edges] : [];
    }
    case 'ellipse': {
      const rx = num(el, 'rx');
      const ry = num(el, 'ry');
      return rx > 0 && ry > 0 ? [ellipseChain(num(el, 'cx'), num(el, 'cy'), rx, ry).edges] : [];
    }
    case 'polygon':
    case 'polyline': {
      const pts = points(el);
      return pts.length >= 3 ? [polygonChain(pts).edges] : [];
    }
    default:
      return [];
  }
}

const SKIP = new Set(['defs', 'clippath', 'mask', 'pattern', 'symbol', 'lineargradient', 'radialgradient', 'style', 'title', 'desc', 'metadata', 'text', 'image', 'filter', 'marker']);

/**
 * Bring the filled shapes of an SVG file into the current document, scaled to
 * fit the artboard. Returns how many shapes were added.
 */
export function importSvg(text: string): number {
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = xml.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg' || xml.querySelector('parsererror')) throw new Error('not svg');

  const found: { rings: Ring[]; paint: Paint }[] = [];
  const walk = (el: Element, m: Mat, paint: Paint): void => {
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return;
    if (styleOf(el, 'display') === 'none' || styleOf(el, 'visibility') === 'hidden') return;
    const here = mul(m, parseTransform(el.getAttribute('transform')));
    const p = paintOf(el, paint);
    if (tag === 'g' || tag === 'svg' || tag === 'a' || tag === 'switch') {
      for (const child of [...el.children]) walk(child, here, p);
      return;
    }
    let rings: Ring[];
    try {
      rings = ringsOf(el);
    } catch {
      return;
    }
    if (!rings.length || (!p.fill && !(p.stroke && p.strokeWidth > 0))) return;
    found.push({ rings: transformRings(rings, here), paint: p });
  };
  walk(root, IDENTITY, { fill: '#000000', stroke: null, strokeWidth: 1, opacity: 1 });
  if (!found.length) return 0;

  // Fit everything into the artboard, keeping proportions.
  let box = emptyBBox();
  for (const f of found) box = unionBBox(box, ringsBBox(f.rings));
  const doc = getDoc();
  const b = board(doc);
  const k = Math.min((b.w * 0.84) / Math.max(1e-6, box.w), (b.h * 0.84) / Math.max(1e-6, box.h));
  const fit = mul(translate(b.x + b.w / 2, b.y + b.h / 2), mul(scale(k, k), translate(-(box.x + box.w / 2), -(box.y + box.h / 2))));
  void apply;

  const group = found.length > 1 ? uid('w') : undefined;
  const shapes: Shape[] = found.map((f) => {
    const stroke: Stroke | undefined = f.paint.stroke && f.paint.strokeWidth > 0 ? { color: f.paint.stroke, width: f.paint.strokeWidth * k } : undefined;
    return {
      id: uid('s'),
      rings: transformRings(f.rings, fit),
      fill: f.paint.fill,
      stroke,
      opacity: f.paint.opacity < 1 ? f.paint.opacity : undefined,
      group,
    };
  });
  const groups = group ? { ...doc.groups, [group]: { id: group, kind: 'group' as const, name: 'Imported' } } : doc.groups;
  commit({ ...doc, shapes: [...doc.shapes, ...shapes], groups, updatedAt: Date.now() });
  useUi.setState({ selection: shapes.map((s) => s.id), tool: 'arrange', erasing: false });
  return shapes.length;
}
