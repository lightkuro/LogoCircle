import { ARTBOARD, type Doc, type Fill, type Guide, type ItemKind, type RefImage, type Shape } from './types';
import { uid } from './ids';

export interface PaletteDef {
  name: string;
  colors: [string, string, string];
}

/** Curated three-color sets. Each works on white and reads well at small sizes. */
export const PALETTES: PaletteDef[] = [
  { name: 'Classic', colors: ['#111111', '#e5383b', '#f4b942'] },
  { name: 'Ocean', colors: ['#0f4c5c', '#2ec4b6', '#ff9f1c'] },
  { name: 'Forest', colors: ['#1b4332', '#52b788', '#f4a261'] },
  { name: 'Sunset', colors: ['#2d1e2f', '#f15152', '#f9c784'] },
  { name: 'Grape', colors: ['#2e1065', '#7c3aed', '#f0abfc'] },
  { name: 'Sky', colors: ['#1d3557', '#457b9d', '#a8dadc'] },
  { name: 'Candy', colors: ['#ff006e', '#8338ec', '#ffbe0b'] },
  { name: 'Mint', colors: ['#073b4c', '#06d6a0', '#ffd166'] },
  { name: 'Earth', colors: ['#3e2723', '#a1887f', '#ffcc80'] },
  { name: 'Mono', colors: ['#18181b', '#71717a', '#d4d4d8'] },
];

export const PAPERS: (string | null)[] = ['#ffffff', '#f5f1e8', '#111111', null];

export function newDoc(name = 'Untitled logo'): Doc {
  const now = Date.now();
  return {
    v: 1,
    id: uid('d'),
    name,
    artboard: { w: ARTBOARD, h: ARTBOARD },
    paper: '#ffffff',
    palette: [...PALETTES[0]!.colors],
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

/** Ids of every shape in a group. */
export function groupMembers(doc: Doc, groupId: string): string[] {
  return doc.shapes.filter((s) => s.group === groupId).map((s) => s.id);
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
