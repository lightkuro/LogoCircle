import type { Font } from 'opentype.js';
import { createStore, del, get, keys, set } from 'idb-keyval';
import { DEFAULT_FONT, FONTS, type FontDef } from './fonts';

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

/** Uploaded fonts first (newest first), then the bundled ones. */
export function allFonts(): FontDef[] {
  return [...[...custom.values()].map((c) => c.def).reverse(), ...FONTS];
}

export function customFonts(): FontDef[] {
  return [...custom.values()].map((c) => c.def).reverse();
}

export const isCustomFont = (id: string): boolean => id.startsWith('custom-');

// --- uploaded fonts are kept on this device ----------------------------------------

// Same database as the documents; fonts live under their own key prefix.
const db = typeof indexedDB === 'undefined' ? null : createStore('logocircle', 'kv');
const fontKey = (id: string): string => `font:${id}`;

interface StoredFont {
  name: string;
  data: ArrayBuffer;
}

function register(id: string, name: string, data: ArrayBuffer): FontDef {
  const existing = custom.get(id);
  if (existing) return existing.def;
  const def: FontDef = { id, name, kind: 'custom', urls: [URL.createObjectURL(new Blob([data]))] };
  custom.set(id, { def, data });
  return def;
}

let restored: Promise<FontDef[]> | null = null;

/** Bring back the fonts uploaded in earlier visits. Safe to call often. */
export function restoreCustomFonts(): Promise<FontDef[]> {
  if (!db) return Promise.resolve(customFonts());
  restored ??= (async () => {
    try {
      const all = (await keys(db)) as unknown[];
      for (const k of all) {
        if (typeof k !== 'string' || !k.startsWith('font:')) continue;
        const rec = (await get(k, db)) as StoredFont | undefined;
        if (rec?.data) register(k.slice(5), rec.name, rec.data);
      }
    } catch {
      /* storage unavailable: uploaded fonts last for this visit only */
    }
    return customFonts();
  })();
  return restored.then(() => customFonts());
}

/** The font files for an id, parsed. The first one is the primary. */
export async function loadFont(id: string): Promise<Font[]> {
  if (isCustomFont(id) && !custom.has(id)) await restoreCustomFonts();
  const c = custom.get(id);
  if (c) {
    const key = `custom:${id}`;
    let p = parsed.get(key);
    if (!p) {
      p = import('opentype.js').then(({ parse: parseFont }) => parseFont(c.data));
      parsed.set(key, p);
      p.catch(() => parsed.delete(key));
    }
    return [await p];
  }
  const def = FONTS.find((f) => f.id === id) ?? FONTS.find((f) => f.id === DEFAULT_FONT) ?? FONTS[0]!;
  const primary = await parse(def.urls[0]!);
  return [primary, ...(await Promise.all(def.urls.slice(1).map((u) => parse(u).catch(() => null)))).filter((f): f is Font => !!f)];
}

/** Register a font file the person uploaded. Returns its definition. */
export async function addCustomFont(file: File): Promise<FontDef> {
  const data = await file.arrayBuffer();
  const { parse: parseFont } = await import('opentype.js');
  const font = parseFont(data); // throws on files it cannot read
  let name = '';
  try {
    name = font.getEnglishName('fullName') || font.getEnglishName('fontFamily') || '';
  } catch {
    /* some fonts carry no usable name table */
  }
  name = (name || file.name.replace(/\.[^.]+$/, '')).trim().slice(0, 60) || 'My font';
  const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font'}`;
  custom.delete(id); // uploading the same font again replaces it
  cssReady.delete(id);
  cssLoaded.delete(id);
  const def = register(id, name, data);
  parsed.set(`custom:${id}`, Promise.resolve(font));
  if (db) void set(fontKey(id), { name, data } satisfies StoredFont, db).catch(() => undefined);
  return def;
}

export function removeCustomFont(id: string): void {
  const c = custom.get(id);
  if (!c) return;
  custom.delete(id);
  parsed.delete(`custom:${id}`);
  cssReady.delete(id);
  cssLoaded.delete(id);
  URL.revokeObjectURL(c.def.urls[0]!);
  if (db) void del(fontKey(id), db).catch(() => undefined);
}

// --- CSS previews -------------------------------------------------------------------

const cssReady = new Map<string, Promise<string>>();
const cssLoaded = new Set<string>();

/** Has this font's CSS face already arrived? (Lets a tile skip its loading state.) */
export const cssFontLoaded = (def: FontDef): boolean => cssLoaded.has(def.id);

export const cssFamily = (def: FontDef): string => `lc-${def.id}`;

/**
 * Make a font usable in CSS, for the preview tiles in the font list. Resolves
 * with the family name once the file has arrived; fetches it only on first use.
 */
export function cssFontReady(def: FontDef): Promise<string> {
  let p = cssReady.get(def.id);
  if (!p) {
    const family = cssFamily(def);
    if (typeof FontFace !== 'function') return Promise.resolve(family);
    p = new FontFace(family, `url(${def.urls[0]})`).load().then((face) => {
      document.fonts.add(face);
      cssLoaded.add(def.id);
      return family;
    });
    cssReady.set(def.id, p);
    p.catch(() => cssReady.delete(def.id));
  }
  return p;
}

/** Start loading a font for CSS and return its family name straight away. */
export function ensureCssFont(def: FontDef): string {
  void cssFontReady(def).catch(() => undefined);
  return cssFamily(def);
}
