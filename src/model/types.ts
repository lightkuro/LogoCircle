import type { Mat, Pt, Ring } from '@/geom';

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
}

interface GuideBase {
  id: string;
  hidden?: boolean;
  locked?: boolean;
  name?: string;
}

export interface EllipseGuide extends GuideBase {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
}

export interface RectGuide extends GuideBase {
  type: 'rect';
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  radius: number;
}

export interface LineGuide extends GuideBase {
  type: 'line';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0 = a hairline guide; > 0 = a band you can color in. */
  width: number;
}

/** Closed straight-sided outline: triangle, polygon, star. */
export interface PolyGuide extends GuideBase {
  type: 'poly';
  pts: Pt[];
}

/** Smooth curve through points. */
export interface CurveGuide extends GuideBase {
  type: 'curve';
  pts: Pt[];
  closed: boolean;
  width: number;
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
}

export type Guide = EllipseGuide | RectGuide | LineGuide | PolyGuide | CurveGuide | PathGuide;
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
  artboard: { w: number; h: number };
  /** Background color, or null for transparent. */
  paper: string | null;
  /** Linked swatches. Classic mode shows the first three. */
  palette: string[];
  guides: Guide[];
  shapes: Shape[];
  groups: Record<string, Group>;
  refs: RefImage[];
  createdAt: number;
  updatedAt: number;
}

export type ItemKind = 'guide' | 'shape' | 'ref';

export const ARTBOARD = 1024;
