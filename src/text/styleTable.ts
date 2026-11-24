/**
 * Where the other weights and italics of the bundled fonts live. Only their
 * addresses are bundled, in a chunk of their own that loads the first time a
 * style is asked for; a font file is fetched the first time it is used.
 * Light (300) to Black (900): thinner ones make poor logos.
 */
import type { FontDef } from './fonts';

const FILES = import.meta.glob<string>(['/node_modules/@fontsource/*/files/*-latin-[3-9]00-*.woff', '/node_modules/@fontsource/*/files/*-latin-ext-[3-9]00-*.woff'], {
  eager: true,
  query: '?url',
  import: 'default',
});

/** package → "weight-style" → [latin, latin-ext] */
const TABLE = new Map<string, Map<string, [string | undefined, string | undefined]>>();
for (const [path, url] of Object.entries(FILES)) {
  const m = /@fontsource\/([^/]+)\/files\/.*-latin(-ext)?-(\d+)-(normal|italic)\.woff$/.exec(path);
  if (!m) continue;
  const [, pkg, ext, weight, style] = m;
  let styles = TABLE.get(pkg!);
  if (!styles) TABLE.set(pkg!, (styles = new Map()));
  const key = `${weight}-${style}`;
  const pair = styles.get(key) ?? [undefined, undefined];
  pair[ext ? 1 : 0] = url;
  styles.set(key, pair);
}

/** The weights a bundled font comes in, upright or italic. Empty for fonts with one style. */
export function fontWeights(def: FontDef, italic = false): number[] {
  const styles = TABLE.get(def.id);
  if (!styles) return [];
  const out: number[] = [];
  for (const [key, pair] of styles) {
    const [w, s] = key.split('-');
    if (pair[0] && (s === 'italic') === italic) out.push(Number(w));
  }
  return out.sort((a, b) => a - b);
}

/** Has this font an italic (in any weight)? */
export const hasItalic = (def: FontDef): boolean => fontWeights(def, true).length > 0;

/**
 * The files for a weight and slant of a font, nearest weight first when that
 * exact one does not exist. Null when the default files are the answer.
 */
export function styleUrls(def: FontDef, weight: number | undefined, italic: boolean | undefined): string[] | null {
  const styles = TABLE.get(def.id);
  const want = weight ?? def.weight ?? 400;
  if (!styles || (!italic && want === def.weight)) return null;
  const options = fontWeights(def, !!italic);
  if (!options.length) return null;
  const w = options.reduce((best, x) => (Math.abs(x - want) < Math.abs(best - want) ? x : best), options[0]!);
  if (!italic && w === def.weight) return null;
  const pair = styles.get(`${w}-${italic ? 'italic' : 'normal'}`);
  return pair ? pair.filter((u): u is string => !!u) : null;
}

/** Every package with styles: for tests. */
export const styledFonts = (): string[] => [...TABLE.keys()];
