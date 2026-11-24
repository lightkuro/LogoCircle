---
name: logocircle-logo
description: Design logos as LogoCircle project files. Use when asked to make, draft or sketch a logo, mark, wordmark or icon for LogoCircle, or to produce a .logocircle.json someone can open in the app. Write a short JSON recipe (outlines, spots to color, words), build it with `npm run logo`, look at the PNG preview, adjust, and hand over the project file.
---

# Making a LogoCircle logo

LogoCircle builds logos the way a coloring book works: you draw **outlines** (circles,
lines, polygons, curves), and every area they enclose can be **colored**. Outlines are
construction lines only; they are never part of the exported logo. Words are added as
letter shapes in a bundled font.

You describe a logo as a **recipe** (JSON). The build script turns it into a real project
file with the app's own engine, exactly as if someone had drawn the outlines and clicked
the areas, so the outlines stay in the file and the person can keep editing.

## Workflow

1. Write a recipe, e.g. `logos/fox.json` (see the format below, and `examples/` next to this file).
2. Build it from the repository root:

   ```bash
   npm run -s logo -- logos/fox.json
   ```

   (`-s` keeps npm's own banner out, so the output is JSON only.) It prints the files
   written, `warnings`, and a `summary`; a recipe it cannot build gives `error` instead and
   exit code 1. Files land next to the recipe (or in `--out <dir>`), named after the
   recipe's `name` (`"Ember Roast"` → `ember-roast.*`), or the recipe file's name without one:
   - `<name>.logocircle.json`: the project file to hand over
   - `<name>.png`: the logo as it exports; `<name>.outlines.png`: the same with the outlines drawn in
   - `<name>.svg`: the exported logo

   The `summary`: `outlines`; `areas`, the colored shapes (areas of one color that touch
   are joined into one shape, and letters are not counted, so this is often fewer than your
   spots); `words` and `letters`; `colors` in use; and `layout`, the boxes `{x, y, w, h}` of
   the `mark` (everything but the words), each of the `words`, and `all`, plus the `margins`
   left to each edge of the frame. Use `layout` to check margins and balance.

3. **Look at both PNGs** (Read them). Fix every warning; each one means something did not
   land as you meant. Adjust and rebuild until it looks right. Use `--check` to only validate.
4. Hand over the `.logocircle.json`. To open it in LogoCircle: drag it onto the canvas, or
   LogoCircle menu › Open project file. It opens as a new logo; nothing is overwritten.

Other commands: `npm run -s logo -- --fonts` lists the font ids (with each font's own
weight); `--size 128` makes smaller previews, named `<name>.128.png` and
`<name>.128.outlines.png` so the full-size ones stay; `--no-png` skips them (PNGs need
Playwright with Chromium; the SVG is always written).

## Recipe format

Coordinates are in the frame: (0, 0) is the top left, x grows right, **y grows down**,
default frame 1024 × 1024. Angles are in degrees, clockwise.

Recipes are JSON; `//` and `/* */` comments and trailing commas are allowed.

```jsonc
{
  "name": "Fox",                      // the logo's name (and the file name)
  "palette": ["#e76f2a", "#1c1c20"],  // colors by index; Classic mode shows up to four
  "background": "#f5f1e8",            // optional; the default is this cream paper; null = transparent
  "frame": { "w": 1024, "h": 1024 },  // optional
  "outlines": [ /* see below */ ],
  "trim": [[x, y]],                   // optional: remove the piece of outline under each point
  "color": [[x, y, 0]],               // [x, y, palette index]: color the area under the point; -1 clears it
  "text": [ /* see below */ ]
}
```

### Outlines

| type      | fields                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `circle`  | `cx, cy, r`                                                                                                                                             |
| `ellipse` | `cx, cy, rx, ry, rotate?`                                                                                                                               |
| `rect`    | `cx, cy, w, h, rotate?, radius?` (a number, or four: top left, top right, bottom right, bottom left)                                                    |
| `line`    | `from: [x, y], to: [x, y], width?, ends?` (`"round"` or `"flat"`)                                                                                       |
| `polygon` | `points: [[x, y], ...]` (3 or more, closed), `radius?` (one number or one per point)                                                                    |
| `regular` | `cx, cy, r, sides, rotate?, star?, radius?` (`star` = inner radius as a fraction of `r`, e.g. 0.45 makes a 5-point star; the first point is at the top) |
| `curve`   | `points: [[x, y], ...]` (a smooth curve through them), `closed?`                                                                                        |

Any outline can take `width` (> 0): it becomes a thick band (a ring for a circle, a
stroke for a line) that is itself an area to color. Thick lines end round unless
`ends: "flat"`; thick open curves always end round. Closed outlines also take
`band`: `"in"` (default), `"mid"` or `"out"`, the side the thickness grows on.

### Coloring

Outlines that overlap cut each other into areas. Every point in `color` colors the one
area it lands in:

- Neighbouring areas of the same color join into one shape.
- A spot that lands outside every outline, or right on a line, colors nothing (warning).
- Two spots in the same area: the later wins (warning when the colors differ).
- A thick outline's band is its own area; color it with a spot inside the band.
- Spots are applied in order, color by color; `-1` clears an area again.

**Keep spots well inside their area**, away from lines (5 units or more). Where shapes
overlap, every overlapping piece is a separate area: color each piece you want filled.
Check `<name>.outlines.png` to see where the areas are.

A shape made of several outlines (a teardrop: a circle and a triangle meeting it) has
the outlines' inner lines running through it, so it is several areas: put a spot in every
piece, all in the same color, and they join into one shape. Work out where outlines meet
(tangent points) with full precision, not rounded to a unit: a point a fraction off a
circle leaves a hairline sliver that needs a spot of its own.

### Trim

A line through a circle splits the circle _and_ the space outside it. `trim` removes
pieces of outline (a piece runs from one crossing to the next), as tapping it with Cut
does: put a point on the stretch to remove, e.g. on each end of a line that sticks out of
a shape. A point with no outline within 6 units is skipped (warning).

### Text

```jsonc
{
  "text": "FOX",
  "font": "poppins",
  "size": 150,
  "x": 512,
  "y": 840,
  "align": "center",
  "color": 0,
  "spacing": 0.05,
  "weight": 700,
  "italic": false,
  "features": ["ss01"],
  "border": { "width": 8, "color": "#ffffff", "hollow": false },
}
```

- `y` is the **baseline**; `x` is the center (or the left or right end with `align`). Default x is the middle of the frame.
- `size` is the font size in frame units (capitals are about 0.7 × size tall).
- `color` and `border.color`: a palette index or a hex color.
- `spacing`: letter spacing as a fraction of the size.
- `weight` (300–900; without it, the font's own weight shown by `--fonts`) and `italic` where the font has them; `features` are OpenType tags
  (Paper Mono: `ss01` code ligatures, `cv01` single-story a, `zero` slashed zero).
- `border` draws behind the letters (they keep their weight); `hollow: true` leaves only the outline.
- Fonts: `npm run -s logo -- --fonts`. Good defaults: `poppins`, `montserrat`, `archivo-black`,
  `bebas-neue`, `unbounded`, `paper-mono`, `playfair-display`, `dm-serif-display`, `pacifico`.

## Designing well

- **Few parts.** Two or three outlines and two colors make the strongest marks. Build from
  geometry: overlaps, a circle cut by a line, a shape inside a shape, symmetry about x = 512.
- **Leave margins**: keep everything well inside the frame (about 100 units clear) and
  balance the mark and the word as one block, usually mark above, word below.
- **Contrast**: the colors must read on the background and against each other; check
  that the logo still works small (`--size 128`).
- **Check overlaps** in the outlines preview: an unwanted sliver or gap means a spot landed
  in the wrong piece. Move the spot, move the outline, or trim.
- Offer two or three variations when asked for one logo, as separate recipes.

## Examples

`examples/` beside this file: `orbit.json` (a ring around a dot, a small planet clear of
the ring), `peak.json` (a triangle cut by a trimmed line, a sun), `leaf.json` (two
overlapping circles, a trimmed vein, a Paper Mono word), `badge.json` (a rounded square
with a star and a word). Build one to see the output:

```bash
npm run -s logo -- .claude/skills/logocircle-logo/examples/peak.json --out /tmp/peak
```
