/**
 * A small OpenType substitution (GSUB) engine for the features a person can
 * switch on in Font settings: ligatures, alternate letters, stylistic sets.
 *
 * opentype.js only applies the standard ligatures itself. This applies, in
 * lookup order, single (1), multiple (2), alternate (3, first choice),
 * ligature (4), contextual (5) and chaining contextual (6) substitutions,
 * through extension lookups (7). It skips reverse chaining (8) and ignores
 * lookup flags (marks are not skipped), which Latin words rarely need.
 */
import type { Font } from 'opentype.js';

/** A glyph and the characters it stands for (several for a ligature, none for a spacer). */
export interface GlyphItem {
  index: number;
  chars: string;
}

type Coverage = { format: 1; glyphs: number[] } | { format: 2; ranges: { start: number; end: number; index: number }[] };
type ClassDef = { format: 1; startGlyph: number; classes: number[] } | { format: 2; ranges: { start: number; end: number; classId: number }[] } | { format: number };
interface LookupRecord {
  sequenceIndex: number;
  lookupListIndex: number;
}
interface ChainRule {
  backtrack: number[];
  input: number[];
  lookahead: number[];
  lookupRecords: LookupRecord[];
}
// The parsed subtables, as opentype.js lays them out.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Subtable = any;
interface Lookup {
  lookupType: number;
  subtables: Subtable[];
}
interface Gsub {
  scripts: { tag: string; script: { defaultLangSys?: { featureIndexes: number[] } } }[];
  features: { tag: string; feature: { lookupListIndexes: number[] } }[];
  lookups: Lookup[];
}

const gsubOf = (font: Font): Gsub | null => ((font.tables as Record<string, unknown>).gsub as Gsub | undefined) ?? null;

function coverageIndex(c: Coverage | undefined, g: number): number {
  if (!c) return -1;
  if (c.format === 1) {
    // glyph lists are sorted
    let lo = 0;
    let hi = c.glyphs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = c.glyphs[mid]!;
      if (v === g) return mid;
      if (v < g) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
  for (const r of c.ranges) if (g >= r.start && g <= r.end) return r.index + g - r.start;
  return -1;
}

function classOf(cd: ClassDef | undefined, g: number): number {
  if (!cd) return 0;
  if (cd.format === 1 && 'classes' in cd) {
    const i = g - cd.startGlyph;
    return i >= 0 && i < cd.classes.length ? cd.classes[i]! : 0;
  }
  if (cd.format === 2 && 'ranges' in cd) for (const r of cd.ranges) if (g >= r.start && g <= r.end) return r.classId;
  return 0;
}

/** The feature records the font uses for Latin text (or its default script). */
function featureIndexes(gsub: Gsub): number[] {
  const script = gsub.scripts.find((s) => s.tag === 'latn') ?? gsub.scripts.find((s) => s.tag === 'DFLT') ?? gsub.scripts[0];
  const idx = script?.script.defaultLangSys?.featureIndexes;
  return idx && idx.length ? idx : gsub.features.map((_, i) => i);
}

/** The lookup types this engine applies. */
const APPLIES = new Set([1, 2, 3, 4, 5, 6]);

const typeOf = (lookup: Lookup, st: Subtable): number => (lookup.lookupType === 7 ? st.lookupType : lookup.lookupType);
const bodyOf = (lookup: Lookup, st: Subtable): Subtable => (lookup.lookupType === 7 ? st.extension : st);

/** Every feature tag the font has for Latin text that does something this engine can apply. */
export function fontFeatureTags(font: Font): string[] {
  const gsub = gsubOf(font);
  if (!gsub) return [];
  const out = new Set<string>();
  for (const fi of featureIndexes(gsub)) {
    const f = gsub.features[fi];
    if (!f) continue;
    const ok = f.feature.lookupListIndexes.some((li) => {
      const l = gsub.lookups[li];
      return !!l && l.subtables.some((st) => APPLIES.has(typeOf(l, st)));
    });
    if (ok) out.add(f.tag);
  }
  return [...out];
}

/** Does the buffer at `i` hold `seq` (glyph ids)? */
const matchGlyphs = (buf: GlyphItem[], at: number, seq: number[], step: 1 | -1): boolean => seq.every((g, k) => buf[at + k * step]?.index === g);

interface Ctx {
  gsub: Gsub;
  depth: number;
}

/**
 * Apply one lookup at position `i`. Returns where processing goes on (after
 * what was matched), or -1 when nothing there matched.
 */
function applyAt(ctx: Ctx, li: number, buf: GlyphItem[], i: number): number {
  const lookup = ctx.gsub.lookups[li];
  const here = buf[i];
  if (!lookup || !here || ctx.depth > 8) return -1;
  for (const raw of lookup.subtables) {
    const type = typeOf(lookup, raw);
    const st = bodyOf(lookup, raw);
    if (!st) continue;
    const g = here.index;
    switch (type) {
      case 1: {
        const ci = coverageIndex(st.coverage, g);
        if (ci < 0) break;
        const next = st.substFormat === 1 ? (g + st.deltaGlyphId) & 0xffff : st.substitute[ci];
        if (next === undefined) break;
        buf[i] = { index: next, chars: here.chars };
        return i + 1;
      }
      case 2: {
        const ci = coverageIndex(st.coverage, g);
        const seq: number[] | undefined = ci >= 0 ? st.sequences[ci] : undefined;
        if (!seq) break;
        buf.splice(i, 1, ...seq.map((index, k) => ({ index, chars: k === 0 ? here.chars : '' })));
        return i + seq.length;
      }
      case 3: {
        const ci = coverageIndex(st.coverage, g);
        const alt: number | undefined = ci >= 0 ? st.alternateSets[ci]?.[0] : undefined;
        if (alt === undefined) break;
        buf[i] = { index: alt, chars: here.chars };
        return i + 1;
      }
      case 4: {
        const ci = coverageIndex(st.coverage, g);
        const set: { ligGlyph: number; components: number[] }[] | undefined = ci >= 0 ? st.ligatureSets[ci] : undefined;
        if (!set) break;
        for (const lig of set) {
          if (!matchGlyphs(buf, i + 1, lig.components, 1)) continue;
          const parts = buf.slice(i, i + 1 + lig.components.length);
          buf.splice(i, parts.length, { index: lig.ligGlyph, chars: parts.map((p) => p.chars).join('') });
          return i + 1;
        }
        break;
      }
      case 5:
      case 6: {
        const done = applyContext(ctx, type, st, buf, i);
        if (done >= 0) return done;
        break;
      }
    }
  }
  return -1;
}

/** Contextual and chaining contextual substitution: find a rule that matches at `i`, then run its lookups. */
function applyContext(ctx: Ctx, type: number, st: Subtable, buf: GlyphItem[], i: number): number {
  const g = buf[i]!.index;
  const fmt = st.substFormat;
  if (fmt === 1) {
    const ci = coverageIndex(st.coverage, g);
    if (ci < 0) return -1;
    const rules: ChainRule[] | undefined = type === 6 ? st.chainRuleSets[ci] : st.ruleSets?.[ci]?.map((r: ChainRule) => ({ ...r, backtrack: [], lookahead: [] }));
    for (const r of rules ?? []) {
      const n = r.input.length + 1;
      if (matchGlyphs(buf, i + 1, r.input, 1) && matchGlyphs(buf, i - 1, r.backtrack ?? [], -1) && matchGlyphs(buf, i + n, r.lookahead ?? [], 1)) {
        return runRecords(ctx, r.lookupRecords, buf, i, n);
      }
    }
    return -1;
  }
  if (fmt === 2) {
    if (coverageIndex(st.coverage, g) < 0) return -1;
    const inputDef: ClassDef = type === 6 ? st.inputClassDef : st.classDef;
    const sets = type === 6 ? st.chainClassSet : st.classSets;
    const rules: (ChainRule & { classes?: number[] })[] | undefined = sets?.[classOf(inputDef, g)];
    for (const r of rules ?? []) {
      const input: number[] = type === 6 ? r.input : (r.classes ?? []);
      const back: number[] = type === 6 ? r.backtrack : [];
      const ahead: number[] = type === 6 ? r.lookahead : [];
      const n = input.length + 1;
      const ok =
        input.every((c, k) => buf[i + 1 + k] && classOf(inputDef, buf[i + 1 + k]!.index) === c) &&
        back.every((c, k) => buf[i - 1 - k] && classOf(st.backtrackClassDef, buf[i - 1 - k]!.index) === c) &&
        ahead.every((c, k) => buf[i + n + k] && classOf(st.lookaheadClassDef, buf[i + n + k]!.index) === c);
      if (ok) return runRecords(ctx, r.lookupRecords, buf, i, n);
    }
    return -1;
  }
  if (fmt === 3) {
    const input: Coverage[] = type === 6 ? st.inputCoverage : st.coverages;
    const back: Coverage[] = type === 6 ? st.backtrackCoverage : [];
    const ahead: Coverage[] = type === 6 ? st.lookaheadCoverage : [];
    const n = input.length;
    const ok =
      n > 0 &&
      input.every((c, k) => buf[i + k] && coverageIndex(c, buf[i + k]!.index) >= 0) &&
      back.every((c, k) => buf[i - 1 - k] && coverageIndex(c, buf[i - 1 - k]!.index) >= 0) &&
      ahead.every((c, k) => buf[i + n + k] && coverageIndex(c, buf[i + n + k]!.index) >= 0);
    return ok ? runRecords(ctx, st.lookupRecords, buf, i, n) : -1;
  }
  return -1;
}

/** Run a matched rule's lookups on its input glyphs; returns the position after the input. */
function runRecords(ctx: Ctx, records: LookupRecord[], buf: GlyphItem[], i: number, n: number): number {
  let end = i + n;
  for (const rec of records) {
    const at = i + rec.sequenceIndex;
    if (at >= end) continue;
    const before = buf.length;
    applyAt({ gsub: ctx.gsub, depth: ctx.depth + 1 }, rec.lookupListIndex, buf, at);
    end += buf.length - before;
  }
  return Math.max(end, i + 1);
}

/** The glyphs for a run of text in one font, with the chosen features applied. */
export function shape(font: Font, text: string, features: readonly string[]): GlyphItem[] {
  const buf: GlyphItem[] = [...text].map((ch) => ({ index: font.charToGlyphIndex(ch), chars: ch }));
  const gsub = gsubOf(font);
  if (!gsub || !features.length) return buf;
  const want = new Set(features);
  const lookups = new Set<number>();
  for (const fi of featureIndexes(gsub)) {
    const f = gsub.features[fi];
    if (f && want.has(f.tag)) for (const li of f.feature.lookupListIndexes) lookups.add(li);
  }
  const ctx: Ctx = { gsub, depth: 0 };
  // Lookups run in the order the font lists them, each over the whole run.
  for (const li of [...lookups].sort((a, b) => a - b)) {
    for (let i = 0; i < buf.length; ) {
      const next = applyAt(ctx, li, buf, i);
      i = next > i ? next : i + 1;
    }
  }
  return buf;
}

// --- what to call the features --------------------------------------------------------

/** Plain names for the features people look for. Others are left out. */
const NAMES: Record<string, string> = {
  liga: 'Ligatures',
  dlig: 'Extra ligatures',
  salt: 'Alternate letters',
  swsh: 'Swashes',
  smcp: 'Small caps',
  onum: 'Old-style numbers',
  zero: 'Slashed zero',
};

/** Names a font gives its own sets, where the font file carries them (read from the font, by hand). */
const BY_FONT: Record<string, Record<string, string>> = {
  'paper-mono': {
    ss01: 'Ligatures',
    cv01: 'Single-story a',
    ss02: 'Wide m and w',
    ss04: 'Small arrows',
    zero: 'Slashed zero',
  },
};

export interface FeatureChoice {
  tag: string;
  label: string;
}

/** The features worth offering for a font, with names, in a steady order. */
export function featureChoices(fontId: string, font: Font): FeatureChoice[] {
  const own = BY_FONT[fontId];
  const tags = fontFeatureTags(font);
  const out: FeatureChoice[] = [];
  for (const tag of tags) {
    const label = own ? own[tag] : (NAMES[tag] ?? (/^ss\d\d$/.test(tag) ? `Style set ${Number(tag.slice(2))}` : /^cv\d\d$/.test(tag) ? `Letter variant ${Number(tag.slice(2))}` : undefined));
    if (label) out.push({ tag, label });
  }
  const order = (t: string): number => (t === 'liga' ? 0 : t === 'dlig' ? 1 : t.startsWith('ss') ? 2 : t.startsWith('cv') ? 3 : 4);
  return out.sort((a, b) => order(a.tag) - order(b.tag) || a.tag.localeCompare(b.tag));
}
