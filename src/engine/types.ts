import type { Chain, Pt, Ring } from '@/geom';

/**
 * One thing whose outline divides the plane: a guide or a painted shape.
 */
export interface Source {
  /** Unique within one build (the guide's or shape's id). */
  id: string;
  /** Its boundary. Open chains (plain lines, unclosed curves) are allowed. */
  chains: Chain[];
  /**
   * true  → the closed chains enclose an interior (a painted shape, nonzero
   *         winding). Every face reports which filled sources contain it.
   * false → outline only (a guide).
   */
  fill: boolean;
}

export interface Face {
  /** Index into Arrangement.faces. */
  id: number;
  /** Area in document units², always positive. */
  area: number;
  /**
   * Flattened boundary in document coordinates: loops[0] is the outer loop,
   * the rest are holes. For previews and highlighting, not for export.
   */
  loops: Pt[][];
  /** Ids of the `fill` sources whose interior contains this face. */
  inside: string[];
  /**
   * −1 for a normal face. Otherwise this face is a sliver (too thin to see or
   * tap) and the value is the id of the neighbouring face it should follow:
   * whenever that face is painted or erased, paint or erase this one too.
   */
  follow: number;
  /** A point strictly inside the face (for labels and the magnifier). */
  center: Pt;
}

export interface BuildOptions {
  /**
   * Geometry outside this box is ignored. Defaults to 3× the bounding box of
   * the sources. Pass the artboard grown by one artboard on every side.
   */
  bounds?: { x: number; y: number; w: number; h: number };
  /** Flattening tolerance in document units. Default 0.01. */
  tolerance?: number;
}

export interface Arrangement {
  /** Bounded faces only. */
  faces: Face[];
  /** Engine internals; treat as opaque. */
  readonly _: unknown;
}

export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'exclude';

export type { Chain, Pt, Ring };
