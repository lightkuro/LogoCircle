import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildRecipe, RecipeError, type Recipe } from './index';

const root = join(__dirname, '..', '..');
const examples = join(root, '.claude', 'skills', 'logocircle-logo', 'examples');

// The app loads font files by URL; in the tests they come from disk.
beforeAll(() => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/') && !url.startsWith('//')) return new Response(readFileSync(join(root, decodeURIComponent(url.split('?')[0]!))));
    return real(input, init);
  }) as typeof fetch;
});

const base: Recipe = {
  name: 'Test',
  palette: ['#16877f', '#f29e4c'],
  outlines: [
    { type: 'circle', cx: 462, cy: 420, r: 170 },
    { type: 'circle', cx: 618, cy: 318, r: 112 },
  ],
  color: [
    [400, 460, 0],
    [690, 280, 0],
    [570, 345, 1],
  ],
};

describe('logo recipes', () => {
  it('every example in the skill builds without warnings', async () => {
    const files = readdirSync(examples).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const r = await buildRecipe(JSON.parse(readFileSync(join(examples, f), 'utf8')) as Recipe);
      expect(r.warnings, f).toEqual([]);
      expect(r.summary.areas, f).toBeGreaterThan(0);
      expect(r.file.app).toBe('logocircle');
      expect(r.file.doc.v).toBe(1);
    }
  }, 60000);

  it('colors the areas the spots land in, keeping the outlines', async () => {
    const r = await buildRecipe(base);
    expect(r.warnings).toEqual([]);
    expect(r.file.doc.guides).toHaveLength(2);
    // the two outer pieces in color 0 and the overlap between them in color 1
    const fills = r.file.doc.shapes.map((s) => s.fill);
    expect(fills.filter((f) => f === 1)).toHaveLength(1);
    expect(fills.filter((f) => f === 0).length).toBeGreaterThanOrEqual(1);
    expect(fills).toHaveLength(r.summary.areas);
    expect(r.summary.colors.sort()).toEqual(['#16877f', '#f29e4c']);
  });

  it('says when a spot lands outside every outline, or shares an area', async () => {
    const r = await buildRecipe({
      ...base,
      color: [
        [20, 20, 0],
        [400, 460, 0],
        [410, 470, 1],
      ],
    });
    expect(r.warnings.some((w) => w.startsWith('color[0]') && w.includes('not inside any area'))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('color[2]') && w.includes('same area'))).toBe(true);
  });

  it('refuses what it cannot build, saying where', async () => {
    await expect(buildRecipe({ ...base, palette: ['teal'] })).rejects.toThrow(RecipeError);
    await expect(buildRecipe({ ...base, outlines: [{ type: 'circle', cx: 1, cy: 2, r: -3 }] })).rejects.toThrow(/outlines\[0\]/);
    await expect(buildRecipe({ ...base, color: [[1, 2, 7]] })).rejects.toThrow(/color\[0\]/);
    await expect(buildRecipe({ ...base, text: [{ text: 'x', y: 900, font: 'no-such-font' }] })).rejects.toThrow(/no font/);
  });

  it('trims a piece of outline, so the line no longer splits the space outside', async () => {
    const recipe: Recipe = {
      palette: ['#000000'],
      outlines: [
        { type: 'circle', cx: 512, cy: 512, r: 200 },
        { type: 'line', from: [212, 512], to: [812, 512] },
      ],
      trim: [
        [250, 512],
        [780, 512],
      ],
      color: [[512, 450, 0]],
    };
    const r = await buildRecipe(recipe);
    expect(r.warnings).toEqual([]);
    // the line now runs only inside the circle
    const line = r.file.doc.guides.find((g) => g.type === 'line' || g.type === 'edges');
    expect(line).toBeDefined();
    expect(r.file.doc.trimmed?.length).toBe(2);
  });

  it('sets words, with a border, from the bundled fonts', async () => {
    const r = await buildRecipe({ ...base, text: [{ text: 'Logo', y: 800, size: 120, color: 1, border: { width: 6, color: '#ffffff' } }] });
    expect(r.warnings).toEqual([]);
    expect(r.summary.letters).toBe(4);
    const letter = r.file.doc.shapes.find((s) => s.group && r.file.doc.groups[s.group]?.text)!;
    expect(letter.fill).toBe(1);
    expect(letter.stroke).toMatchObject({ color: '#ffffff', width: 12, outside: true });
  }, 30000);
});
