import { ARTBOARD, type Doc, type Fill, type Guide, type ItemKind, type RefImage, type Shape } from './types';
import { uid } from './ids';

export interface PaletteDef {
  name: string;
  /** Two to four colors. */
  colors: string[];
}

/**
 * Color sets borrowed from well-known brands. A brand with one signature
 * color is paired with black or white so every set has at least two.
 */
export const PALETTES: PaletteDef[] = [
  { name: "McDonald's", colors: ['#da291c', '#ffc72c'] },
  { name: 'John Deere', colors: ['#367c2b', '#ffde00'] },
  { name: 'Taco Bell', colors: ['#702082', '#ef1897', '#fee100'] },
  { name: 'Google', colors: ['#4285f4', '#ea4335', '#fbbc05', '#34a853'] },
  { name: 'Starbucks', colors: ['#00704a', '#000000'] },
  { name: 'Apple', colors: ['#000000', '#a2aaad'] },
  { name: 'Ford', colors: ['#003478', '#ffffff'] },
  { name: 'Coca-Cola', colors: ['#f40009', '#ffffff'] },
];

/** A few plain colors for quick picking. */
export const BASIC_COLORS = ['#000000', '#ffffff', '#8e8e93', '#e5383b', '#ff8a00', '#f4b942', '#2a9d55', '#16a3b8', '#2f6bff', '#7c3aed', '#ec4899', '#8b5e3c'];

export const DEFAULT_PALETTE = ['#16877f', '#f29e4c'];

/** The color a newly added swatch starts with: black first, then whatever is not there yet. */
export function nextColor(palette: string[]): string {
  const have = new Set(palette.map((c) => c.toLowerCase()));
  return BASIC_COLORS.find((c) => !have.has(c)) ?? '#000000';
}

export const PAPERS: (string | null)[] = ['#ffffff', '#f5f1e8', '#111111', null];

/** The export frame as a plain rectangle. */
export function board(doc: Pick<Doc, 'artboard'>): { x: number; y: number; w: number; h: number } {
  const a = doc.artboard;
  return { x: a.x ?? 0, y: a.y ?? 0, w: a.w, h: a.h };
}

export function newDoc(name = 'Untitled logo'): Doc {
  const now = Date.now();
  return {
    v: 1,
    id: uid('d'),
    name,
    artboard: { w: ARTBOARD, h: ARTBOARD },
    paper: '#ffffff',
    palette: [...DEFAULT_PALETTE],
    guides: [],
    shapes: [],
    groups: {},
    refs: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function resolveFill(doc: Pick<Doc, 'palette'>, fill: Fill | null | undefined): string {
  if (fill === null || fill === undefined) return 'none';
  if (typeof fill === 'number') return doc.palette[fill] ?? '#000000';
  return fill;
}

export function findGuide(doc: Doc, id: string): Guide | undefined {
  return doc.guides.find((g) => g.id === id);
}

export function findShape(doc: Doc, id: string): Shape | undefined {
  return doc.shapes.find((s) => s.id === id);
}

export function findRef(doc: Doc, id: string): RefImage | undefined {
  return doc.refs.find((r) => r.id === id);
}

export function kindOf(doc: Doc, id: string): ItemKind | null {
  if (doc.guides.some((g) => g.id === id)) return 'guide';
  if (doc.shapes.some((s) => s.id === id)) return 'shape';
  if (doc.refs.some((r) => r.id === id)) return 'ref';
  return null;
}

/** Ids of everything in a group (shapes and outlines). */
export function groupMembers(doc: Doc, groupId: string): string[] {
  return [...doc.guides.filter((g) => g.group === groupId).map((g) => g.id), ...doc.shapes.filter((s) => s.group === groupId).map((s) => s.id)];
}

export function isEmptyDoc(doc: Doc): boolean {
  return doc.guides.length === 0 && doc.shapes.length === 0 && doc.refs.length === 0;
}

export function sameFill(a: Fill | null, b: Fill | null): boolean {
  return a === b;
}

/** A shape that is nothing but a flat fill (the only kind Classic creates). */
export function isPlain(s: Shape): boolean {
  return s.fill !== null && !s.stroke && (s.opacity === undefined || s.opacity === 1);
}
