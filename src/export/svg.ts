import { chainsToPath, fmt, ringsToPath } from '@/geom';
import type { Doc } from '@/model/types';
import { resolveFill } from '@/model/doc';
import { guideChains } from '@/model/guides';
import { contentBBox } from '@/model/ops';

export interface SvgOptions {
  /** Paint the paper color behind the logo. */
  background: boolean;
  /** Include the construction outlines. */
  guides: boolean;
  /** Crop to the artboard, or tightly around the artwork. */
  crop: 'artboard' | 'content';
  /** Decimal places for coordinates. */
  digits: number;
  /** Pixel width of the exported file (height follows the aspect ratio). */
  size?: number;
  guideColor?: string;
}

export const DEFAULT_SVG: SvgOptions = { background: false, guides: false, crop: 'artboard', digits: 2 };

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Serialize the document to a standalone SVG file. */
export function docToSvg(doc: Doc, options: Partial<SvgOptions> = {}): string {
  const o = { ...DEFAULT_SVG, ...options };
  let box = { x: 0, y: 0, w: doc.artboard.w, h: doc.artboard.h };
  if (o.crop === 'content') {
    const b = contentBBox(doc);
    if (b && b.w > 0 && b.h > 0) {
      const pad = Math.max(b.w, b.h) * 0.04;
      box = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }
  }
  const d = o.digits;
  const w = o.size ?? box.w;
  const h = (w * box.h) / box.w;
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(box.x, d)} ${fmt(box.y, d)} ${fmt(box.w, d)} ${fmt(box.h, d)}" width="${fmt(w, 2)}" height="${fmt(h, 2)}">`,
  );
  out.push(`<title>${esc(doc.name)}</title>`);
  if (o.background && doc.paper) {
    out.push(`<rect x="${fmt(box.x, d)}" y="${fmt(box.y, d)}" width="${fmt(box.w, d)}" height="${fmt(box.h, d)}" fill="${doc.paper}"/>`);
  }
  for (const s of doc.shapes) {
    if (s.hidden || s.rings.length === 0) continue;
    const attrs: string[] = [`d="${ringsToPath(s.rings, d)}"`, `fill="${resolveFill(doc, s.fill)}"`];
    if (s.stroke && s.stroke.width > 0) {
      attrs.push(`stroke="${resolveFill(doc, s.stroke.color)}"`, `stroke-width="${fmt(s.stroke.width, d)}"`);
      attrs.push(`stroke-linejoin="${s.stroke.join ?? 'round'}"`, `stroke-linecap="${s.stroke.cap ?? 'round'}"`);
    }
    if (s.opacity !== undefined && s.opacity < 1) attrs.push(`opacity="${fmt(s.opacity, 3)}"`);
    out.push(`<path ${attrs.join(' ')}/>`);
  }
  if (o.guides) {
    const paths = doc.guides
      .filter((g) => !g.hidden)
      .map((g) => `<path d="${chainsToPath(guideChains(g), d)}"/>`)
      .join('');
    if (paths) {
      const sw = fmt(Math.max(box.w, box.h) / 700, 2);
      out.push(`<g fill="none" stroke="${o.guideColor ?? '#8a8f98'}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`);
    }
  }
  out.push('</svg>');
  return out.join('');
}

/** Small preview for the gallery. */
export function thumbnail(doc: Doc): string {
  return docToSvg(doc, { background: true, size: 240, digits: 1 });
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
