import type { Font } from 'opentype.js';
import { FONTS, type FontDef } from './fonts';

const parsed = new Map<string, Promise<Font>>();
const custom = new Map<string, { def: FontDef; data: ArrayBuffer }>();

async function parse(url: string): Promise<Font> {
  let p = parsed.get(url);
  if (!p) {
    p = (async () => {
      const [{ parse: parseFont }, res] = await Promise.all([import('opentype.js'), fetch(url)]);
      if (!res.ok) throw new Error(`Font failed to load (${res.status})`);
      return parseFont(await res.arrayBuffer());
    })();
    parsed.set(url, p);
    p.catch(() => parsed.delete(url));
  }
  return p;
}

export function fontDef(id: string): FontDef | undefined {
  return FONTS.find((f) => f.id === id) ?? custom.get(id)?.def;
}

export function allFonts(): FontDef[] {
  return [...FONTS, ...[...custom.values()].map((c) => c.def)];
}

/** The font files for an id, parsed. The first one is the primary. */
export async function loadFont(id: string): Promise<Font[]> {
  const c = custom.get(id);
  if (c) {
    const key = `custom:${id}`;
    let p = parsed.get(key);
    if (!p) {
      p = import('opentype.js').then(({ parse: parseFont }) => parseFont(c.data));
      parsed.set(key, p);
    }
    return [await p];
  }
  const def = FONTS.find((f) => f.id === id) ?? FONTS[0]!;
  const primary = await parse(def.urls[0]!);
  return [primary, ...(await Promise.all(def.urls.slice(1).map((u) => parse(u).catch(() => null)))).filter((f): f is Font => !!f)];
}

/** Register a font file the person uploaded (Advanced). Returns its id. */
export async function addCustomFont(file: File): Promise<FontDef> {
  const data = await file.arrayBuffer();
  const { parse: parseFont } = await import('opentype.js');
  const font = parseFont(data); // throws on files it cannot read
  const names = font.names as unknown as Record<string, Record<string, string> | undefined>;
  const name = names.fullName?.en ?? names.fontFamily?.en ?? file.name.replace(/\.[^.]+$/, '');
  const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const url = URL.createObjectURL(new Blob([data]));
  const def: FontDef = { id, name, kind: 'custom', urls: [url] };
  custom.set(id, { def, data });
  parsed.set(`custom:${id}`, Promise.resolve(font));
  return def;
}

const faces = new Set<string>();

/** Make a font usable in CSS (for previews in the font list). */
export function ensureCssFont(def: FontDef): string {
  const family = `lc-${def.id}`;
  if (!faces.has(def.id) && typeof FontFace === 'function') {
    faces.add(def.id);
    const face = new FontFace(family, `url(${def.urls[0]})`);
    void face.load().then((f) => document.fonts.add(f)).catch(() => faces.delete(def.id));
  }
  return family;
}
