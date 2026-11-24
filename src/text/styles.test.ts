import { describe, expect, it } from 'vitest';
import { FONTS } from './fonts';
import { fontWeights, hasItalic, styledFonts, styleUrls } from './styleTable';

describe('font weights and italics', () => {
  it('every bundled font but Paper Mono has its styles, its own weight among them', () => {
    const styled = new Set(styledFonts());
    for (const def of FONTS) {
      if (def.id === 'paper-mono') {
        expect(fontWeights(def)).toEqual([]);
        continue;
      }
      expect(styled.has(def.id), def.id).toBe(true);
      expect(fontWeights(def), def.id).toContain(def.weight);
    }
  });

  it('finds the files for a weight and slant, or the nearest weight', () => {
    const poppins = FONTS.find((f) => f.id === 'poppins')!;
    expect(fontWeights(poppins)).toEqual([300, 400, 500, 600, 700, 800, 900]);
    expect(hasItalic(poppins)).toBe(true);
    expect(styleUrls(poppins, 700, false)).toBeNull(); // the default files
    expect(styleUrls(poppins, 400, true)!.join()).toMatch(/poppins-latin-400-italic/);
    expect(styleUrls(poppins, 100, false)!.join()).toMatch(/poppins-latin-300-normal/);
    const bebas = FONTS.find((f) => f.id === 'bebas-neue')!;
    expect(hasItalic(bebas)).toBe(false);
  });
});
