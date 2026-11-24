# LogoCircle

Make a logo by drawing simple outlines and coloring in the areas between them. Runs entirely in the browser, on desktop and phone, and exports clean SVG.

## How it works

1. **Outlines.** Add circles, shapes, lines and curves. They are construction guides: overlap them freely, and trace over a reference photo if you like.
2. **Color.** Tap a color, then tap or drag across the areas the outlines enclose. Neighbouring areas of the same color merge into one shape. Or select an outline and tap a color to color it directly; give it thickness first and it colors as a ring or a stroke.
3. **Refine.** Erase areas, or Cut straight through shapes and outlines to split them. A fill follows its outlines when they are moved or reshaped. Words work the same way: put an outline over a letter, then erase or recolor what it cuts.
4. **Export.** Hide the outlines to see the logo, adjust the export frame, then download SVG or PNG.

Right-click (or press and hold) anything for what can be done with it.

Two modes share one document:

- **Classic** (default): up to four linked colors, one reference photo, and only the essentials.
- **Advanced**: unlimited colors, layers, strokes, opacity, boolean operations, pen, point editing, alignment, numeric sizes, grid, SVG import, more export formats, project files.

Everything is stored on your device (IndexedDB). Nothing is uploaded.

## Develop

Requires Node 22 or newer.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm test` runs the region engine's unit and property tests. `npm run e2e` (after a build) drives the built app in a real browser on a desktop and a phone viewport and rebuilds the three kinds of logo the app was designed around; it needs Playwright (`npm i -D playwright && npx playwright install chromium`).

## Deploy to Cloudflare (free)

The app is a static site served by Cloudflare Workers static assets. There is no server code, and asset requests are free and unlimited.

**From Git (recommended).** In the Cloudflare dashboard go to *Workers & Pages → Create → Import a repository*, pick this repo, and set:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

Every push to `main` then builds and deploys. The settings live in `wrangler.jsonc`; long-lived caching for hashed assets is in `public/_headers`.

**From your machine.**

```bash
npx wrangler login
```

```bash
npm run deploy
```

## Project layout

```
src/
  geom/      exact curves (lines, ellipse arcs, cubic beziers), transforms, SVG path data
  engine/    the region engine: divides the canvas into areas and turns areas back into exact curves
  model/     the document, its operations, and painting
  store/     app state (undo/redo), UI state, autosave
  canvas/    the SVG stage, gestures, selection handles, snapping
  text/      bundled fonts and text-to-shapes
  export/    SVG and image export
  advanced/  Advanced-mode commands and tools
  examples/  starter logos, built with the same tools a person uses
  ui/        top bar, dock, sheets, panels
```

The region engine is the core. Each outline keeps its exact curve, so a shape colored in between two circles exports as true SVG arcs rather than a many-pointed polygon. Its tests live in `src/engine/__tests__`.

## Fonts

68 fonts are bundled through [Fontsource](https://fontsource.org) and fetched only when used. They are licensed under the SIL Open Font License, except Luckiest Guy, Roboto Slab and Yellowtail, which are Apache 2.0. You can also load your own TTF, OTF or WOFF file; it stays on your device.

The color sets named after well-known brands are just colors: no logos or other brand assets are included.

## License

GPL-3.0-or-later. See `LICENSE`.
