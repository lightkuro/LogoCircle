import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, type Font } from 'opentype.js';
import { featureChoices, fontFeatureTags, shape } from './gsub';

const load = (path: string): Font => {
  const b = readFileSync(path);
  return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const mono = load('src/text/vendor/paper-mono/PaperMono-Regular.woff');
const poppins = load('node_modules/@fontsource/poppins/files/poppins-latin-700-normal.woff');
const names = (f: Font, text: string, feats: string[]): string[] => shape(f, text, feats).map((g) => f.glyphs.get(g.index).name ?? '');

describe('OpenType features', () => {
  it('leaves glyphs alone with no features', () => {
    expect(names(mono, 'a0', [])).toEqual(['a', 'zero']);
  });

  it('single substitutions: single-story a, slashed zero', () => {
    expect(names(mono, 'a', ['cv01'])).toEqual(['a.cv01']);
    expect(names(mono, '0', ['zero'])).toEqual(['zero.zero']);
    expect(names(mono, 'mw', ['ss02'])).toEqual(['m.ss02', 'w.ss02']);
  });

  it('chaining contextual: coding ligatures', () => {
    for (const s of ['->', '=>', '!=', '<=']) {
      const plain = names(mono, s, []);
      const lig = names(mono, s, ['ss01']);
      expect(lig, s).not.toEqual(plain);
      // the characters are all still accounted for
      expect(
        shape(mono, s, ['ss01'])
          .map((g) => g.chars)
          .join(''),
      ).toBe(s);
    }
  });

  it('offers named features for Paper Mono', () => {
    const tags = fontFeatureTags(mono);
    expect(tags).toEqual(expect.arrayContaining(['ss01', 'cv01', 'zero']));
    const labels = featureChoices('paper-mono', mono).map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['Ligatures', 'Single-story a', 'Slashed zero']));
  });

  it('a font with nothing to switch offers nothing', () => {
    expect(featureChoices('poppins', poppins)).toEqual([]);
    expect(names(poppins, 'fi', ['liga'])).toEqual(names(poppins, 'fi', []));
  });
});
