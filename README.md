# LogoCircle

Make a logo by drawing simple outlines and coloring in the areas between them. Runs entirely in the browser, on desktop and phone, and exports clean SVG.

## How it works

1. **Outlines.** Add circles, lines, rectangles, triangles and curves. They are construction guides: overlap them freely, and trace over a reference photo if you like.
2. **Color.** Tap a color, then tap or drag across the areas the outlines enclose. Neighbouring areas of the same color merge into one shape. The eraser clears areas the same way.
3. **Export.** Hide the outlines to see the logo, then download SVG or PNG.

Words work the same way: type a word, put an outline over a letter, and erase or recolor what it cuts.

Two modes share one document:

- **Classic** (default): three linked colors, one reference photo, and only the essentials.
- **Advanced**: unlimited colors, layers, strokes, opacity, boolean operations, pen and brush, point editing, alignment, numeric sizes, SVG import, more export formats, project files.

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

The bundled fonts come from [Fontsource](https://fontsource.org) and are licensed under the SIL Open Font License: Poppins, Montserrat, Inter, Outfit, Josefin Sans, Space Grotesk, Rubik, Archivo Black, Bebas Neue, Anton, Oswald, Righteous, Fredoka, Nunito, Playfair Display, DM Serif Display, Abril Fatface, Pacifico.

## License

GPL-3.0-or-later. See `LICENSE`.
