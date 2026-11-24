import { buzz, settings } from '@/store/settings';
import { useEffect, type RefObject } from 'react';
import { polygonToPath, translate, windingOfPolygon, type BBox, type Mat, type Pt, type Ring } from '@/geom';
import { faceAt, type Arrangement } from '@/engine';
import { commit, getDoc } from '@/store/doc';
import { selectionKey, ui, useUi } from '@/store/ui';
import { board } from '@/model/doc';
import { paintFaces, visibleGuides } from '@/model/paint';
import { followSet, syncLinks } from '@/model/link';
import { insertGuidePoint, moveGuideHandle, movePathControl, rectToPoly, removeGuidePoint, togglePathNode } from '@/model/guides';
import { itemBBox, selectionBBox, transformItems, updateGuide } from '@/model/ops';
import type { Doc, Guide } from '@/model/types';
import { expandToGroup, transformSelection } from '@/actions';
import { openCanvasMenu } from '@/ui/menus';
import { useDrag } from './drag';
import { hitItems } from './hit';
import { boardFrame, boxHandleMatrix, boxHandles, placeHandles, resizeBoard, rotateMatrix, selectionFrame, singleGuide, type BoxHandle, type Frame, type Handle } from './frame';
import { snapMove, snapPoint, snapTangent, snapSticky, stickyPoint } from './snapping';
import { toDoc, toScreen, zoomAt } from './view';

/** Drawing tools (pen, brush, draw, cut) plug in here; they take over the pointer while active. */
export interface DrawTool {
  down(p: Pt, e: PointerEvent): void;
  move(p: Pt, e: PointerEvent): void;
  up(p: Pt, e: PointerEvent): void;
  cancel(): void;
  /** Mouse moving with no button pressed. */
  hover?(p: Pt): void;
}

const drawTools: Partial<Record<string, DrawTool>> = {};
export function registerDrawTool(name: string, tool: DrawTool): void {
  drawTools[name] = tool;
}

type Rect = { x: number; y: number; w: number; h: number };

type Gesture =
  | { kind: 'none' }
  | { kind: 'ignore' }
  | {
      kind: 'press';
      start: Pt;
      startDoc: Pt;
      client: Pt;
      hits: string[];
      handle: Handle | null;
      frame: Frame | null;
      touch: boolean;
      shift: boolean;
      /** Began while a color was active, on something that is not an area. */
      fromColor: boolean;
      hold?: ReturnType<typeof setTimeout>;
      /** Touch held still long enough: dragging now box-selects, letting go opens the menu. */
      held?: boolean;
    }
  | { kind: 'move'; startDoc: Pt; ids: Set<string>; box: BBox | null; mat: Mat }
  | { kind: 'box'; frame: Frame; handle: Handle; ids: Set<string>; startDoc: Pt; mat: Mat }
  | { kind: 'pt'; guide: Guide; index: number; current: Guide; part: 'pt' | 'in' | 'out' }
  | { kind: 'pan'; start: Pt; view: { x: number; y: number; k: number } }
  /** Right mouse button held: a click opens the menu, a drag does the other of pan / box-select. */
  | { kind: 'right'; start: Pt; startDoc: Pt; client: Pt }
  | { kind: 'marquee'; startDoc: Pt; additive: boolean }
  | { kind: 'lasso'; pts: Pt[]; additive: boolean }
  | { kind: 'paint'; faces: Set<number>; last: Pt }
  | { kind: 'draw'; tool: DrawTool }
  | { kind: 'board'; at: BoxHandle | 'move'; from: Rect; startDoc: Pt; now: Rect }
  | { kind: 'pinch'; dist: number; mid: Pt; view: { x: number; y: number; k: number } };

const TOUCH_SLOP = 8;
const MOUSE_SLOP = 3;
const HOLD_MS = 520;
const DOUBLE_MS = 340;

/** Shared with the faces layer: the arrangement the Color tool is painting on. */
export const arrangementRef: { current: Arrangement | null } = { current: null };

let lastTap: { p: Pt; id: string | null; t: number } = { p: { x: -99, y: -99 }, id: null, t: 0 };
let lastPoint: { id: string; index: number; t: number } = { id: '', index: -1, t: 0 };
let spaceDown = false;

const shown = (): Guide[] => {
  const s = ui();
  return visibleGuides(getDoc(), s.showGuides, s.showCuts);
};

/** While outlines are dragged, show the fills that follow them as they will end up. */
function previewLinked(doc: Doc, next: Doc, moved: ReadonlySet<string>): Record<string, Ring[] | null> | null {
  if (!doc.shapes.some((s) => s.from)) return null;
  let synced: Doc;
  try {
    synced = syncLinks(doc, next);
  } catch {
    return null;
  }
  if (synced === next) return null;
  const now = new Map(synced.shapes.map((s) => [s.id, s]));
  const out: Record<string, Ring[] | null> = {};
  let any = false;
  for (const s of next.shapes) {
    if (moved.has(s.id) || !s.from) continue;
    const t = now.get(s.id);
    if (t === s) continue;
    out[s.id] = t ? t.rings : null;
    any = true;
  }
  return any ? out : null;
}

export function useGestures(ref: RefObject<SVGSVGElement | null>): void {
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const pointers = new Map<number, Pt>();
    let g: Gesture = { kind: 'none' };
    const drag = useDrag.getState;

    const local = (e: { clientX: number; clientY: number }): Pt => {
      const r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const stopHold = (): void => {
      if (g.kind === 'press' && g.hold) clearTimeout(g.hold);
    };

    const cancel = (): void => {
      stopHold();
      if (g.kind === 'draw') g.tool.cancel();
      g = { kind: 'none' };
      drag().reset();
    };

    const findHandle = (p: Pt, touch: boolean): { handle: Handle; frame: Frame } | null => {
      const s = ui();
      if (s.tool !== 'arrange' || !s.selection.length) return null;
      const doc = getDoc();
      const frame = selectionFrame(doc, s.selection, s.selRot);
      if (!frame) return null;
      if (s.selection.length === 1 && doc.refs.find((r) => r.id === s.selection[0])?.locked) return null;
      const radius = touch ? 22 : 11;
      // Inside the frame the body should stay grabbable for moving, however small the thing is:
      // there, the resize handles only answer to a touch that is clearly on them.
      const c = toScreen(s.view, { x: frame.cx, y: frame.cy });
      const cr = Math.cos(-frame.rot);
      const sr = Math.sin(-frame.rot);
      const lx = (p.x - c.x) * cr - (p.y - c.y) * sr;
      const ly = (p.x - c.x) * sr + (p.y - c.y) * cr;
      const wPx = frame.w * s.view.k;
      const hPx = frame.h * s.view.k;
      const inside = Math.abs(lx) <= wPx / 2 && Math.abs(ly) <= hPx / 2;
      const boxRadius = inside ? Math.min(radius, Math.max(6, Math.min(wPx, hPx) * 0.26)) : radius;
      let best: Handle | null = null;
      let bestD = radius;
      // On a polygon, stretching wins over moving a single point where the two meet.
      const stretchy = s.selection.length === 1 && doc.guides.find((x) => x.id === s.selection[0])?.type === 'poly';
      for (const h of placeHandles(doc, s.selection, frame, s.view.k, s.moveOnly === selectionKey(s.selection), s.selectMode === 'points')) {
        const sp = toScreen(s.view, h.p);
        // Otherwise point handles win ties against the box handles they may sit on.
        const bias = h.handle.kind === 'pt' ? -4 : h.handle.kind === 'mid' ? 2 : h.handle.kind === 'box' && stretchy ? -6 : 0;
        const d = Math.hypot(sp.x - p.x, sp.y - p.y) + bias;
        if (h.handle.kind === 'box' && d > boxRadius) continue;
        if (d <= bestD) {
          bestD = d;
          best = h.handle;
        }
      }
      return best ? { handle: best, frame } : null;
    };

    /** A handle of the export frame under the pointer, while the frame is being adjusted. */
    const findBoardHandle = (p: Pt, touch: boolean): BoxHandle | null => {
      const s = ui();
      const radius = touch ? 22 : 12;
      let best: BoxHandle | null = null;
      let bestD = radius;
      for (const h of boxHandles(boardFrame(getDoc()))) {
        const sp = toScreen(s.view, h.p);
        const d = Math.hypot(sp.x - p.x, sp.y - p.y);
        if (d <= bestD && h.handle.kind === 'box') {
          bestD = d;
          best = h.handle.at;
        }
      }
      return best;
    };

    const paintAt = (faces: Set<number>, d: Pt): boolean => {
      const arr = arrangementRef.current;
      if (!arr) return false;
      const f = faceAt(arr, d);
      if (f < 0 || faces.has(f)) return false;
      faces.add(f);
      return true;
    };

    const openMenu = (client: Pt, p: Pt, touch: boolean): void => {
      const s = ui();
      const d = toDoc(s.view, p);
      const h = s.frameEdit ? null : findHandle(p, touch);
      const hits = h ? [] : hitItems(getDoc(), d, (touch ? 16 : 7) / s.view.k, shown());
      openCanvasMenu(client, d, h?.handle ?? null, hits, touch);
    };

    const onDown = (e: PointerEvent): void => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (ui().menu) useUi.setState({ menu: null });
      if (ui().colorPanel !== null) useUi.setState({ colorPanel: null });
      svg.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      const s = ui();

      if (e.pointerType === 'mouse' && e.button === 2) {
        // Decided on the way: let go without moving for the menu, drag for the other of pan / box-select.
        cancel();
        g = { kind: 'right', start: p, startDoc: toDoc(s.view, p), client: { x: e.clientX, y: e.clientY } };
        return;
      }

      if (pointers.size === 2) {
        // A second finger always means pan/zoom; whatever one finger started is undone.
        cancel();
        const [a, b] = [...pointers.values()] as [Pt, Pt];
        g = {
          kind: 'pinch',
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          view: s.view,
        };
        return;
      }
      if (pointers.size > 2) return;

      const d = toDoc(s.view, p);
      const touch = e.pointerType === 'touch';

      if (e.button === 1 || spaceDown) {
        g = { kind: 'pan', start: p, view: s.view };
        return;
      }

      if (s.frameEdit) {
        const b = board(getDoc());
        const at = findBoardHandle(p, touch);
        const inside = d.x >= b.x && d.x <= b.x + b.w && d.y >= b.y && d.y <= b.y + b.h;
        if (at || inside) g = { kind: 'board', at: at ?? 'move', from: b, startDoc: d, now: b };
        else g = { kind: 'pan', start: p, view: s.view };
        return;
      }

      const custom = drawTools[s.tool];
      if (custom) {
        g = { kind: 'draw', tool: custom };
        custom.down(d, e);
        return;
      }

      let fromColor = false;
      if (s.tool === 'color') {
        const faces = new Set<number>();
        if (paintAt(faces, d)) {
          g = { kind: 'paint', faces, last: d };
          drag().set({ paint: [...faces], hover: -1, loupe: touch ? p : null });
          return;
        }
        // Not an area: this touch behaves as if no color were active (select an outline, pan, or tap away to finish).
        fromColor = true;
      }

      const h = fromColor ? null : findHandle(p, touch);
      const tol = (touch ? 16 : 7) / s.view.k;
      const press: Extract<Gesture, { kind: 'press' }> = {
        kind: 'press',
        start: p,
        startDoc: d,
        client: { x: e.clientX, y: e.clientY },
        hits: h ? [] : hitItems(getDoc(), d, tol, shown()),
        handle: h?.handle ?? null,
        frame: h?.frame ?? null,
        touch,
        shift: e.shiftKey || s.multi,
        fromColor,
      };
      if (touch) {
        // Press and hold: letting go opens the same menu a right-click gives; dragging on box-selects.
        press.hold = setTimeout(() => {
          if (g !== press) return;
          press.held = true;
          buzz();
          drag().set({ hold: press.start }); // a ring under the finger: let go for the menu, or drag to box-select
        }, HOLD_MS);
      }
      g = press;
    };

    const beginDrag = (press: Extract<Gesture, { kind: 'press' }>): void => {
      stopHold();
      const s = ui();
      const doc = getDoc();
      if (press.held) {
        drag().set({ hold: null });
        if (press.fromColor) useUi.setState({ tool: 'arrange', erasing: false });
        g = { kind: 'marquee', startDoc: press.startDoc, additive: false };
        return;
      }
      if (!press.handle && !press.fromColor && s.selectMode !== 'move' && s.selectMode !== 'points' && s.selectMode !== 'single') {
        // A chosen select mode decides what every drag does.
        if (s.selectMode === 'pan') g = { kind: 'pan', start: press.start, view: s.view };
        else if (s.selectMode === 'box') g = { kind: 'marquee', startDoc: press.startDoc, additive: press.shift };
        else g = { kind: 'lasso', pts: [press.startDoc], additive: press.shift };
        return;
      }
      if (press.handle && press.frame) {
        const h = press.handle;
        if (h.kind === 'hin' || h.kind === 'hout') {
          const guide = singleGuide(doc, s.selection);
          if (!guide) return void (g = { kind: 'ignore' });
          g = { kind: 'pt', guide, index: h.index, current: guide, part: h.kind === 'hin' ? 'in' : 'out' };
          return;
        }
        if (h.kind === 'pt' || h.kind === 'mid') {
          let guide = singleGuide(doc, s.selection);
          if (!guide) return void (g = { kind: 'ignore' });
          let index = h.index;
          // A square's corner, moved on its own: from now on it is four free points.
          if (guide.type === 'rect') guide = rectToPoly(guide);
          if (h.kind === 'mid') {
            // Dragging one of the small dots between points adds a point there and keeps dragging it.
            guide = insertGuidePoint(guide, index, press.startDoc);
            index += 1;
          }
          g = { kind: 'pt', guide, index, current: guide, part: 'pt' };
          return;
        }
        g = { kind: 'box', frame: press.frame, handle: h, ids: followSet(doc, s.selection), startDoc: press.startDoc, mat: translate(0, 0) };
        return;
      }
      // Dragging from anywhere inside the current selection moves that selection,
      // even when something else happens to lie on top at that spot.
      let hit = press.hits.find((id) => s.selection.includes(id)) ?? press.hits[0];
      if (!press.fromColor && s.selection.length && !press.hits.some((id) => s.selection.includes(id))) {
        const f = selectionFrame(doc, s.selection, s.selRot);
        const locked = s.selection.length === 1 && doc.refs.find((r) => r.id === s.selection[0])?.locked;
        if (!locked && f) {
          const c = Math.cos(-f.rot);
          const sn = Math.sin(-f.rot);
          const lx = (press.startDoc.x - f.cx) * c - (press.startDoc.y - f.cy) * sn;
          const ly = (press.startDoc.x - f.cx) * sn + (press.startDoc.y - f.cy) * c;
          // "Move": a small thing can be grabbed a little way outside its box too.
          const pad = s.moveOnly === selectionKey(s.selection) ? (press.touch ? 24 : 14) / s.view.k : 0;
          if (Math.abs(lx) <= f.w / 2 + pad && Math.abs(ly) <= f.h / 2 + pad) hit = s.selection[0];
        }
      }
      const single = s.selectMode === 'single' && !press.fromColor;
      if (hit && (!press.shift || single)) {
        let ids = s.selection;
        if (press.fromColor) useUi.setState({ tool: 'arrange', erasing: false });
        if (!ids.includes(hit)) {
          // One at a time: dragging a new piece adds it, and the whole selection moves.
          ids = single ? [...ids, hit] : expandToGroup(doc, hit);
          useUi.setState({ selection: ids });
        }
        // A locked photo shows its controls when selected but never moves.
        const movable = ids.filter((id) => !doc.refs.find((r) => r.id === id)?.locked);
        if (!movable.length) return void (g = { kind: 'pan', start: press.start, view: s.view });
        g = { kind: 'move', startDoc: press.startDoc, ids: followSet(doc, movable), box: selectionBBox(doc, movable), mat: translate(0, 0) };
        return;
      }
      // Empty canvas. A finger pans. A mouse does what Settings says: pan (the right button
      // then box-selects) or box-select (the right button then pans). Shift-drag always box-selects.
      if (press.touch) g = { kind: 'pan', start: press.start, view: s.view };
      else if (press.shift) g = { kind: 'marquee', startDoc: press.startDoc, additive: true };
      else if (settings().dragEmpty === 'select') {
        if (press.fromColor) useUi.setState({ tool: 'arrange', erasing: false });
        g = { kind: 'marquee', startDoc: press.startDoc, additive: false };
      } else g = { kind: 'pan', start: press.start, view: s.view };
    };

    const onMove = (e: PointerEvent): void => {
      const p = local(e);
      const s = ui();

      if (!pointers.has(e.pointerId)) {
        // Hovering mouse.
        if (e.pointerType !== 'mouse') return;
        const d = toDoc(s.view, p);
        if (s.frameEdit) {
          const at = findBoardHandle(p, false);
          svg.style.cursor = !at ? 'move' : at === 'n' || at === 's' ? 'ns-resize' : at === 'e' || at === 'w' ? 'ew-resize' : at === 'nw' || at === 'se' ? 'nwse-resize' : 'nesw-resize';
          return;
        }
        const custom = drawTools[s.tool];
        if (custom) {
          custom.hover?.(d);
          svg.style.cursor = 'crosshair';
          return;
        }
        if (s.tool === 'color') {
          const arr = arrangementRef.current;
          const f = arr ? faceAt(arr, d) : -1;
          if (f !== drag().hover) drag().set({ hover: f });
          svg.style.cursor = f >= 0 ? 'pointer' : 'default';
          return;
        }
        const h = findHandle(p, false);
        if (h) {
          svg.style.cursor = h.handle.kind === 'rot' ? 'grab' : 'pointer';
          if (h.handle.kind === 'box') {
            const at = h.handle.at;
            const rotated = Math.abs(h.frame.rot % (Math.PI / 2)) > 0.01;
            svg.style.cursor = rotated ? 'move' : at === 'n' || at === 's' ? 'ns-resize' : at === 'e' || at === 'w' ? 'ew-resize' : at === 'nw' || at === 'se' ? 'nwse-resize' : 'nesw-resize';
          }
          return;
        }
        const hits = hitItems(getDoc(), d, 7 / s.view.k, shown());
        svg.style.cursor = spaceDown ? 'grab' : hits.length ? 'move' : 'default';
        return;
      }

      pointers.set(e.pointerId, p);

      if (g.kind === 'pinch') {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()] as [Pt, Pt];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const zoomed = zoomAt(g.view, g.mid, dist / g.dist);
        useUi.setState({ view: { k: zoomed.k, x: zoomed.x + (mid.x - g.mid.x), y: zoomed.y + (mid.y - g.mid.y) } });
        return;
      }

      if (g.kind === 'press') {
        const slop = g.touch ? TOUCH_SLOP : MOUSE_SLOP;
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < slop) return;
        beginDrag(g);
      }
      if (g.kind === 'right') {
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < MOUSE_SLOP + 2) return;
        // Box-selecting only makes sense while arranging; with a tool in hand the right button just pans.
        const select = settings().dragEmpty === 'pan' && s.tool === 'arrange' && !s.frameEdit;
        g = select ? { kind: 'marquee', startDoc: g.startDoc, additive: e.shiftKey } : { kind: 'pan', start: g.start, view: s.view };
      }

      const d = toDoc(s.view, p);
      const doc = getDoc();

      switch (g.kind) {
        case 'draw':
          g.tool.move(d, e);
          break;
        case 'pan':
          svg.style.cursor = 'grabbing';
          useUi.setState({ view: { k: g.view.k, x: g.view.x + (p.x - g.start.x), y: g.view.y + (p.y - g.start.y) } });
          break;
        case 'board': {
          let now: Rect;
          if (g.at === 'move') {
            now = { ...g.from, x: g.from.x + (d.x - g.startDoc.x), y: g.from.y + (d.y - g.startDoc.y) };
          } else {
            now = resizeBoard(g.from, g.at, d, e.shiftKey);
          }
          // whole units keep exported sizes clean
          now = { x: Math.round(now.x), y: Math.round(now.y), w: Math.max(16, Math.round(now.w)), h: Math.max(16, Math.round(now.h)) };
          g.now = now;
          drag().set({ board: now });
          break;
        }
        case 'move': {
          let dx = d.x - g.startDoc.x;
          let dy = d.y - g.startDoc.y;
          if (e.shiftKey && !ui().multi) {
            if (Math.abs(dx) > Math.abs(dy)) dy = 0;
            else dx = 0;
          }
          let lines: { a: Pt; b: Pt }[] = [];
          // Sticky points first: a corner or point that comes near another pulls the move onto it.
          const stuck = s.stickyPoints && !e.altKey ? snapSticky(doc, g.ids, dx, dy, 12 / s.view.k) : null;
          if (stuck) {
            dx = stuck.dx;
            dy = stuck.dy;
            lines = stuck.lines;
          } else if (g.box && !e.altKey && s.snap) {
            // A lone circle first tries to sit exactly against its neighbours.
            const only = g.ids.size === 1 ? [...g.ids][0]! : null;
            const tan = only ? snapTangent(doc, only, dx, dy, 5 / s.view.k) : null;
            const sn = tan ?? snapMove(doc, g.ids, g.box, dx, dy, 6 / s.view.k, s.grid);
            dx = sn.dx;
            dy = sn.dy;
            lines = sn.lines;
          }
          g.mat = translate(dx, dy);
          drag().set({ ids: g.ids, mat: g.mat, snapLines: lines, shapeRings: previewLinked(doc, transformItems(doc, g.ids, g.mat), g.ids) });
          break;
        }
        case 'box': {
          const h = g.handle;
          // Sticky points: the corner or side being dragged sticks to nearby corners, points and edges.
          const to = h.kind === 'box' && s.stickyPoints && !e.altKey ? (stickyPoint(doc, g.ids, d, 12 / s.view.k) ?? d) : d;
          g.mat = h.kind === 'rot' ? rotateMatrix(g.frame, g.startDoc, d, e.altKey) : h.kind === 'box' ? boxHandleMatrix(g.frame, h.at, to) : g.mat;
          drag().set({ ids: g.ids, mat: g.mat, shapeRings: previewLinked(doc, transformItems(doc, g.ids, g.mat), g.ids) });
          break;
        }
        case 'pt': {
          if (g.part !== 'pt') {
            if (g.guide.type === 'path') g.current = movePathControl(g.guide, g.index, g.part, d, e.altKey);
            drag().set({ guide: g.current, shapeRings: previewLinked(doc, updateGuide(doc, g.guide.id, g.current), NONE) });
            break;
          }
          let anchor: Pt | undefined;
          if (g.guide.type === 'line') {
            anchor = g.index === 0 ? { x: g.guide.x1, y: g.guide.y1 } : { x: g.guide.x0, y: g.guide.y0 };
          }
          const sticky = s.stickyPoints && !e.altKey ? stickyPoint(doc, new Set([g.guide.id]), d, 12 / s.view.k) : null;
          const sn = sticky ? { p: sticky, lines: [] } : e.altKey || !s.snap ? { p: d, lines: [] } : snapPoint(doc, g.guide.id, d, 7 / s.view.k, anchor, s.grid);
          g.current = moveGuideHandle(g.guide, g.index, sn.p);
          drag().set({ guide: g.current, snapLines: sn.lines, shapeRings: previewLinked(doc, updateGuide(doc, g.guide.id, g.current), NONE) });
          break;
        }
        case 'marquee': {
          const x = Math.min(g.startDoc.x, d.x);
          const y = Math.min(g.startDoc.y, d.y);
          drag().set({ marquee: { x, y, w: Math.abs(d.x - g.startDoc.x), h: Math.abs(d.y - g.startDoc.y) } });
          break;
        }
        case 'lasso': {
          const last = g.pts[g.pts.length - 1]!;
          if (Math.hypot(d.x - last.x, d.y - last.y) > 3 / s.view.k) g.pts.push(d);
          drag().set({ draft: polygonToPath(g.pts), draftWidth: 0, draftDashed: true });
          break;
        }
        case 'paint': {
          // Sample along the stroke so a fast swipe does not skip thin areas.
          const dist = Math.hypot(d.x - g.last.x, d.y - g.last.y);
          const step = 3 / s.view.k;
          const n = Math.min(400, Math.max(1, Math.ceil(dist / step)));
          let changed = false;
          for (let i = 1; i <= n; i++) {
            const q = { x: g.last.x + ((d.x - g.last.x) * i) / n, y: g.last.y + ((d.y - g.last.y) * i) / n };
            if (paintAt(g.faces, q)) changed = true;
          }
          g.last = d;
          const patch: Parameters<ReturnType<typeof drag>['set']>[0] = {};
          if (changed) patch.paint = [...g.faces];
          if (e.pointerType === 'touch') patch.loupe = p;
          drag().set(patch);
          break;
        }
        default:
          break;
      }
    };

    const tap = (press: Extract<Gesture, { kind: 'press' }>): void => {
      const s = ui();
      const doc = getDoc();
      const now = performance.now();
      if (press.handle) {
        const h = press.handle;
        if (h.kind !== 'pt') return;
        const guide = singleGuide(doc, s.selection);
        const again = guide && lastPoint.id === guide.id && lastPoint.index === h.index && now - lastPoint.t < 380;
        lastPoint = { id: guide?.id ?? '', index: h.index, t: now };
        if (!again || !guide) return;
        lastPoint.t = 0;
        // Double tap on a point: pen paths switch corner/smooth, other outlines drop the point.
        const next = guide.type === 'path' && !press.shift ? togglePathNode(guide, h.index) : removeGuidePoint(guide, h.index);
        if (next) commit(updateGuide(doc, guide.id, next));
        return;
      }
      const hits = press.hits;
      if (press.fromColor) useUi.setState({ tool: 'arrange', erasing: false }); // tapping away from the areas puts the color down
      // One at a time: every tap adds a piece or takes it away again, as Shift-click does.
      const single = s.selectMode === 'single' && !press.fromColor;
      if (!hits.length) {
        if (!press.shift && !single) useUi.setState({ selection: [] });
        lastTap = { p: press.start, id: null, t: now };
        return;
      }
      if (single) {
        const top = hits[0]!;
        useUi.setState({ selection: s.selection.includes(top) ? s.selection.filter((id) => id !== top) : [...s.selection, top] });
        lastTap = { p: press.start, id: top, t: now };
        return;
      }
      // Tapping the same spot again steps to the next thing underneath.
      const near = Math.hypot(press.start.x - lastTap.p.x, press.start.y - lastTap.p.y) < 10;
      const again = near && now - lastTap.t < 4000;
      let pick = hits[0]!;
      if (again && lastTap.id) {
        const top = hits[0]!;
        const group = expandToGroup(doc, top);
        // A quick second tap on a word opens it for retyping.
        const word = doc.shapes.find((x) => x.id === top)?.group;
        if (now - lastTap.t < DOUBLE_MS && word && doc.groups[word]?.text?.pristine) {
          useUi.setState({ selection: group, sheet: 'text', textTarget: word });
          lastTap = { p: press.start, id: null, t: 0 };
          return;
        }
        const whole = group.length > 1 && group.every((id) => s.selection.includes(id)) && s.selection.length === group.length;
        if (whole && lastTap.id === top) {
          // Second tap on a group: just that member.
          useUi.setState({ selection: [top] });
          lastTap = { p: press.start, id: `${top}#one`, t: now };
          return;
        }
        const i = hits.indexOf(lastTap.id.replace('#one', ''));
        if (i >= 0 && hits.length > 1) pick = hits[(i + 1) % hits.length]!;
      }
      const ids = s.selectMode === 'single' ? [pick] : expandToGroup(doc, pick);
      if (press.shift) {
        const has = ids.every((id) => s.selection.includes(id));
        useUi.setState({ selection: has ? s.selection.filter((id) => !ids.includes(id)) : [...new Set([...s.selection, ...ids])] });
      } else {
        useUi.setState({ selection: ids });
      }
      lastTap = { p: press.start, id: pick, t: now };
    };

    const transformSelectionOf = (ids: Set<string>, m: Mat): void => {
      if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0) return;
      // The dragged set is the selection, seen through followSet: commit it as the selection so Repeat keeps tracking.
      const want = followSet(
        getDoc(),
        ui().selection.filter((id) => !getDoc().refs.find((r) => r.id === id)?.locked),
      );
      if (want.size === ids.size && [...want].every((id) => ids.has(id))) transformSelection(m);
      else commit(transformItems(getDoc(), ids, m));
    };

    const onUp = (e: PointerEvent): void => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.delete(e.pointerId);
      try {
        svg.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      const s = ui();
      const d = toDoc(s.view, p);

      if (g.kind === 'pinch') {
        // Wait for every finger to lift before listening again.
        g = pointers.size ? { kind: 'ignore' } : { kind: 'none' };
        return;
      }
      if (g.kind === 'ignore') {
        if (!pointers.size) g = { kind: 'none' };
        return;
      }
      stopHold();
      const cur = g;
      g = { kind: 'none' };
      const doc = getDoc();

      if (cur.kind === 'right') {
        // The right button went down and up in one place: the menu for whatever is there.
        if (drawTools[s.tool]) return;
        if (s.tool === 'color') useUi.setState({ tool: 'arrange', erasing: false });
        openMenu(cur.client, cur.start, false);
        return;
      }

      switch (cur.kind) {
        case 'press':
          if (s.frameEdit) break;
          if (cur.held) {
            drag().set({ hold: null });
            if (cur.fromColor) useUi.setState({ tool: 'arrange', erasing: false });
            openMenu(cur.client, cur.start, true);
          } else tap(cur);
          break;
        case 'lasso': {
          drag().reset();
          if (cur.pts.length > 2) {
            const ids: string[] = cur.additive ? [...s.selection] : [];
            for (const it of [...shown(), ...doc.shapes]) {
              if (it.hidden || it.locked || ids.includes(it.id)) continue;
              const b = itemBBox(doc, it.id);
              if (b && windingOfPolygon({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, cur.pts) !== 0) ids.push(it.id);
            }
            useUi.setState({ selection: ids });
          }
          break;
        }
        case 'draw':
          cur.tool.up(d, e);
          break;
        case 'pan':
          svg.style.cursor = 'default';
          break;
        case 'board': {
          drag().reset();
          const b = cur.now;
          if (b !== cur.from) commit({ ...doc, artboard: { x: b.x, y: b.y, w: b.w, h: b.h }, updatedAt: Date.now() });
          break;
        }
        case 'move':
          drag().reset();
          transformSelectionOf(cur.ids, cur.mat);
          break;
        case 'box': {
          drag().reset();
          transformSelectionOf(cur.ids, cur.mat);
          if (cur.handle.kind === 'rot') {
            // The box stays at the angle it was turned to.
            const turn = Math.atan2(cur.mat[1], cur.mat[0]);
            useUi.setState({ selRot: { key: selectionKey(ui().selection), rot: cur.frame.rot + turn } });
          }
          break;
        }
        case 'pt':
          drag().reset();
          if (cur.current !== cur.guide || cur.guide !== doc.guides.find((x) => x.id === cur.guide.id)) {
            commit(updateGuide(doc, cur.guide.id, cur.current));
          }
          break;
        case 'marquee': {
          const m = drag().marquee;
          drag().reset();
          if (m && (m.w > 0 || m.h > 0)) {
            const ids: string[] = cur.additive ? [...s.selection] : [];
            const all = [...shown(), ...doc.shapes];
            for (const it of all) {
              if (it.hidden || it.locked) continue;
              const b = itemBBox(doc, it.id);
              if (!b) continue;
              if (b.x + b.w >= m.x && b.x <= m.x + m.w && b.y + b.h >= m.y && b.y <= m.y + m.h && !ids.includes(it.id)) ids.push(it.id);
            }
            useUi.setState({ selection: ids });
          }
          break;
        }
        case 'paint': {
          const faces = cur.faces;
          drag().reset();
          const arr = arrangementRef.current;
          if (arr && faces.size) {
            const next = paintFaces(doc, arr, faces, s.erasing ? null : s.ink, shown());
            // A short tick where the device has one, on the same frame as the color landing.
            if (next !== doc && e.pointerType === 'touch') buzz(8);
            commit(next);
          }
          break;
        }
        default:
          drag().reset();
      }
    };

    const onCancel = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      cancel();
      if (pointers.size) g = { kind: 'ignore' };
    };

    const onLeave = (): void => {
      if (drag().hover !== -1) drag().set({ hover: -1 });
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const s = ui();
      const p = local(e);
      // Pinch on a trackpad arrives as ctrl+wheel; a real mouse wheel sends big whole-number steps.
      const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        const factor = Math.exp(-delta * (e.ctrlKey && !mouseWheel ? 0.01 : 0.0015));
        useUi.setState({ view: zoomAt(s.view, p, factor) });
      } else {
        useUi.setState({ view: { k: s.view.k, x: s.view.x - e.deltaX, y: s.view.y - e.deltaY } });
      }
    };

    const onContext = (e: MouseEvent): void => {
      e.preventDefault();
      // The right mouse button is followed from press to release above (some systems fire this
      // event on the press, some on the release), and a held finger opens its own menu.
      if (e.button === 2 || (e as PointerEvent).pointerType === 'touch') return;
      // What is left: the keyboard's menu key, or Ctrl-click on a Mac.
      const s = ui();
      if (drawTools[s.tool]) return;
      if (s.tool === 'color') useUi.setState({ tool: 'arrange', erasing: false });
      openMenu({ x: e.clientX, y: e.clientY }, local(e), false);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        spaceDown = true;
        if (!pointers.size) svg.style.cursor = 'grab';
        e.preventDefault();
      }
      if (e.key === 'Escape' && g.kind !== 'none') cancel();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceDown = false;
        svg.style.cursor = 'default';
      }
    };
    const stopGesture = (e: Event): void => e.preventDefault();

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onCancel);
    svg.addEventListener('pointerleave', onLeave);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('gesturestart', stopGesture);
    svg.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onCancel);
      svg.removeEventListener('pointerleave', onLeave);
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('gesturestart', stopGesture);
      svg.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [ref]);
}

const NONE: ReadonlySet<string> = new Set();

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}
