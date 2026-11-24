import type { Font, PathCommand } from 'opentype.js';
import { cubicEdge, lineEdge, transformRings, type Edge, type Mat, type Ring } from '@/geom';
import { normalizeRings } from '@/engine';
import type { Fill, Group, Shape, TextInfo } from '@/model/types';
import { uid } from '@/model/ids';
import { loadFont } from './load';

/** Turn one glyph's drawing commands into closed rings. */
function commandsToRings(cmds: PathCommand[]): Ring[] {
  const rings: Ring[] = [];
  let ring: Edge[] = [];
  let sx = 0;
  let sy = 0;
  let x = 0;
  let y = 0;
  const close = (): void => {
    if (ring.length) {
      if (Math.hypot(x - sx, y - sy) > 1e-6) ring.push(lineEdge(x, y, sx, sy));
      if (ring.length >= 2 || ring[0]?.c.k !== 'L') rings.push(ring);
    }
    ring = [];
  };
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        close();
        sx = x = c.x;
        sy = y = c.y;
        break;
      case 'L':
        if (Math.hypot(c.x - x, c.y - y) > 1e-6) ring.push(lineEdge(x, y, c.x, c.y));
        x = c.x;
        y = c.y;
        break;
      case 'Q': {
        // Degree-elevate the quadratic so everything downstream deals with cubics only.
        const x1 = x + (2 / 3) * (c.x1 - x);
        const y1 = y + (2 / 3) * (c.y1 - y);
        const x2 = c.x + (2 / 3) * (c.x1 - c.x);
        const y2 = c.y + (2 / 3) * (c.y1 - c.y);
        ring.push(cubicEdge(x, y, x1, y1, x2, y2, c.x, c.y));
        x = c.x;
        y = c.y;
        break;
      }
      case 'C':
        ring.push(cubicEdge(x, y, c.x1, c.y1, c.x2, c.y2, c.x, c.y));
        x = c.x;
        y = c.y;
        break;
      case 'Z':
        close();
        x = sx;
        y = sy;
        break;
    }
  }
  close();
  return rings;
}

export interface Glyph {
  char: string;
  rings: Ring[];
}

export interface Layout {
  glyphs: Glyph[];
  /** Advance width of the whole word, and the vertical extent used for centring. */
  width: number;
  ascent: number;
  descent: number;
  /** Characters none of the font's files could draw. */
  missing: string[];
}

function fontFor(fonts: Font[], ch: string): Font | null {
  for (const f of fonts) if (f.charToGlyphIndex(ch) > 0) return f;
  return null;
}

/**
 * Lay a word out on a baseline starting at the origin. Each character becomes
 * its own set of rings so letters can later be moved one at a time.
 */
export async function layoutText(value: string, fontId: string, size: number, spacing: number): Promise<Layout> {
  const fonts = await loadFont(fontId);
  const primary = fonts[0]!;
  const glyphs: Glyph[] = [];
  const missing: string[] = [];
  let x = 0;
  const chars = [...value];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === '\n') continue;
    const font = fontFor(fonts, ch) ?? primary;
    const glyph = font.charToGlyph(ch);
    const scale = size / font.unitsPerEm;
    if (/\s/.test(ch)) {
      x += (glyph.advanceWidth ?? font.unitsPerEm * 0.3) * scale + spacing * size;
      continue;
    }
    if (font.charToGlyphIndex(ch) === 0 && !missing.includes(ch)) missing.push(ch);
    const path = glyph.getPath(x, 0, size);
    let rings = commandsToRings(path.commands);
    if (rings.length) {
      try {
        // Many fonts build letters from overlapping pieces; merge them so cuts are clean.
        const clean = normalizeRings(rings);
        if (clean.length) rings = clean;
      } catch {
        /* keep the raw outline */
      }
      glyphs.push({ char: ch, rings });
    }
    let adv = (glyph.advanceWidth ?? 0) * scale;
    const next = chars[i + 1];
    if (next && fontFor(fonts, next) === font) adv += font.getKerningValue(glyph, font.charToGlyph(next)) * scale;
    x += adv + spacing * size;
  }
  const scale = size / primary.unitsPerEm;
  return {
    glyphs,
    width: Math.max(0, x - spacing * size),
    ascent: primary.ascender * scale,
    descent: primary.descender * scale,
    missing,
  };
}

/** The shapes (one per letter) and the group for a word, placed by `m`. */
export function textShapes(layout: Layout, info: Omit<TextInfo, 'pristine' | 'm'>, m: Mat, groupId = uid('w')): { shapes: Shape[]; group: Group } {
  const fill: Fill = info.fill;
  const shapes: Shape[] = layout.glyphs.map((g) => ({
    id: uid('s'),
    rings: transformRings(g.rings, m),
    fill,
    group: groupId,
    name: g.char,
  }));
  const group: Group = { id: groupId, kind: 'text', name: info.value, text: { ...info, m, pristine: true } };
  return { shapes, group };
}
