import { faceAt } from '@/engine';
import { buildDocArrangement, paintFaces } from './paint';
import type { Doc } from './types';

/** Color the areas under the given points, as tapping them with a color would. */
export function colorize(doc: Doc, points: [number, number][], fill: number | null): Doc {
  const arr = buildDocArrangement(doc, true);
  return paintFaces(
    doc,
    arr,
    points.map(([x, y]) => faceAt(arr, { x, y })),
    fill,
  );
}
