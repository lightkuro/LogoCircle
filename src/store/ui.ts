import { create } from 'zustand';
import type { LucideIcon } from 'lucide-react';
import type { Mat } from '@/geom';
import type { PatternSpec } from '@/model/pattern';
import type { Crossing } from '@/model/fillet';

export type Mode = 'classic' | 'advanced';
/** arrange = move things around; color = tap areas; pen/brush are Advanced drawing tools. */
export type Tool = 'arrange' | 'color' | 'pen' | 'brush' | 'draw' | 'cut' | 'mirror';
/**
 * What a drag does while no drawing tool is on. `move` is the everyday one:
 * drag a thing to move it, drag empty canvas to pan.
 */
export type SelectMode = 'move' | 'pan' | 'box' | 'lasso' | 'single';
export type SheetName = null | 'export' | 'text' | 'gallery' | 'menu' | 'help' | 'code' | 'settings' | 'changes';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a divider above this item. */
  divide?: boolean;
  /** A color dot shown before the label. */
  swatch?: string;
  icon?: LucideIcon;
  /** A tick after the label: something switched on. */
  checked?: boolean;
  /** A heading that opens to these items (beside it with a mouse, in place with a finger). */
  children?: MenuItem[];
}

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
  selectMode: SelectMode;
  /** Touch: keep adding to the selection on tap. */
  multi: boolean;
  /** "Move": the selection (by its key) shows only moving and turning, for small things that are hard to grab. */
  moveOnly: string | null;
  /** A pattern being set up: what is repeated, how, and the key of everything it selects. */
  pattern: { ids: string[]; spec: PatternSpec; key: string } | null;
  /** A crossing being rounded off, and the radius so far. */
  fillet: { crossing: Crossing; r: number; max: number } | null;
  view: View;
  stage: { w: number; h: number };
  showGuides: boolean;
  trayOpen: boolean;
  sheet: SheetName;
  /** The transform of the last Duplicate, for Repeat. */
  lastDup: Mat | null;
  /** Text group being edited in the text sheet, if any. */
  textTarget: string | null;
  galleryTab: 'mine' | 'examples';
  /** Brush thickness in document units (Advanced). */
  brushWidth: number;
  /** Advanced side panel open (phones show it as a sheet). */
  panelOpen: boolean;
  /** Snap to nearby outlines, edges and centres while dragging. */
  snap: boolean;
  /** Marks left by cutting visible: lines left by slicing (which then divide areas) and removed pieces, dotted. */
  showCuts: boolean;
  /** The selection box's angle after turning several things together; `key` names that selection. */
  selRot: { key: string; rot: number } | null;
  /** Dragging the export frame's handles instead of the artwork. */
  frameEdit: boolean;
  /** The corner being rounded: which outline and which of its points (−1 = all). */
  corner: { id: string; index: number } | null;
  /** Right-click / long-press menu, at a screen position. */
  menu: { x: number; y: number; items: MenuItem[]; touch?: boolean } | null;
  /** Which swatch has its small color panel open ('paper' for the background, 'new' for a swatch being added). */
  colorPanel: number | 'paper' | 'new' | null;
  /** Where the background's panel was asked for from (a button or a menu), to open by it. */
  colorAnchor: { left: number; top: number; right: number; bottom: number; width: number; height: number; side: 'above' | 'beside' } | null;
  /** While moving or reshaping, points snap to nearby edges, corners and points. */
  stickyPoints: boolean;
  /** Phones: the strip of colors at the side is folded down to one dot. */
  colorsFolded: boolean;
  /** Grid spacing in document units; 0 hides the grid (Advanced). */
  grid: number;
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
  selectMode: 'move',
  multi: false,
  moveOnly: null,
  pattern: null,
  fillet: null,
  view: { x: 0, y: 0, k: 1 },
  stage: { w: 0, h: 0 },
  showGuides: true,
  trayOpen: false,
  sheet: null,
  lastDup: null,
  textTarget: null,
  galleryTab: 'mine',
  brushWidth: 24,
  panelOpen: false,
  snap: true,
  showCuts: false,
  selRot: null,
  frameEdit: false,
  corner: null,
  menu: null,
  colorPanel: null,
  colorAnchor: null,
  stickyPoints: stored('lc.sticky', '') === '1',
  colorsFolded: stored('lc.colorsFolded', '') === '1',
  grid: 0,
  hintDismissed: stored('lc.hint', '') === '1',

  set: (patch) => set(patch),
  select: (ids) => set({ selection: ids }),
  setView: (view) => set({ view }),
}));

export const ui = (): UiState => useUi.getState();

// "Select more" is a momentary mode: it ends with the selection it was building.
// The corner being rounded likewise belongs to the selection it was picked from.
useUi.subscribe((s) => {
  if (s.multi && (s.selection.length === 0 || s.tool !== 'arrange')) useUi.setState({ multi: false });
  if (s.corner && (s.tool !== 'arrange' || s.selection.length !== 1 || s.selection[0] !== s.corner.id)) useUi.setState({ corner: null });
  if (s.frameEdit && s.tool !== 'arrange') useUi.setState({ frameEdit: false });
  if (s.colorAnchor && s.colorPanel !== 'paper') useUi.setState({ colorAnchor: null });
  if (s.moveOnly && (s.tool !== 'arrange' || selectionKey(s.selection) !== s.moveOnly)) useUi.setState({ moveOnly: null });
});

export const selectionKey = (ids: string[]): string => [...ids].sort().join(',');
