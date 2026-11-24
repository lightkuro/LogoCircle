/**
 * Logo recipes: a short description of a logo (outlines, the spots to color,
 * any words) built into a real LogoCircle project file with the app's own
 * engine, exactly as if someone had drawn the outlines and clicked the areas.
 *
 * Used by the `npm run logo` script (scripts/logo.mjs) and the logo skill
 * (.claude/skills/logocircle-logo). Not part of the app's bundle.
 */
import { faceAt } from '@/engine';
import { regularPoints, translate, type Pt } from '@/geom';
import { DEFAULT_PAPER, newDoc } from '@/model/doc';
import { buildDocArrangement, paintFaces, visibleGuides } from '@/model/paint';
import { pieceAt, trimPiece } from '@/model/cut';
import { uid } from '@/model/ids';
import type { Band, Border, Doc, Fill, Guide } from '@/model/types';
import { docToSvg } from '@/export/svg';
import { FONTS } from '@/text/fonts';

type XY = [number, number];

/** A width above 0 makes an outline thick: a band (ring, stroke) that can be colored. */
interface Thick {
  width?: number;
  /** Which way a closed outline thickens: inside (default), middle or outside. */
  band?: Band;
}

export type OutlineSpec =
  | ({ type: 'circle'; cx: number; cy: number; r: number } & Thick)
  | ({ type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotate?: number } & Thick)
  | ({ type: 'rect'; cx: number; cy: number; w: number; h: number; rotate?: number; radius?: number | [number, number, number, number] } & Thick)
  | { type: 'line'; from: XY; to: XY; width?: number; ends?: 'round' | 'flat' }
  | ({ type: 'polygon'; points: XY[]; radius?: number | number[] } & Thick)
  | ({ type: 'regular'; cx: number; cy: number; r: number; sides: number; rotate?: number; star?: number; radius?: number } & Thick)
  | ({ type: 'curve'; points: XY[]; closed?: boolean } & Thick);

export interface TextSpec {
  text: string;
  /** A font id from `npm run logo -- --fonts` (default poppins). */
  font?: string;
  size?: number;
  /** Where the line sits: x (by `align`) and the baseline y. */
  x?: number;
  y: number;
  align?: 'center' | 'left' | 'right';
  /** A palette index or a hex color (default 0). */
  color?: number | string;
  /** Letter spacing as a fraction of the size (0.05 = 5%). */
  spacing?: number;
  weight?: number;
  italic?: boolean;
  /** OpenType features, by tag (Paper Mono: ss01 ligatures, cv01 single-story a, zero). */
  features?: string[];
  border?: { width: number; color: number | string; hollow?: boolean };
}

export interface Recipe {
  name?: string;
  /** The colors, by index (Classic mode shows up to four). */
  palette: string[];
  /** The background: a hex color, or null for none. Default: the cream paper. */
  background?: string | null;
  /** The export frame, from (0, 0). Default 1024 × 1024. */
  frame?: { w: number; h: number };
  outlines?: OutlineSpec[];
  /** Points on pieces of outline to remove, as a tap with Cut does (a piece ends where outlines cross). */
  trim?: XY[];
  /** [x, y, color]: color the area under each point; color is a palette index, or -1 to clear. */
  color?: [number, number, number][];
  text?: TextSpec[];
}

export interface BuildResult {
  /** The project file, as LogoCircle's Open project file expects it. */
  file: { app: 'logocircle'; version: 1; doc: Doc; images: Record<string, string> };
  warnings: string[];
  /** Outlines, colored areas (not counting letters), words and letters, and the colors in use. */
  summary: { outlines: number; areas: number; words: number; letters: number; colors: string[] };
}

const deg = (d: number | undefined): number => ((d ?? 0) * Math.PI) / 180;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const pt = ([x, y]: XY): Pt => ({ x, y });

export class RecipeError extends Error {}

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new RecipeError(message);
}

const finite = (...ns: unknown[]): boolean => ns.every((n) => typeof n === 'number' && Number.isFinite(n));

function thick(o: Thick): { width?: number; band?: Band } {
  return { ...(o.width ? { width: o.width } : null), ...(o.band ? { band: o.band } : null) };
}

/** One outline of the recipe as the app's own outline. */
function toGuide(o: OutlineSpec, i: number): Guide {
  const id = uid('g');
  const where = `outlines[${i}] (${(o as { type?: string }).type ?? '?'})`;
  switch (o.type) {
    case 'circle':
      check(finite(o.cx, o.cy, o.r) && o.r > 0, `${where}: needs cx, cy and r > 0`);
      return { id, type: 'ellipse', cx: o.cx, cy: o.cy, rx: o.r, ry: o.r, rot: 0, ...thick(o) };
    case 'ellipse':
      check(finite(o.cx, o.cy, o.rx, o.ry) && o.rx > 0 && o.ry > 0, `${where}: needs cx, cy, rx > 0 and ry > 0`);
      return { id, type: 'ellipse', cx: o.cx, cy: o.cy, rx: o.rx, ry: o.ry, rot: deg(o.rotate), ...thick(o) };
    case 'rect': {
      check(finite(o.cx, o.cy, o.w, o.h) && o.w > 0 && o.h > 0, `${where}: needs cx, cy, w > 0 and h > 0`);
      const radii = Array.isArray(o.radius) ? o.radius : undefined;
      check(!radii || (radii.length === 4 && finite(...radii)), `${where}: radius is a number or four numbers (top left, top right, bottom right, bottom left)`);
      return {
        id,
        type: 'rect',
        cx: o.cx,
        cy: o.cy,
        w: o.w,
        h: o.h,
        rot: deg(o.rotate),
        radius: typeof o.radius === 'number' ? o.radius : 0,
        ...(radii ? { radii: [...radii] as [number, number, number, number] } : null),
        ...thick(o),
      };
    }
    case 'line':
      check(Array.isArray(o.from) && Array.isArray(o.to) && finite(...o.from, ...o.to), `${where}: needs from: [x, y] and to: [x, y]`);
      return { id, type: 'line', x0: o.from[0], y0: o.from[1], x1: o.to[0], y1: o.to[1], width: o.width ?? 0, ...(o.ends === 'flat' ? { ends: 'flat' as const } : null) };
    case 'polygon': {
      check(Array.isArray(o.points) && o.points.length >= 3 && o.points.every((p) => Array.isArray(p) && finite(...p)), `${where}: needs at least three points [x, y]`);
      const radii = typeof o.radius === 'number' ? o.points.map(() => o.radius as number) : o.radius;
      return { id, type: 'poly', pts: o.points.map(pt), ...(radii ? { radii: [...radii] } : null), ...thick(o) };
    }
    case 'regular': {
      check(finite(o.cx, o.cy, o.r, o.sides) && o.r > 0 && o.sides >= 3, `${where}: needs cx, cy, r > 0 and sides ≥ 3`);
      check(o.star === undefined || (o.star > 0 && o.star < 1), `${where}: star is the inner radius as a fraction of r, between 0 and 1`);
      const pts = regularPoints(o.cx, o.cy, o.r, Math.round(o.sides), deg(o.rotate), o.star ?? 1);
      return { id, type: 'poly', pts, ...(o.radius ? { radii: pts.map(() => o.radius!) } : null), ...thick(o) };
    }
    case 'curve':
      check(Array.isArray(o.points) && o.points.length >= 2 && o.points.every((p) => Array.isArray(p) && finite(...p)), `${where}: needs at least two points [x, y]`);
      return { id, type: 'curve', pts: o.points.map(pt), closed: !!o.closed, width: o.width ?? 0, ...(o.band ? { band: o.band } : null) };
    default:
      throw new RecipeError(`${where}: unknown type; use circle, ellipse, rect, line, polygon, regular or curve`);
  }
}

const colorOf = (c: number | string | undefined, palette: string[], where: string): Fill => {
  if (c === undefined) return 0;
  if (typeof c === 'number') {
    check(Number.isInteger(c) && c >= 0 && c < palette.length, `${where}: color ${c} is not in the palette (0 to ${palette.length - 1})`);
    return c;
  }
  check(HEX.test(c), `${where}: color must be a palette index or a hex color like #1c1c20`);
  return c.toLowerCase();
};

/** The fonts a recipe can use. */
export function recipeFonts(): { id: string; name: string; kind: string; weight?: number }[] {
  return FONTS.map((f) => ({ id: f.id, name: f.name, kind: f.kind, ...(f.weight ? { weight: f.weight } : null) }));
}

/** Build a recipe into a project file, with notes on anything that did not land as meant. */
export async function buildRecipe(recipe: Recipe): Promise<BuildResult> {
  const warnings: string[] = [];
  check(recipe && typeof recipe === 'object', 'The recipe must be a JSON object');
  check(Array.isArray(recipe.palette) && recipe.palette.length > 0, 'palette: give at least one hex color');
  recipe.palette.forEach((c, i) => check(typeof c === 'string' && HEX.test(c), `palette[${i}]: "${c}" is not a hex color like #1c1c20`));
  if (recipe.palette.length > 4) warnings.push('palette: more than four colors; Classic mode shows the first four (Advanced shows all)');
  const palette = recipe.palette.map((c) => c.toLowerCase());
  const frame = recipe.frame ?? { w: 1024, h: 1024 };
  check(finite(frame.w, frame.h) && frame.w >= 16 && frame.h >= 16, 'frame: w and h must be at least 16');
  if (recipe.background !== undefined && recipe.background !== null) check(HEX.test(recipe.background), 'background: a hex color, or null for none');

  let doc: Doc = {
    ...newDoc(recipe.name?.trim() || 'Recipe logo'),
    palette,
    paper: recipe.background === undefined ? DEFAULT_PAPER : recipe.background && recipe.background.toLowerCase(),
    artboard: { w: frame.w, h: frame.h },
  };

  // Outlines
  const outlines = recipe.outlines ?? [];
  check(Array.isArray(outlines), 'outlines: a list');
  doc = { ...doc, guides: outlines.map(toGuide) };
  for (const [i, g] of doc.guides.entries()) {
    const b = guideBounds(g);
    if (b && (b.x1 < 0 || b.y1 < 0 || b.x0 > frame.w || b.y0 > frame.h)) warnings.push(`outlines[${i}]: lies wholly outside the frame (0, 0, ${frame.w}, ${frame.h})`);
  }

  // Pieces of outline taken away, as Cut does
  for (const [i, p] of (recipe.trim ?? []).entries()) {
    check(Array.isArray(p) && finite(...p), `trim[${i}]: a point [x, y]`);
    const piece = pieceAt(visibleGuides(doc, true), pt(p), 6);
    if (!piece) {
      warnings.push(`trim[${i}] [${p.join(', ')}]: no piece of outline within 6 units; nothing removed`);
      continue;
    }
    doc = trimPiece(doc, visibleGuides(doc, true), piece);
  }

  // Coloring: the areas under each spot, one color at a time, in the order given
  const spots = recipe.color ?? [];
  check(Array.isArray(spots), 'color: a list of [x, y, color]');
  spots.forEach((s, i) => {
    check(Array.isArray(s) && s.length === 3 && finite(...s), `color[${i}]: [x, y, color] with numbers`);
    check(s[2] === -1 || (Number.isInteger(s[2]) && s[2] >= 0 && s[2] < palette.length), `color[${i}]: color ${s[2]} is not in the palette (0 to ${palette.length - 1}, or -1 to clear)`);
  });
  const seen = new Map<number, number>();
  {
    const arr = buildDocArrangement(doc, true);
    spots.forEach((s, i) => {
      const f = faceAt(arr, { x: s[0], y: s[1] });
      if (f < 0) warnings.push(`color[${i}] [${s[0]}, ${s[1]}]: not inside any area (outside every outline, or right on a line); nothing colored`);
      else if (seen.has(f) && spots[seen.get(f)!]![2] !== s[2]) warnings.push(`color[${i}]: same area as color[${seen.get(f)}] with another color; the later one wins`);
      else seen.set(f, i);
    });
  }
  const order: number[] = [];
  for (const s of spots) if (!order.includes(s[2])) order.push(s[2]);
  for (const slot of order) {
    const arr = buildDocArrangement(doc, true);
    const faces = spots
      .filter((s) => s[2] === slot)
      .map((s) => faceAt(arr, { x: s[0], y: s[1] }))
      .filter((f) => f >= 0);
    if (faces.length) doc = paintFaces(doc, arr, faces, slot < 0 ? null : slot);
  }

  // Words
  const texts = recipe.text ?? [];
  if (texts.length) {
    const { layoutText, textShapes } = await import('@/text/layout');
    for (const [i, t] of texts.entries()) {
      const where = `text[${i}]`;
      check(typeof t.text === 'string' && t.text.trim(), `${where}: text is empty`);
      check(finite(t.y), `${where}: y (the baseline) is needed`);
      const font = t.font ?? 'poppins';
      check(
        FONTS.some((f) => f.id === font),
        `${where}: no font "${font}"; run npm run logo -- --fonts`,
      );
      const size = t.size ?? 150;
      check(finite(size) && size > 0, `${where}: size > 0`);
      const spacing = t.spacing ?? 0;
      const features = t.features?.length ? [...t.features].sort() : undefined;
      const layout = await layoutText(t.text.trim(), font, size, spacing, { weight: t.weight, italic: t.italic, features });
      if (layout.missing.length) warnings.push(`${where}: the font has no "${layout.missing.join('')}"`);
      const x = t.x ?? frame.w / 2;
      const x0 = t.align === 'left' ? x : t.align === 'right' ? x - layout.width : x - layout.width / 2;
      const border: Border | undefined =
        t.border && t.border.width > 0 ? { width: t.border.width, fill: colorOf(t.border.color, palette, `${where}.border`), ...(t.border.hollow ? { hollow: true } : null) } : undefined;
      const info = {
        value: t.text.trim(),
        fontId: font,
        size,
        spacing,
        fill: colorOf(t.color, palette, where),
        ...(t.weight !== undefined ? { weight: t.weight } : null),
        ...(t.italic ? { italic: true } : null),
        ...(features ? { features } : null),
        ...(border ? { border } : null),
      };
      const { shapes, group } = textShapes(layout, info, translate(x0, t.y));
      if (x0 < 0 || x0 + layout.width > frame.w || t.y - layout.ascent < 0 || t.y - layout.descent > frame.h) warnings.push(`${where}: runs past the frame; make it smaller or move it`);
      doc = { ...doc, shapes: [...doc.shapes, ...shapes], groups: { ...doc.groups, [group.id]: group } };
    }
  }

  if (!doc.shapes.length) warnings.push('Nothing is colored: add color spots inside the outlines, or text');
  const used = new Set<string>();
  for (const s of doc.shapes) {
    if (typeof s.fill === 'number') used.add(palette[s.fill]!);
    else if (s.fill) used.add(s.fill);
  }
  return {
    file: { app: 'logocircle', version: 1, doc: { ...doc, updatedAt: Date.now() }, images: {} },
    warnings,
    summary: {
      outlines: doc.guides.length,
      areas: doc.shapes.filter((s) => !s.group || !doc.groups[s.group]?.text).length,
      words: texts.length,
      letters: doc.shapes.filter((s) => s.group && doc.groups[s.group]?.text).length,
      colors: [...used],
    },
  };
}

/** The logo as SVG (as exported), or with its outlines drawn in, to look at while working. */
export function recipePreview(doc: Doc, outlines = false, size = 1024): string {
  return docToSvg(doc, { background: true, guides: outlines, size, guideColor: '#6b7280' });
}

function guideBounds(g: Guide): { x0: number; y0: number; x1: number; y1: number } | null {
  const pts: Pt[] =
    g.type === 'ellipse'
      ? [
          { x: g.cx - Math.max(g.rx, g.ry), y: g.cy - Math.max(g.rx, g.ry) },
          { x: g.cx + Math.max(g.rx, g.ry), y: g.cy + Math.max(g.rx, g.ry) },
        ]
      : g.type === 'rect'
        ? [
            { x: g.cx - Math.hypot(g.w, g.h) / 2, y: g.cy - Math.hypot(g.w, g.h) / 2 },
            { x: g.cx + Math.hypot(g.w, g.h) / 2, y: g.cy + Math.hypot(g.w, g.h) / 2 },
          ]
        : g.type === 'line'
          ? [
              { x: g.x0, y: g.y0 },
              { x: g.x1, y: g.y1 },
            ]
          : g.type === 'poly' || g.type === 'curve'
            ? g.pts
            : [];
  if (!pts.length) return null;
  return { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
}
