#!/usr/bin/env node
// Build a logo recipe (JSON) into a LogoCircle project file, with previews.
//
//   npm run logo -- path/to/recipe.json [--out dir] [--size 1024] [--no-png]
//   npm run logo -- --check path/to/recipe.json     (check only, write nothing)
//   npm run logo -- --fonts                          (the fonts a recipe can use)
//
// Writes, next to the recipe unless --out says otherwise:
//   <name>.logocircle.json   open it in LogoCircle (drag it onto the canvas, or Menu › Open project file)
//   <name>.svg               the logo as it exports
//   <name>.png               a preview, and <name>.outlines.png with the outlines drawn in
//                            (PNGs need Playwright with Chromium; skipped without it)
//
// Prints a JSON summary: the files written, any warnings, and what was built.
// The recipe format is described in .claude/skills/logocircle-logo/SKILL.md.
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const values = new Set([option('--out'), option('--size')].filter(Boolean));
const recipes = args.filter((a) => !a.startsWith('--') && !values.has(a));

if (!flag('--fonts') && !recipes.length) {
  console.error('Usage: npm run logo -- recipe.json [--out dir] [--size 1024] [--no-png] [--check]\n       npm run logo -- --fonts');
  process.exit(2);
}

// The app loads font files by URL; here they come straight from disk.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/') && !url.startsWith('//')) return new Response(await readFile(join(root, decodeURIComponent(url.split('?')[0]))));
  return realFetch(input, init);
};

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: { '@': join(root, 'src') } },
  optimizeDeps: { noDiscovery: true, include: [] },
});

let failed = false;
try {
  const mod = await server.ssrLoadModule('/src/recipe/index.ts');
  if (flag('--fonts')) {
    console.log(JSON.stringify(mod.recipeFonts(), null, 2));
  } else {
    const out = [];
    for (const path of recipes) {
      const recipe = JSON.parse(await readFile(path, 'utf8'));
      let built;
      try {
        built = await mod.buildRecipe(recipe);
      } catch (err) {
        failed = true;
        out.push({ recipe: path, error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      const result = { recipe: path, warnings: built.warnings, summary: built.summary };
      if (!flag('--check')) {
        const dir = resolve(option('--out') ?? dirname(path));
        await mkdir(dir, { recursive: true });
        const slug = slugify(
          recipe.name ||
            basename(path)
              .replace(/\.json$/i, '')
              .replace(/\.recipe$/i, ''),
        );
        const file = join(dir, `${slug}.logocircle.json`);
        const svg = join(dir, `${slug}.svg`);
        await writeFile(file, JSON.stringify(built.file));
        await writeFile(svg, mod.recipePreview(built.file.doc, false, Number(option('--size') ?? 1024)));
        Object.assign(result, { file, svg });
        if (!flag('--no-png')) {
          const png = await renderPngs(mod, built.file.doc, join(dir, slug), Number(option('--size') ?? 1024));
          Object.assign(result, png);
        }
      }
      out.push(result);
    }
    console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));
  }
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'logo'
  );
}

/** The logo, and the logo with its outlines, as PNGs (needs Playwright with Chromium). */
async function renderPngs(mod, doc, base, size) {
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    return { png: null, note: 'No PNG preview: Playwright is not installed (npm i -D playwright && npx playwright install chromium). The SVG is there.' };
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: size, height: Math.round((size * doc.artboard.h) / doc.artboard.w) } });
    const shoot = async (svg, path) => {
      await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
      await page.locator('svg').first().screenshot({ path });
      return path;
    };
    return {
      png: await shoot(mod.recipePreview(doc, false, size), `${base}.png`),
      outlinesPng: await shoot(mod.recipePreview(doc, true, size), `${base}.outlines.png`),
    };
  } finally {
    await browser.close();
  }
}
