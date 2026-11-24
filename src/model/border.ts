import type { Border, Stroke } from './types';

/** The stroke that draws a border: behind the shape so only its outer half shows, or the shape's own outline when hollow. */
export function borderStroke(b: Border): Stroke {
  return b.hollow ? { color: b.fill, width: b.width, join: 'round' } : { color: b.fill, width: b.width * 2, join: 'round', outside: true };
}
