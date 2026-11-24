import { create } from 'zustand';
import type { Mat } from '@/geom';

export type Mode = 'classic' | 'advanced';
/** arrange = move things around; color = tap areas; pen/brush are Advanced drawing tools. */
export type Tool = 'arrange' | 'color' | 'pen' | 'brush';
export type SheetName = null | 'export' | 'colors' | 'text' | 'gallery' | 'menu' | 'help' | 'code';

export interface View {
  /** screen = doc × k + (x, y) */
  x: number;
  y: number;
  k: number;
}

interface UiState {
  mode: Mode;
  tool: Tool;
  /** Active palette slot (or fixed hex in Advanced). */
  ink: number | string;
  erasing: boolean;
  selection: string[];
  /** Touch: keep adding to the selection on tap. */
  multi: boolean;
  view: View;
  stage: { w: number; h: number };
  showGuides: boolean;
  trayOpen: boolean;
  sheet: SheetName;
  /** Which swatch the color editor is editing: a palette index or 'paper'. */
  editing: number | 'paper' | null;
  /** The transform of the last Duplicate, for Repeat. */
  lastDup: Mat | null;
  /** Text group being edited in the text sheet, if any. */
  textTarget: string | null;
  galleryTab: 'mine' | 'examples';
  /** Brush thickness in document units (Advanced). */
  brushWidth: number;
  /** Advanced side panel open (phones show it as a sheet). */
  panelOpen: boolean;
  hintDismissed: boolean;

  set: (patch: Partial<UiState>) => void;
  select: (ids: string[]) => void;
  setView: (view: View) => void;
}

const stored = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

export const remember = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: preferences simply do not persist */
  }
};

export const useUi = create<UiState>((set) => ({
  mode: stored('lc.mode', 'classic') === 'advanced' ? 'advanced' : 'classic',
  tool: 'arrange',
  ink: 0,
  erasing: false,
  selection: [],
  multi: false,
  view: { x: 0, y: 0, k: 1 },
  stage: { w: 0, h: 0 },
  showGuides: true,
  trayOpen: false,
  sheet: null,
  editing: null,
  lastDup: null,
  textTarget: null,
  galleryTab: 'mine',
  brushWidth: 28,
  panelOpen: false,
  hintDismissed: stored('lc.hint', '') === '1',

  set: (patch) => set(patch),
  select: (ids) => set({ selection: ids }),
  setView: (view) => set({ view }),
}));

export const ui = (): UiState => useUi.getState();
