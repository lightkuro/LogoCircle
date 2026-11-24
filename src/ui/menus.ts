/**
 * Right-click (and press-and-hold) menus. One place decides what is offered
 * for whatever is under the pointer, so the menu always matches the thing.
 */
import type { Pt } from '@/geom';
import { commit, getDoc, useDoc } from '@/store/doc';
import { ui, useUi, type MenuItem } from '@/store/ui';
import { board } from '@/model/doc';
import { cornerRadius, guideArea, insertGuidePoint, maxCornerRadius, removeGuidePoint, setCornerRadius, togglePathNode } from '@/model/guides';
import { updateGuide } from '@/model/ops';
import type { Guide } from '@/model/types';
import {
  canRepeat,
  colorSelection,
  copySelection,
  deleteSelection,
  detachSelection,
  duplicateSelection,
  editFrame,
  expandToGroup,
  fitBoardToArtwork,
  fitToScreen,
  flipSelection,
  groupSelection,
  hasClipboard,
  orderSelection,
  pasteClipboard,
  removeSwatch,
  repeatDuplicate,
  selectAll,
  selectionGroups,
  setBoardRatio,
  ungroupSelection,
} from '@/actions';
import type { Handle } from '@/canvas/frame';

let byTouch = false;
const open = (at: Pt, items: MenuItem[]): void => {
  if (items.length) useUi.setState({ menu: { x: at.x, y: at.y, items, touch: byTouch } });
};

const patchGuide = (g: Guide): void => commit(updateGuide(getDoc(), g.id, g));

/** Start rounding a corner: give it a sensible radius and show the slider for it. */
export function roundCorner(g: Guide, index: number): void {
  const now = index < 0 ? 0 : cornerRadius(g, index);
  if (now === 0) {
    const max = index < 0 && g.type === 'poly' ? Math.min(...g.pts.map((_, i) => maxCornerRadius(g, i))) : maxCornerRadius(g, Math.max(0, index));
    patchGuide(setCornerRadius(g, index, Math.round(max * 0.4)));
  }
  useUi.setState({ corner: { id: g.id, index }, selection: [g.id] });
}

function pointMenu(g: Guide, h: Handle, d: Pt): MenuItem[] {
  const items: MenuItem[] = [];
  if (h.kind === 'mid') {
    items.push({ label: 'Add a point here', onSelect: () => patchGuide(insertGuidePoint(g, h.index, d)) });
    return items;
  }
  if (h.kind === 'box') {
    if (g.type === 'rect') {
      items.push({ label: g.radius > 0 ? 'Adjust rounding…' : 'Round the corners', onSelect: () => roundCorner(g, -1) });
      if (g.radius > 0) items.push({ label: 'Sharp corners', onSelect: () => patchGuide(setCornerRadius(g, -1, 0)) });
    }
    return items;
  }
  if (h.kind !== 'pt') return items;
  const i = h.index;
  if (g.type === 'poly') {
    const r = cornerRadius(g, i);
    items.push({ label: r > 0 ? 'Adjust this corner…' : 'Round this corner', onSelect: () => roundCorner(g, i) });
    if (r > 0) items.push({ label: 'Sharpen this corner', onSelect: () => patchGuide(setCornerRadius(g, i, 0)) });
    items.push({ label: 'Round all corners', onSelect: () => roundCorner(g, -1) });
    if (g.radii?.some((x) => x > 0)) items.push({ label: 'Sharpen all corners', onSelect: () => patchGuide(setCornerRadius(g, -1, 0)) });
  }
  if (g.type === 'path') {
    const n = g.nodes[i];
    const smooth = !!n && (n.ix !== undefined || n.ox !== undefined);
    items.push({ label: smooth ? 'Make this a sharp corner' : 'Make this point smooth', onSelect: () => patchGuide(togglePathNode(g, i)) });
  }
  if (g.type === 'poly' || g.type === 'curve' || g.type === 'path') {
    const next = removeGuidePoint(g, i);
    items.push({ label: 'Remove this point', disabled: !next, divide: items.length > 0, onSelect: () => next && patchGuide(next) });
  }
  if (g.type === 'curve') {
    items.push({ label: g.closed ? 'Open the curve' : 'Close the curve', onSelect: () => patchGuide({ ...g, closed: !g.closed }) });
  }
  return items;
}

function selectionMenu(): MenuItem[] {
  const doc = getDoc();
  const s = ui();
  const sel = new Set(s.selection);
  const shapes = doc.shapes.filter((x) => sel.has(x.id));
  const guides = doc.guides.filter((x) => sel.has(x.id));
  const refs = doc.refs.filter((x) => sel.has(x.id));
  const items: MenuItem[] = [];
  if (refs.length && !shapes.length && !guides.length) {
    const r = refs[0]!;
    const set = (patch: Partial<typeof r>): void => commit({ ...getDoc(), refs: getDoc().refs.map((x) => (x.id === r.id ? { ...x, ...patch } : x)), updatedAt: Date.now() });
    items.push({ label: r.locked ? 'Unlock to move or resize' : 'Lock in place', onSelect: () => set({ locked: !r.locked }) });
    items.push({ label: r.above ? 'Show under the colors' : 'Show over the colors', onSelect: () => set({ above: !r.above }) });
    items.push({ label: 'Remove photo', danger: true, divide: true, onSelect: deleteSelection });
    return items;
  }

  // Retype a word that has not been changed yet.
  const word = shapes.length && shapes.every((x) => x.group && x.group === shapes[0]!.group) ? doc.groups[shapes[0]!.group!] : undefined;
  if (word?.text?.pristine && doc.shapes.filter((x) => x.group === word.id).length === shapes.length) {
    items.push({ label: 'Edit text…', onSelect: () => useUi.setState({ sheet: 'text', textTarget: word.id }) });
  }

  // Color: any shape, and any outline that has (or can be given) an area.
  const limit = s.mode === 'classic' ? 4 : 8;
  doc.palette.slice(0, limit).forEach((c, i) => {
    items.push({ label: `Color ${i + 1}`, swatch: c, divide: i === 0 && items.length > 0, onSelect: () => void colorSelection(i) });
  });

  const one = guides.length === 1 && !shapes.length ? guides[0]! : null;
  if (one && (one.type === 'rect' || one.type === 'poly')) {
    items.push({ label: 'Round the corners…', divide: true, onSelect: () => roundCorner(one, -1) });
  }
  if (one && one.type === 'curve') {
    items.push({ label: one.closed ? 'Open the curve' : 'Close the curve', divide: true, onSelect: () => patchGuide({ ...one, closed: !one.closed }) });
  }

  items.push({ label: 'Duplicate', keys: 'Ctrl D', divide: true, onSelect: duplicateSelection });
  if (canRepeat()) items.push({ label: 'Repeat with the same spacing', keys: 'Ctrl Shift D', onSelect: repeatDuplicate });
  items.push({ label: 'Copy', keys: 'Ctrl C', onSelect: () => void copySelection() });
  items.push({ label: 'Flip left ↔ right', onSelect: () => flipSelection('h') });
  items.push({ label: 'Flip up ↕ down', onSelect: () => flipSelection('v') });

  if (shapes.length) {
    const first = doc.shapes[0];
    const last = doc.shapes[doc.shapes.length - 1];
    const atTop = shapes.includes(last!) && shapes.length === 1;
    const atBottom = shapes.includes(first!) && shapes.length === 1;
    items.push({ label: 'Bring forward', divide: true, disabled: atTop, onSelect: () => orderSelection('forward') });
    items.push({ label: 'Send backward', disabled: atBottom, onSelect: () => orderSelection('backward') });
    items.push({ label: 'Bring to front', disabled: atTop, onSelect: () => orderSelection('front') });
    items.push({ label: 'Send to back', disabled: atBottom, onSelect: () => orderSelection('back') });
  }

  const groupIds = selectionGroups();
  const members = [...doc.shapes, ...doc.guides].filter((x) => x.group && groupIds.includes(x.group)).length;
  // already exactly one whole group? then only offer to take it apart
  const oneGroup = groupIds.length === 1 && members === sel.size;
  if (sel.size > 1 && !oneGroup) items.push({ label: 'Group', keys: 'Ctrl G', divide: true, onSelect: groupSelection });
  if (groupIds.length) {
    items.push({ label: word ? 'Split into letters' : 'Ungroup', divide: oneGroup || sel.size <= 1, onSelect: ungroupSelection });
  }
  if (shapes.some((x) => x.from)) {
    items.push({ label: 'Detach from its outlines', divide: true, onSelect: detachSelection });
  }
  if (guides.some((g) => guideArea(g)) && !shapes.length) {
    // nothing extra: the Color items above fill it
  }
  items.push({ label: 'Delete', keys: 'Del', danger: true, divide: true, onSelect: deleteSelection });
  return items;
}

function canvasMenu(): MenuItem[] {
  const s = ui();
  const doc = getDoc();
  const items: MenuItem[] = [];
  if (hasClipboard()) items.push({ label: 'Paste', keys: 'Ctrl V', onSelect: pasteClipboard });
  items.push({ label: 'Select all', keys: 'Ctrl A', onSelect: selectAll });
  items.push({ label: s.showGuides ? 'Hide outlines' : 'Show outlines', keys: 'H', divide: true, onSelect: () => useUi.setState({ showGuides: !s.showGuides, selection: [] }) });
  if (doc.guides.some((g) => g.type === 'line' && g.cut)) {
    items.push({ label: s.showCuts ? 'Hide cut lines' : 'Show cut lines', onSelect: () => useUi.setState({ showCuts: !s.showCuts, selection: [] }) });
  }
  items.push({ label: 'Adjust the export frame…', divide: true, onSelect: () => editFrame(true) });
  items.push({ label: 'Fit the frame to the artwork', disabled: !doc.shapes.length, onSelect: fitBoardToArtwork });
  items.push({ label: 'Paper color…', onSelect: () => useUi.setState({ colorPanel: 'paper' }) });
  items.push({ label: 'Zoom to fit', keys: 'Ctrl 0', divide: true, onSelect: () => fitToScreen() });
  if (useDoc.getState().past.length) items.push({ label: 'Undo', keys: 'Ctrl Z', onSelect: () => useDoc.getState().undo() });
  return items;
}

function frameMenu(): MenuItem[] {
  const b = board(getDoc());
  return [
    { label: 'Square', onSelect: () => setBoardRatio(1, 1) },
    { label: 'Wide 4 : 3', onSelect: () => setBoardRatio(4, 3) },
    { label: 'Wide 16 : 9', onSelect: () => setBoardRatio(16, 9) },
    { label: 'Tall 3 : 4', onSelect: () => setBoardRatio(3, 4) },
    { label: 'Fit to the artwork', divide: true, onSelect: fitBoardToArtwork },
    { label: `Done (${Math.round(b.w)} × ${Math.round(b.h)})`, divide: true, onSelect: () => editFrame(false) },
  ];
}

/** The menu for a spot on the canvas. Whatever is under the pointer gets selected first. */
export function openCanvasMenu(at: Pt, d: Pt, handle: Handle | null, hits: string[], touch = false): void {
  byTouch = touch;
  const s = ui();
  if (s.frameEdit) return open(at, frameMenu());
  const doc = getDoc();
  if (handle && s.selection.length === 1) {
    const g = doc.guides.find((x) => x.id === s.selection[0]);
    if (g) {
      const items = pointMenu(g, handle, d);
      if (items.length) return open(at, items);
    }
  }
  const hit = hits.find((id) => s.selection.includes(id)) ?? hits[0];
  if (hit) {
    if (!s.selection.includes(hit)) useUi.setState({ selection: expandToGroup(doc, hit) });
    return open(at, selectionMenu());
  }
  if (handle && s.selection.length) return open(at, selectionMenu());
  useUi.setState({ selection: [] });
  open(at, canvasMenu());
}

/** The menu for a color swatch in the dock. */
export function openSwatchMenu(at: Pt, index: number, touch = false): void {
  byTouch = touch;
  const doc = getDoc();
  const used = doc.shapes.filter((s) => s.fill === index).length;
  open(at, [
    { label: 'Edit color…', swatch: doc.palette[index], onSelect: () => useUi.setState({ colorPanel: index }) },
    {
      label: 'Select everything in this color',
      disabled: used === 0,
      onSelect: () => useUi.setState({ tool: 'arrange', erasing: false, selection: getDoc().shapes.filter((s) => s.fill === index).map((s) => s.id) }),
    },
    {
      label: 'Remove color',
      danger: true,
      divide: true,
      disabled: doc.palette.length <= 1,
      onSelect: () => removeSwatch(index),
    },
  ]);
}
