import type { Edge, Mat, Pt, Ring } from '@/geom';

/** A color: an index into the document palette (a linked swatch) or a fixed hex string. */
export type Fill = number | string;

export interface Stroke {
  color: Fill;
  width: number;
  join?: 'round' | 'miter' | 'bevel';
  cap?: 'round' | 'butt' | 'square';
}

/** A painted, exported shape. */
export interface Shape {
  id: string;
  rings: Ring[];
  fill: Fill | null;
  stroke?: Stroke;
  opacity?: number;
  /** Group id: the letters of one word share a group. */
  group?: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  /** Angle of the selection box, so it turns with the shape instead of snapping back upright. */
  rot?: number;
  /** How this shape follows the outlines it was colored in from. Absent = it stands on its own. */
  from?: Link;
}

/**
 * One kind of area between outlines, described by where it lies relative to
 * each of them rather than by coordinates — which is what lets a fill follow
 * its outlines when they move. Keys are "<guide id>#<chain index>".
 */
export interface Seed {
  /** Closed outlines this area is inside of. */
  in: string[];
  /** For open outlines along its edge: which side of them it is on. */
  sides: Record<string, 1 | -1>;
}

export type Link =
  /** Exactly the area one outline encloses (or the band of a thick one). */
  | { area: string }
  /** The areas matching these seeds between these outlines. */
  | { guides: string[]; seeds: Seed[] };

/**
 * Where a thick closed outline grows: into the shape (the default), evenly on
 * both sides, or outward.
 */
export type Band = 'in' | 'mid' | 'out';

interface GuideBase {
  id: string;
  hidden?: boolean;
  locked?: boolean;
  name?: string;
  /** Group id: grouped things are selected and moved together. */
  group?: string;
}

export interface EllipseGuide extends GuideBase {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
  /** 0 or absent = a hairline; > 0 = a ring you can color in. */
  width?: number;
  band?: Band;
}

export interface RectGuide extends GuideBase {
  type: 'rect';
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  /** Rounding of all four corners together. */
  radius: number;
  /** Rounding per corner, when they differ: top-left, top-right, bottom-right, bottom-left in the rectangle's own frame. */
  radii?: [number, number, number, number];
  width?: number;
  band?: Band;
}

export interface LineGuide extends GuideBase {
  type: 'line';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0 = a hairline guide; > 0 = a band you can color in. */
  width: number;
  /** A cut line: drawn dashed, has its own show/hide switch. */
  cut?: boolean;
}

/** Closed straight-sided outline: triangle, polygon, star. */
export interface PolyGuide extends GuideBase {
  type: 'poly';
  pts: Pt[];
  /** Corner rounding per point (same order as pts); missing or 0 = sharp. */
  radii?: number[];
  width?: number;
  band?: Band;
  rot?: number;
}

/** Smooth curve through points. */
export interface CurveGuide extends GuideBase {
  type: 'curve';
  pts: Pt[];
  closed: boolean;
  width: number;
  band?: Band;
  rot?: number;
}

/** A pen-tool node: anchor plus optional handles (absolute positions). */
export interface PathNode {
  x: number;
  y: number;
  /** incoming handle */
  ix?: number;
  iy?: number;
  /** outgoing handle */
  ox?: number;
  oy?: number;
}

/** Pen-tool path (Advanced). */
export interface PathGuide extends GuideBase {
  type: 'path';
  nodes: PathNode[];
  closed: boolean;
  width: number;
  band?: Band;
  rot?: number;
}

/**
 * An outline given directly as exact edges: what is left when an outline is
 * cut into pieces (an arc of a circle, a stretch of a curve).
 */
export interface EdgesGuide extends GuideBase {
  type: 'edges';
  edges: Edge[];
  closed: boolean;
  width: number;
  band?: Band;
  rot?: number;
}

export type Guide = EllipseGuide | RectGuide | LineGuide | PolyGuide | CurveGuide | PathGuide | EdgesGuide;
export type GuideType = Guide['type'];

export interface TextInfo {
  value: string;
  fontId: string;
  size: number;
  spacing: number;
  fill: Fill;
  /** Maps the freshly laid-out word to where it sits on the canvas. */
  m: Mat;
  /** Still exactly as typed (no letter moved, cut or recolored)? Then it can be retyped. */
  pristine: boolean;
}

export interface Group {
  id: string;
  kind: 'text' | 'group';
  name?: string;
  text?: TextInfo;
}

/** A reference photo. Never exported. */
export interface RefImage {
  id: string;
  /** Key of the image blob in the image store. */
  blob: string;
  /** Centre, size and rotation in document units. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  opacity: number;
  locked: boolean;
  hidden?: boolean;
  /** Draw the photo over the colored shapes (still under the outlines) to keep tracing. */
  above?: boolean;
}

export interface Doc {
  v: 1;
  id: string;
  name: string;
  /** The export frame. x and y are absent (0) in documents saved before it could be moved. */
  artboard: { x?: number; y?: number; w: number; h: number };
  /** Background color, or null for transparent. */
  paper: string | null;
  /** Linked swatches. Classic works with one to four of them. */
  palette: string[];
  guides: Guide[];
  /**
   * Pieces of outline removed with the Cut tool. They are not outlines any
   * more (they divide nothing and never export) but can be shown, faintly,
   * and brought back.
   */
  trimmed?: Guide[];
  shapes: Shape[];
  groups: Record<string, Group>;
  refs: RefImage[];
  createdAt: number;
  updatedAt: number;
}

export type ItemKind = 'guide' | 'shape' | 'ref';

export const ARTBOARD = 1024;
/** Classic mode's limit on colors. */
export const CLASSIC_COLORS = 4;
