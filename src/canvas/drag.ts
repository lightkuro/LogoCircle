import { create } from 'zustand';
import type { BBox, Mat, Pt } from '@/geom';
import type { Guide } from '@/model/types';

/**
 * Transient state of the gesture in progress. Kept out of the document store
 * so a drag never creates undo steps and only the dragged items re-render.
 */
interface DragState {
  /** Items being transformed and the transform so far. */
  ids: Set<string> | null;
  mat: Mat | null;
  /** A guide being reshaped by one of its points. */
  guide: Guide | null;
  /** Faces under the current color/erase stroke. */
  paint: number[];
  /** Face under the mouse (hover preview). */
  hover: number;
  /** Rubber-band selection rectangle, in document space. */
  marquee: BBox | null;
  /** Alignment lines to show while snapping, in document space. */
  snapLines: { a: Pt; b: Pt }[];
  /** Where the finger is (screen px) while painting on touch; drives the magnifier. */
  loupe: Pt | null;
  /** Shape being drawn with a draw-tool (preview), as path data. */
  draft: string | null;
  /** Stroke width of the draft in document units; 0 draws a hairline. */
  draftWidth: number;
  set: (patch: Partial<DragState>) => void;
  reset: () => void;
}

const EMPTY: Pick<DragState, 'ids' | 'mat' | 'guide' | 'paint' | 'hover' | 'marquee' | 'snapLines' | 'loupe' | 'draft' | 'draftWidth'> = {
  ids: null,
  mat: null,
  guide: null,
  paint: [],
  hover: -1,
  marquee: null,
  snapLines: [],
  loupe: null,
  draft: null,
  draftWidth: 0,
};

export const useDrag = create<DragState>((set) => ({
  ...EMPTY,
  set: (patch) => set(patch),
  reset: () => set({ ...EMPTY }),
}));
