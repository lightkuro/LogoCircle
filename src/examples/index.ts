/**
 * Starter examples. Each is a recipe — outlines plus the spots to color — and
 * is built with the same tools a person uses, so opening one shows exactly how
 * it was made: the outlines are still there to move around.
 */
import { faceAt } from '@/engine';
import { ringsBBox, translate } from '@/geom';
import { newDoc } from '@/model/doc';
import { buildDocArrangement, paintFaces } from '@/model/paint';
import type { Doc, Guide } from '@/model/types';
import { uid } from '@/model/ids';

export interface Example {
  id: string;
  name: string;
  note: string;
  build: () => Promise<Doc>;
}

/** [x, y, palette slot] — a spot to color; slot −1 erases. */
type Spot = [number, number, number];

type GuideSpec = Guide extends infer G ? (G extends Guide ? Omit<G, 'id'> : never) : never;

function withGuides(doc: Doc, specs: GuideSpec[]): Doc {
  return { ...doc, guides: [...doc.guides, ...specs.map((g) => ({ ...g, id: uid('g') }) as Guide)] };
}

/** Color the areas under the given spots, one color at a time. */
function color(doc: Doc, spots: Spot[]): Doc {
  const slots = [...new Set(spots.map((s) => s[2]))];
  for (const slot of slots) {
    const arr = buildDocArrangement(doc, true);
    const faces = spots
      .filter((s) => s[2] === slot)
      .map((s) => faceAt(arr, { x: s[0], y: s[1] }))
      .filter((f) => f >= 0);
    doc = paintFaces(doc, arr, faces, slot < 0 ? null : slot);
  }
  return doc;
}

function base(name: string, palette: string[]): Doc {
  return { ...newDoc(name), palette };
}

function leaf(): Doc {
  let doc = base('Leaf', ['#2d6a4f', '#95d5b2']);
  doc = withGuides(doc, [
    { type: 'ellipse', cx: 402, cy: 402, rx: 310, ry: 310, rot: 0 },
    { type: 'ellipse', cx: 622, cy: 622, rx: 310, ry: 310, rot: 0 },
    { type: 'line', x0: 318, y0: 706, x1: 706, y1: 318, width: 0 },
    { type: 'line', x0: 326, y0: 698, x1: 236, y1: 788, width: 24 },
  ]);
  return color(doc, [
    [470, 470, 0],
    [554, 554, 1],
    [262, 762, 0],
  ]);
}

function sunset(): Doc {
  let doc = base('Sunset', ['#f9a03f', '#e4572e']);
  const lines = [500, 548, 572, 612, 632, 664, 680, 706, 718];
  doc = withGuides(doc, [
    { type: 'ellipse', cx: 512, cy: 500, rx: 250, ry: 250, rot: 0 },
    ...lines.map((y): GuideSpec => ({ type: 'line', x0: 212, y0: y, x1: 812, y1: y, width: 0 })),
  ]);
  return color(doc, [
    [512, 380, 0],
    [512, 524, 1],
    [512, 592, 1],
    [512, 648, 1],
    [512, 693, 1],
    [512, 736, 1],
  ]);
}

function fish(): Doc {
  let doc = base('Fish', ['#0077b6', '#48cae4']);
  doc = withGuides(doc, [
    { type: 'ellipse', cx: 532, cy: 262, rx: 340, ry: 340, rot: 0 },
    { type: 'ellipse', cx: 532, cy: 762, rx: 340, ry: 340, rot: 0 },
    {
      type: 'poly',
      pts: [
        { x: 330, y: 512 },
        { x: 186, y: 410 },
        { x: 186, y: 614 },
      ],
    },
    { type: 'ellipse', cx: 664, cy: 494, rx: 22, ry: 22, rot: 0 },
  ]);
  return color(doc, [
    [540, 540, 0],
    [316, 512, 0],
    [230, 512, 1],
  ]);
}

function target(): Doc {
  let doc = base('Orbit', ['#5a189a', '#9d4edd', '#ff9e00']);
  doc = withGuides(doc, [
    { type: 'ellipse', cx: 512, cy: 512, rx: 300, ry: 300, rot: 0 },
    { type: 'ellipse', cx: 512, cy: 512, rx: 200, ry: 200, rot: 0 },
    { type: 'ellipse', cx: 512, cy: 512, rx: 96, ry: 96, rot: 0 },
    { type: 'line', x0: 512, y0: 160, x1: 512, y1: 864, width: 0 },
    { type: 'line', x0: 160, y0: 512, x1: 864, y1: 512, width: 0 },
  ]);
  return color(doc, [
    // outer ring: two opposite quarters
    [690, 334, 0],
    [334, 690, 0],
    // middle ring: the other two
    [406, 406, 1],
    [618, 618, 1],
    // centre
    [540, 484, 2],
    [484, 540, 2],
    [484, 484, 2],
    [540, 540, 2],
  ]);
}

async function moon(): Promise<Doc> {
  const { layoutText, textShapes } = await import('@/text/layout');
  let doc = base('moon', ['#1d3557', '#f4b942']);
  const info = { value: 'moon', fontId: 'poppins', size: 250, spacing: 0, fill: 0 };
  const layout = await layoutText(info.value, info.fontId, info.size, info.spacing);
  const m = translate(512 - layout.width / 2, 512 + (layout.ascent + layout.descent) / 2);
  const { shapes, group } = textShapes(layout, info, m);
  doc = { ...doc, shapes, groups: { [group.id]: group } };
  // The first "o" becomes a crescent: make it a solid disc, then bite a circle out of it.
  const o = shapes[1];
  if (!o) return doc;
  const b = ringsBBox(o.rings);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const r = Math.min(b.w, b.h) / 2;
  doc = color(doc, [
    [cx, cy, 1],
    [cx - r * 0.86, cy, 1],
  ]);
  doc = withGuides(doc, [{ type: 'ellipse', cx: cx + r * 0.36, cy: cy - r * 0.3, rx: r * 0.8, ry: r * 0.8, rot: 0 }]);
  return color(doc, [[cx + r * 0.36, cy - r * 0.3, -1]]);
}

const cache = new Map<string, Promise<Doc>>();
const once = (id: string, make: () => Doc | Promise<Doc>) => (): Promise<Doc> => {
  let p = cache.get(id);
  if (!p) {
    p = Promise.resolve().then(make);
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  // Every open gets its own copy with a fresh id.
  return p.then((d) => ({ ...d, id: uid('d'), createdAt: Date.now(), updatedAt: Date.now() }));
};

export const EXAMPLES: Example[] = [
  { id: 'leaf', name: 'Leaf', note: 'Two circles and a line', build: once('leaf', leaf) },
  { id: 'sunset', name: 'Sunset', note: 'One circle, a stack of lines', build: once('sunset', sunset) },
  { id: 'fish', name: 'Fish', note: 'Circles and a triangle', build: once('fish', fish) },
  { id: 'orbit', name: 'Orbit', note: 'Rings cut in quarters', build: once('orbit', target) },
  { id: 'moon', name: 'moon', note: 'A word with a letter reshaped', build: once('moon', moon) },
];
