/**
 * Right-click (and press-and-hold) menus. One place decides what is offered
 * for whatever is under the pointer, so the menu always matches the thing.
 */
import { flattenEdge, type Pt } from '@/geom';
import { commit, getDoc, useDoc } from '@/store/doc';
import { selectionKey, ui, useUi, type MenuItem } from '@/store/ui';
import { board } from '@/model/doc';
import { cornerRadius, guideArea, guideCenterline, guideHandles, insertGuidePoint, maxCornerRadius, removeGuidePoint, setCornerRadius, togglePathNode } from '@/model/guides';
import { updateGuide } from '@/model/ops';
import { crossingAt, maxFillet } from '@/model/fillet';
import { visibleGuides } from '@/model/paint';
import type { Guide } from '@/model/types';
import {
  openBackground,
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
  startFillet,
  startPattern,
  startMirror,
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
import { keyLabel } from '@/keys';
import { isTouch } from '@/store/settings';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Crop,
  Eye,
  EyeOff,
  FlipVertical2,
  FlipHorizontal,
  FlipHorizontal2,
  Grid2x2,
  Group as GroupIcon,
  Layers2,
  Lock,
  LockOpen,
  Maximize,
  Minus,
  Move,
  PaintBucket,
  Pencil,
  Plus,
  Repeat2,
  Scaling,
  Scissors,
  SquareDashedMousePointer,
  SquareRoundCorner,
  Square,
  Trash2,
  Undo2,
  Ungroup,
  Unlink,
  Spline,
} from 'lucide-react';

/** The key beside a menu item; none on touch devices. */
const key = (id: string): string | undefined => (isTouch() ? undefined : keyLabel(id));

let byTouch = false;
const open = (at: Pt, items: MenuItem[]): void => {
  if (items.length) useUi.setState({ menu: { x: at.x, y: at.y, items, touch: byTouch } });
};

const patchGuide = (g: Guide): void => commit(updateGuide(getDoc(), g.id, g));

/** A rectangle's corner handles, in the order its rounding is stored. */
const RECT_CORNER: Partial<Record<string, number>> = {
  nw: 0,
  ne: 1,
  se: 2,
  sw: 3,
};

const corners = (g: Guide): number => (g.type === 'rect' ? 4 : g.type === 'poly' ? g.pts.length : 0);
const anyRounded = (g: Guide): boolean => cornerRadius(g, -1) > 0;

/** Start rounding a corner (−1: all of them): give it a sensible radius and show the slider for it. */
export function roundCorner(g: Guide, index: number): void {
  if (cornerRadius(g, index) === 0) {
    let max = Infinity;
    if (index < 0) for (let i = 0; i < corners(g); i++) max = Math.min(max, maxCornerRadius(g, i));
    else max = maxCornerRadius(g, index);
    if (Number.isFinite(max)) patchGuide(setCornerRadius(g, index, Math.round(max * 0.4)));
  }
  useUi.setState({ corner: { id: g.id, index }, selection: [g.id] });
}

/** What can be done to one corner, and to all of them. */
function cornerItems(g: Guide, index: number | undefined): MenuItem[] {
  const items: MenuItem[] = [];
  if (index !== undefined) {
    const r = cornerRadius(g, index);
    items.push({
      label: r > 0 ? 'Adjust this corner' : 'Round this corner',
      icon: SquareRoundCorner,
      onSelect: () => roundCorner(g, index),
    });
    if (r > 0)
      items.push({
        label: 'Sharpen corner',
        icon: Square,
        onSelect: () => patchGuide(setCornerRadius(g, index, 0)),
      });
  }
  items.push({
    label: 'Round all corners',
    icon: SquareRoundCorner,
    divide: items.length > 0,
    onSelect: () => roundCorner(g, -1),
  });
  if (anyRounded(g))
    items.push({
      label: 'Sharpen all corners',
      icon: Square,
      onSelect: () => patchGuide(setCornerRadius(g, -1, 0)),
    });
  return items;
}

function pointMenu(g: Guide, h: Handle, d: Pt): MenuItem[] {
  const items: MenuItem[] = [];
  // On a side's small dot: the whole menu, which starts with "Add a point here".
  if (h.kind === 'mid') return items;
  if (h.kind === 'box') {
    // A square's corner handles round that one corner; its side handles offer all four.
    if (g.type === 'rect') items.push(...cornerItems(g, RECT_CORNER[h.at]));
    else {
      // A point under the stretch handle (a triangle's corners, a polygon's top): its menu, as if clicked directly.
      const tol = 10 / ui().view.k;
      const i = guideHandles(g).findIndex((p) => Math.hypot(p.x - d.x, p.y - d.y) <= tol);
      if (i >= 0) return pointMenu(g, { kind: 'pt', index: i }, d);
    }
    return items;
  }
  if (h.kind !== 'pt') return items;
  const i = h.index;
  if (g.type === 'poly') items.push(...cornerItems(g, i));
  if (g.type === 'path') {
    const n = g.nodes[i];
    const smooth = !!n && (n.ix !== undefined || n.ox !== undefined);
    items.push({
      label: smooth ? 'Make this a sharp corner' : 'Make this point smooth',
      icon: Spline,
      onSelect: () => patchGuide(togglePathNode(g, i)),
    });
  }
  if (g.type === 'poly' || g.type === 'curve' || g.type === 'path') {
    const next = removeGuidePoint(g, i);
    items.push({
      label: 'Remove point',
      icon: Minus,
      disabled: !next,
      divide: items.length > 0,
      onSelect: () => next && patchGuide(next),
    });
  }
  if (g.type === 'curve') {
    items.push({
      label: g.closed ? 'Open the curve' : 'Close the curve',
      icon: Spline,
      onSelect: () => patchGuide({ ...g, closed: !g.closed }),
    });
  }
  return items;
}

/** Which side of a polygon (or stretch of a curve) a point is on, if it is close to one. */
function sideAt(g: Guide, d: Pt, tol: number): number | null {
  if (g.type !== 'poly' && g.type !== 'curve') return null;
  const n = g.pts.length;
  const closed = g.type === 'poly' || g.closed;
  const edges = g.type === 'curve' ? guideCenterline(g)[0]?.edges : undefined;
  let best: number | null = null;
  let bestD = tol;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const pts = edges?.[i] ? flattenEdge(edges[i]!, 1) : [g.pts[i]!, g.pts[(i + 1) % n]!];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]!;
      const b = pts[k]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((d.x - a.x) * dx + (d.y - a.y) * dy) / len2)) : 0;
      const dist = Math.hypot(d.x - (a.x + dx * t), d.y - (a.y + dy * t));
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    }
  }
  return best;
}

function selectionMenu(d?: Pt, tol = 8): MenuItem[] {
  const doc = getDoc();
  const s = ui();
  const sel = new Set(s.selection);
  const shapes = doc.shapes.filter((x) => sel.has(x.id));
  const guides = doc.guides.filter((x) => sel.has(x.id));
  const refs = doc.refs.filter((x) => sel.has(x.id));
  const items: MenuItem[] = [];
  // On the edge of a polygon or curve: a new point, right there.
  const lone = guides.length === 1 && !shapes.length ? guides[0]! : null;
  const side = lone && d ? sideAt(lone, d, tol) : null;
  if (lone && d && side !== null) {
    items.push({ label: 'Add a point here', icon: Plus, onSelect: () => patchGuide(insertGuidePoint(lone, side, d)) });
  }
  // "Move": only moving and turning, for small things that are hard to grab.
  if (!refs.length || shapes.length || guides.length) {
    const key = selectionKey(s.selection);
    const on = s.moveOnly === key;
    items.push({ label: 'Move', icon: Move, checked: on, onSelect: () => useUi.setState({ moveOnly: on ? null : key }) });
  }
  if (refs.length && !shapes.length && !guides.length) {
    const r = refs[0]!;
    const set = (patch: Partial<typeof r>): void =>
      commit({
        ...getDoc(),
        refs: getDoc().refs.map((x) => (x.id === r.id ? { ...x, ...patch } : x)),
        updatedAt: Date.now(),
      });
    items.push({
      label: r.locked ? 'Unlock to move or resize' : 'Lock in place',
      icon: r.locked ? LockOpen : Lock,
      onSelect: () => set({ locked: !r.locked }),
    });
    items.push({
      label: r.above ? 'Show under colors' : 'Show over colors',
      icon: Layers2,
      onSelect: () => set({ above: !r.above }),
    });
    items.push({
      label: 'Remove photo',
      icon: Trash2,
      danger: true,
      divide: true,
      onSelect: deleteSelection,
    });
    return items;
  }

  // Retype a word that has not been changed yet.
  const word = shapes.length && shapes.every((x) => x.group && x.group === shapes[0]!.group) ? doc.groups[shapes[0]!.group!] : undefined;
  if (word?.text?.pristine && doc.shapes.filter((x) => x.group === word.id).length === shapes.length) {
    items.push({
      label: 'Edit text',
      icon: Pencil,
      onSelect: () => useUi.setState({ sheet: 'text', textTarget: word.id }),
    });
  }

  // Color: any shape, and any outline that has (or can be given) an area.
  const limit = s.mode === 'classic' ? 4 : 8;
  const colors: MenuItem[] = doc.palette.slice(0, limit).map((c, i) => ({ label: `Color ${i + 1}`, swatch: c, onSelect: () => void colorSelection(i) }));
  items.push({ label: 'Color', icon: PaintBucket, divide: items.length > 0, children: colors, onSelect: () => undefined });

  const one = guides.length === 1 && !shapes.length ? guides[0]! : null;
  if (one && (one.type === 'rect' || one.type === 'poly')) {
    const round: MenuItem = { label: 'Round all corners', icon: SquareRoundCorner, onSelect: () => roundCorner(one, -1) };
    if (anyRounded(one))
      items.push({
        label: 'Corners',
        icon: SquareRoundCorner,
        children: [round, { label: 'Sharpen all corners', icon: Square, onSelect: () => patchGuide(setCornerRadius(one, -1, 0)) }],
        onSelect: () => undefined,
      });
    else items.push(round);
  }
  if (one && one.type === 'curve') {
    items.push({
      label: one.closed ? 'Open the curve' : 'Close the curve',
      icon: Spline,
      onSelect: () => patchGuide({ ...one, closed: !one.closed }),
    });
  }

  items.push({
    label: 'Duplicate',
    icon: CopyPlus,
    keys: key('duplicate'),
    divide: true,
    onSelect: duplicateSelection,
  });
  items.push({
    label: 'Copy',
    icon: Copy,
    keys: key('copy'),
    onSelect: () => void copySelection(),
  });
  items.push({
    label: 'Repeat',
    icon: Repeat2,
    children: [
      { label: 'Repeat, same spacing', icon: Repeat2, keys: key('repeat'), disabled: !canRepeat(), onSelect: repeatDuplicate },
      { label: 'Pattern: row, circle, grid', icon: Grid2x2, onSelect: () => startPattern() },
    ],
    onSelect: () => undefined,
  });
  const flips: MenuItem[] = [
    { label: 'Flip sideways', icon: FlipVertical2, onSelect: () => flipSelection('h') },
    { label: 'Flip upside down', icon: FlipHorizontal2, onSelect: () => flipSelection('v') },
  ];
  if (guides.length || shapes.length) flips.push({ label: 'Mirror copy', icon: FlipHorizontal, keys: key('mirror'), divide: true, onSelect: startMirror });
  items.push({ label: 'Flip', icon: FlipVertical2, children: flips, onSelect: () => undefined });

  if (shapes.length) {
    const first = doc.shapes[0];
    const last = doc.shapes[doc.shapes.length - 1];
    const atTop = shapes.includes(last!) && shapes.length === 1;
    const atBottom = shapes.includes(first!) && shapes.length === 1;
    items.push({
      label: 'Order',
      icon: Layers2,
      children: [
        { label: 'Bring forward', icon: ArrowUp, disabled: atTop, onSelect: () => orderSelection('forward') },
        { label: 'Send backward', icon: ArrowDown, disabled: atBottom, onSelect: () => orderSelection('backward') },
        { label: 'Bring to front', icon: ArrowUpToLine, disabled: atTop, onSelect: () => orderSelection('front') },
        { label: 'Send to back', icon: ArrowDownToLine, disabled: atBottom, onSelect: () => orderSelection('back') },
      ],
      onSelect: () => undefined,
    });
  }

  const groupIds = selectionGroups();
  const members = [...doc.shapes, ...doc.guides].filter((x) => x.group && groupIds.includes(x.group)).length;
  // already exactly one whole group? then only offer to take it apart
  const oneGroup = groupIds.length === 1 && members === sel.size;
  if (sel.size > 1 && !oneGroup)
    items.push({
      label: 'Group',
      icon: GroupIcon,
      keys: key('group'),
      divide: true,
      onSelect: groupSelection,
    });
  if (groupIds.length) {
    items.push({
      label: word ? 'Split into letters' : 'Ungroup',
      icon: Ungroup,
      keys: key('ungroup'),
      divide: oneGroup || sel.size <= 1,
      onSelect: ungroupSelection,
    });
  }
  if (shapes.some((x) => x.from)) {
    items.push({
      label: 'Detach from outlines',
      icon: Unlink,
      divide: true,
      onSelect: detachSelection,
    });
  }
  if (guides.some((g) => guideArea(g)) && !shapes.length) {
    // nothing extra: the Color items above fill it
  }
  items.push({
    label: 'Delete',
    icon: Trash2,
    keys: key('delete'),
    danger: true,
    divide: true,
    onSelect: deleteSelection,
  });
  return items;
}

function canvasMenu(at?: Pt): MenuItem[] {
  const s = ui();
  const doc = getDoc();
  const items: MenuItem[] = [];
  if (hasClipboard())
    items.push({
      label: 'Paste',
      icon: ClipboardPaste,
      keys: key('paste'),
      onSelect: pasteClipboard,
    });
  items.push({
    label: 'Select all',
    icon: SquareDashedMousePointer,
    keys: key('selectAll'),
    onSelect: selectAll,
  });
  items.push({
    label: s.showGuides ? 'Hide outlines' : 'Show outlines',
    icon: s.showGuides ? EyeOff : Eye,
    keys: key('outlines'),
    divide: true,
    onSelect: () => useUi.setState({ showGuides: !s.showGuides, selection: [] }),
  });
  if (doc.guides.some((g) => g.type === 'line' && g.cut)) {
    items.push({
      label: s.showCuts ? 'Hide cut lines' : 'Show cut lines',
      icon: Scissors,
      onSelect: () => useUi.setState({ showCuts: !s.showCuts, selection: [] }),
    });
  }
  items.push({
    label: 'Frame size',
    icon: Crop,
    divide: true,
    onSelect: () => editFrame(true),
  });
  items.push({
    label: 'Fit frame to artwork',
    icon: Scaling,
    disabled: !doc.shapes.length,
    onSelect: fitBoardToArtwork,
  });
  items.push({
    label: 'Background color',
    icon: PaintBucket,
    onSelect: () =>
      openBackground(
        at && {
          left: at.x,
          top: at.y,
          right: at.x,
          bottom: at.y,
          width: 0,
          height: 0,
        },
        'beside',
      ),
  });
  items.push({
    label: 'Zoom to fit',
    icon: Maximize,
    keys: key('fit'),
    divide: true,
    onSelect: () => fitToScreen(),
  });
  if (useDoc.getState().past.length)
    items.push({
      label: 'Undo',
      icon: Undo2,
      keys: key('undo'),
      onSelect: () => useDoc.getState().undo(),
    });
  return items;
}

function frameMenu(): MenuItem[] {
  const b = board(getDoc());
  return [
    { label: 'Square', onSelect: () => setBoardRatio(1, 1) },
    { label: 'Wide 4 : 3', onSelect: () => setBoardRatio(4, 3) },
    { label: 'Wide 16 : 9', onSelect: () => setBoardRatio(16, 9) },
    { label: 'Tall 3 : 4', onSelect: () => setBoardRatio(3, 4) },
    { label: 'Fit to artwork', divide: true, onSelect: fitBoardToArtwork },
    {
      label: `Done (${Math.round(b.w)} by ${Math.round(b.h)})`,
      divide: true,
      onSelect: () => editFrame(false),
    },
  ];
}

/** The menu for a spot on the canvas. Whatever is under the pointer gets selected first. */
export function openCanvasMenu(at: Pt, d: Pt, handle: Handle | null, hits: string[], touch = false): void {
  byTouch = touch;
  const s = ui();
  if (s.frameEdit) return open(at, frameMenu());
  const doc = getDoc();
  // Right on a crossing of two straight outlines: round it off, first thing in whatever menu opens.
  const crossing = handle ? null : crossingAt(visibleGuides(doc, s.showGuides, s.showCuts), d, (touch ? 14 : 8) / s.view.k);
  if (crossing && maxFillet(crossing) > 0) {
    const round: MenuItem = { label: 'Round this crossing', icon: SquareRoundCorner, onSelect: () => startFillet(crossing) };
    const withRound = (p: Pt, items: MenuItem[]): void => open(p, [round, ...items.map((it, i) => (i === 0 ? { ...it, divide: true } : it))]);
    return openMenuWith(withRound, at, d, handle, hits, touch);
  }
  openMenuWith(open, at, d, handle, hits, touch);
}

function openMenuWith(open: (at: Pt, items: MenuItem[]) => void, at: Pt, d: Pt, handle: Handle | null, hits: string[], touch: boolean): void {
  const s = ui();
  const doc = getDoc();
  if (handle && s.selection.length === 1) {
    const g = doc.guides.find((x) => x.id === s.selection[0]);
    if (g) {
      const items = pointMenu(g, handle, d);
      if (items.length) return open(at, items);
    }
  }
  const hit = hits.find((id) => s.selection.includes(id)) ?? hits[0];
  const tol = (touch ? 16 : 8) / s.view.k;
  if (hit) {
    if (!s.selection.includes(hit)) useUi.setState({ selection: expandToGroup(doc, hit) });
    return open(at, selectionMenu(d, tol));
  }
  if (handle && s.selection.length) return open(at, selectionMenu(d, tol));
  useUi.setState({ selection: [] });
  open(at, canvasMenu(at));
}

/** The menu for a color swatch in the dock. */
export function openSwatchMenu(at: Pt, index: number, touch = false): void {
  byTouch = touch;
  const doc = getDoc();
  const used = doc.shapes.filter((s) => s.fill === index).length;
  open(at, [
    {
      label: 'Edit color',
      swatch: doc.palette[index],
      onSelect: () => useUi.setState({ colorPanel: index }),
    },
    {
      label: 'Select all in this color',
      icon: SquareDashedMousePointer,
      disabled: used === 0,
      onSelect: () =>
        useUi.setState({
          tool: 'arrange',
          erasing: false,
          selection: getDoc()
            .shapes.filter((s) => s.fill === index)
            .map((s) => s.id),
        }),
    },
    {
      label: 'Remove color',
      icon: Trash2,
      danger: true,
      divide: true,
      disabled: doc.palette.length <= 1,
      onSelect: () => removeSwatch(index),
    },
  ]);
}
