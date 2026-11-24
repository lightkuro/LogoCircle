/**
 * What a first-time visitor finds on the canvas: a small three-piece mark and
 * a word, built with the app's own tools. It shows the idea at a glance and is
 * there to be changed or deleted.
 */
import { faceAt } from '@/engine';
import { translate } from '@/geom';
import { newDoc } from '@/model/doc';
import { buildDocArrangement, paintFaces } from '@/model/paint';
import { uid } from '@/model/ids';
import type { Doc, Guide } from '@/model/types';

export async function buildStarter(): Promise<Doc> {
  let doc = newDoc('My first logo');
  const guides: Guide[] = [
    { id: uid('g'), type: 'ellipse', cx: 462, cy: 420, rx: 170, ry: 170, rot: 0 },
    { id: uid('g'), type: 'ellipse', cx: 618, cy: 318, rx: 112, ry: 112, rot: 0 },
  ];
  doc = { ...doc, guides };
  // Three pieces from two circles: the two outer parts in color 1, the overlap in color 2.
  const spots: [number, number, number][] = [
    [400, 460, 0],
    [690, 280, 0],
    [570, 345, 1],
  ];
  for (const slot of [0, 1]) {
    const arr = buildDocArrangement(doc, true);
    const faces = spots.filter((s) => s[2] === slot).map((s) => faceAt(arr, { x: s[0], y: s[1] })).filter((f) => f >= 0);
    doc = paintFaces(doc, arr, faces, slot);
  }
  try {
    const { layoutText, textShapes } = await import('@/text/layout');
    const info = { value: 'default', fontId: 'poppins', size: 150, spacing: 0, fill: 0 };
    const layout = await layoutText(info.value, info.fontId, info.size, info.spacing);
    const { shapes, group } = textShapes(layout, info, translate(512 - layout.width / 2, 740));
    doc = { ...doc, shapes: [...doc.shapes, ...shapes], groups: { ...doc.groups, [group.id]: group } };
  } catch {
    /* offline on the very first visit: the mark alone is fine */
  }
  return doc;
}
