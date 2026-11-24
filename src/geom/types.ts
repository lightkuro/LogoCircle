/**
 * Core geometry types shared by the model, the canvas and the region engine.
 *
 * Every outline in LogoCircle is made of *edges*, and every edge is a stretch
 * of a *carrier*: an exact curve (line, ellipse or cubic bezier). Keeping the
 * carrier around is what lets a shape that was colored in between two circles
 * export as true SVG arcs instead of a thousand-point polygon.
 */

export interface Pt {
  x: number;
  y: number;
}

/** SVG-style affine matrix: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Mat = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

/** Straight carrier. Parameter t ∈ [0,1] runs from (x0,y0) to (x1,y1). */
export interface LineC {
  readonly k: 'L';
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Full ellipse carrier. Parameter t is the angle in the ellipse's own frame:
 * p(t) = center + R(rot) · (rx·cos t, ry·sin t). With SVG's y-down axes an
 * increasing t runs clockwise on screen (SVG sweep-flag 1).
 */
export interface EllipseC {
  readonly k: 'E';
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  /** radians */
  readonly rot: number;
}

/** Cubic bezier carrier. Parameter t ∈ [0,1]. */
export interface CubicC {
  readonly k: 'C';
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly x3: number;
  readonly y3: number;
}

export type Carrier = LineC | EllipseC | CubicC;

/**
 * A directed stretch of a carrier, from parameter t0 to t1. t1 < t0 means the
 * carrier is walked backwards. For ellipses the parameters are unwrapped
 * angles, so |t1 - t0| ≤ 2π and a full turn is t0 → t0 ± 2π.
 */
export interface Edge {
  readonly c: Carrier;
  readonly t0: number;
  readonly t1: number;
}

/** A closed loop of edges; each edge ends where the next begins. */
export type Ring = Edge[];

/** An outline: open (a line, an unclosed curve) or closed. */
export interface Chain {
  edges: Edge[];
  closed: boolean;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
