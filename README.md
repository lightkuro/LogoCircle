# LogoCircle

Make a logo by drawing simple outlines and coloring in the areas between them. Runs entirely in the browser, on desktop and phone, and exports clean SVG.

## How it works

1. **Outlines.** Add circles, shapes, lines and curves. They are construction guides: overlap them freely, and trace over a reference photo if you like.
2. **Color.** Tap a color, then tap or drag across the areas the outlines enclose. Neighbouring areas of the same color merge into one shape. Or select an outline and tap a color to color it directly; give it thickness first and it colors as a ring or a stroke.
3. **Refine.** Under Cut: tap a piece of an outline between two crossings to remove it, drag a line across shapes to slice them, or Erase areas. Show cut lines shows removed pieces as dots; tap one to bring it back. A fill follows its outlines when they are moved or reshaped. Words work the same way: put an outline over a letter, then erase or recolor what it cuts.
4. **Export.** Hide the outlines to see the logo, adjust the frame size, then download SVG or PNG.

Repeat (in the selection bar) copies again with the same spacing, or sets up a Pattern: a row (count, distance, angle), a circle (count, radius) or a grid (across, down, distance), shown live and kept as one undo step. Right-click where two straight outlines cross or meet to round it off (Round this crossing): an arc joins them and lines are cut back to it. Thick lines can have round or flat ends, and lines have a knob to turn them. Move, in the right-click menu, leaves a small thing with only moving and turning. Select › Move › Move points puts corners and points before resizing (a square's corner then moves on its own and the square becomes four free points); right-click a covered corner for Move corner. The small dots that add a point can be switched off in Settings. Text can have a border (width and color, drawn behind the letters so they keep their weight) or be hollow, from the text panel or the selection bar's Border, which works on any colored shape.

Right-click (or press and hold) anything for what can be done with it, with related choices (Color, Repeat, Flip, Order) grouped beside the menu: round a single corner, add a point to a polygon's side, edit a word, change the order, group. Sticky points, under More, makes corners and points stick to nearby corners, points and edges while moving or reshaping. Mirror copy, also under More (key M), copies the selection across a line: tap any straight line or side, one of the frame's centre lines, or drag to draw one; mirror again across the other way for four. Select, One at a time picks single pieces, even inside a group, and each tap adds to the selection or takes away, like Shift-click.

On a desktop the bar of tools can be opened out with the tab at its end (click, or drag to open one group at a time): Cut and Erase, the shapes, then the lines get buttons of their own, as many as fit. Right-click any tool to pin it to the bar or unpin it; Settings has the same list. With a mouse, lists show the moment the pointer is over them. Side panels (Guide, Settings, text) drag wider by their inner edge. Text shows live on the canvas while you type; clicking off puts it down, X cancels. Font settings, next to Your font, offers the weights and italic a font has, and its own features (Paper Mono: ligatures, single-story a, slashed zero, and more), applied by a small OpenType substitution engine (`src/text/gsub.ts`).

Phones get their own layout: upright, one bar of tools along the bottom, colors down the side and panels on the lower half of the screen; turned on their side, the tools run down the left edge and Select and zoom down the right, so the canvas keeps the full height. Phones get touch wording only; desktops get mouse and keyboard wording. Settings, in the LogoCircle menu, can force either layout, switch between light and dark, swap what the left and right mouse buttons do on empty canvas, turn on hold and drag (press a tool button, slide onto a choice in its list and let go), and change any keyboard shortcut.

Two modes share one document:

- **Classic** (default): up to four linked colors, one reference photo, and only the essentials.
- **Advanced**: unlimited colors, layers, strokes, opacity, boolean operations, pen, point editing, alignment, numeric sizes, grid, SVG import, more export formats, project files.

The version number at the foot of the LogoCircle menu opens What's new, kept in `src/changelog.ts` (features people can see or use only; add an entry, newest first, with each release and keep `package.json` in step).

Everything is stored on your device (IndexedDB). Nothing is uploaded. The privacy and terms page is `public/privacy.html`, served at `/privacy`.

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

`npm test` runs the region engine's unit and property tests. `npm run e2e` (after a build) drives the built app in a real browser on a desktop and a phone viewport and rebuilds the three kinds of logo the app was designed around; it needs Playwright (`npm i -D playwright && npx playwright install chromium`). `E2E_ONLY=touch,mirrorAndPicking npm run e2e` runs just the named flows.

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

69 fonts are bundled and fetched only when used: 68 through [Fontsource](https://fontsource.org), and Paper Mono from [its own repository](https://github.com/paper-design/paper-mono) (in `src/text/vendor`, with its licence). They are licensed under the SIL Open Font License, except Luckiest Guy, Roboto Slab and Yellowtail, which are Apache 2.0. You can also load your own TTF, OTF or WOFF file; it stays on your device.

The color sets (Soft, Coffee, Pear and so on) are just colors in the spirit of familiar brands: no names, logos or other brand assets are used.

## License

GPL-3.0-or-later. See `LICENSE`.
