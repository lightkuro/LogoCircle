import { useEffect, type RefObject } from 'react';
import { translate, type BBox, type Mat, type Pt } from '@/geom';
import { faceAt, type Arrangement } from '@/engine';
import { commit, getDoc } from '@/store/doc';
import { ui, useUi } from '@/store/ui';
import { paintFaces } from '@/model/paint';
import { moveGuideHandle, movePathControl, removeGuidePoint, togglePathNode } from '@/model/guides';
import { itemBBox, selectionBBox, transformItems, updateGuide } from '@/model/ops';
import type { Guide } from '@/model/types';
import { expandToGroup, transformSelection } from '@/actions';
import { useDrag } from './drag';
import { hitItems } from './hit';
import { boxHandleMatrix, placeHandles, rotateMatrix, selectionFrame, singleGuide, type Frame, type Handle } from './frame';
import { snapMove, snapPoint, snapTangent } from './snapping';
import { toDoc, toScreen, zoomAt } from './view';

/** Custom drawing tools (pen, brush) plug in here; they take over the pointer while active. */
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

type Gesture =
  | { kind: 'none' }
  | { kind: 'ignore' }
  | {
      kind: 'press';
      start: Pt;
      startDoc: Pt;
      hits: string[];
      handle: Handle | null;
      frame: Frame | null;
      touch: boolean;
      shift: boolean;
    }
  | { kind: 'move'; startDoc: Pt; ids: Set<string>; box: BBox | null; mat: Mat }
  | { kind: 'box'; frame: Frame; handle: Handle; ids: Set<string>; startDoc: Pt; mat: Mat }
  | { kind: 'pt'; guide: Guide; index: number; current: Guide; part: 'pt' | 'in' | 'out' }
  | { kind: 'pan'; start: Pt; view: { x: number; y: number; k: number } }
  | { kind: 'marquee'; startDoc: Pt; additive: boolean }
  | { kind: 'paint'; faces: Set<number>; last: Pt }
  | { kind: 'draw'; tool: DrawTool }
  | { kind: 'pinch'; dist: number; mid: Pt; view: { x: number; y: number; k: number } };

const TOUCH_SLOP = 8;
const MOUSE_SLOP = 3;

/** Shared with the faces layer: the arrangement the Color tool is painting on. */
export const arrangementRef: { current: Arrangement | null } = { current: null };

let lastTap: { p: Pt; id: string | null; t: number } = { p: { x: -99, y: -99 }, id: null, t: 0 };
let lastPoint: { id: string; index: number; t: number } = { id: '', index: -1, t: 0 };
let spaceDown = false;

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

    const cancel = (): void => {
      if (g.kind === 'draw') g.tool.cancel();
      g = { kind: 'none' };
      drag().reset();
    };

    const findHandle = (p: Pt, touch: boolean): { handle: Handle; frame: Frame } | null => {
      const s = ui();
      if (s.tool !== 'arrange' || !s.selection.length) return null;
      const doc = getDoc();
      const frame = selectionFrame(doc, s.selection);
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
      for (const h of placeHandles(doc, s.selection, frame, s.view.k)) {
        const sp = toScreen(s.view, h.p);
        // Point handles win ties against the box handles they may sit on.
        const bias = h.handle.kind === 'pt' ? -4 : h.handle.kind === 'mid' ? 2 : 0;
        const d = Math.hypot(sp.x - p.x, sp.y - p.y) + bias;
        if (h.handle.kind === 'box' && d > boxRadius) continue;
        if (d <= bestD) {
          bestD = d;
          best = h.handle;
        }
      }
      return best ? { handle: best, frame } : null;
    };

    const paintAt = (faces: Set<number>, d: Pt): boolean => {
      const arr = arrangementRef.current;
      if (!arr) return false;
      const f = faceAt(arr, d);
      if (f < 0 || faces.has(f)) return false;
      faces.add(f);
      return true;
    };

    const onDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' && e.button === 2) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      svg.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      const s = ui();

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

      const custom = drawTools[s.tool];
      if (custom) {
        g = { kind: 'draw', tool: custom };
        custom.down(d, e);
        return;
      }

      if (s.tool === 'color') {
        const faces = new Set<number>();
        paintAt(faces, d);
        g = { kind: 'paint', faces, last: d };
        drag().set({ paint: [...faces], hover: -1, loupe: touch ? p : null });
        return;
      }

      const h = findHandle(p, touch);
      const tol = (touch ? 16 : 7) / s.view.k;
      g = {
        kind: 'press',
        start: p,
        startDoc: d,
        hits: h ? [] : hitItems(getDoc(), d, tol, s.showGuides),
        handle: h?.handle ?? null,
        frame: h?.frame ?? null,
        touch,
        shift: e.shiftKey || s.multi,
      };
    };

    const beginDrag = (press: Extract<Gesture, { kind: 'press' }>, p: Pt): void => {
      const s = ui();
      const doc = getDoc();
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
          if (h.kind === 'mid' && (guide.type === 'curve' || guide.type === 'poly')) {
            // Dragging a "+" adds a point there and keeps dragging it.
            const pts = guide.pts.slice();
            pts.splice(index + 1, 0, { ...press.startDoc });
            guide = { ...guide, pts };
            index += 1;
          }
          g = { kind: 'pt', guide, index, current: guide, part: 'pt' };
          return;
        }
        g = { kind: 'box', frame: press.frame, handle: h, ids: new Set(s.selection), startDoc: press.startDoc, mat: translate(0, 0) };
        return;
      }
      // Dragging from anywhere inside the current selection moves that selection,
      // even when something else happens to lie on top at that spot.
      let hit = press.hits.find((id) => s.selection.includes(id)) ?? press.hits[0];
      if (s.selection.length && !press.hits.some((id) => s.selection.includes(id))) {
        const box = selectionBBox(doc, s.selection);
        const d0 = press.startDoc;
        const locked = s.selection.length === 1 && doc.refs.find((r) => r.id === s.selection[0])?.locked;
        if (!locked && box && d0.x >= box.x && d0.x <= box.x + box.w && d0.y >= box.y && d0.y <= box.y + box.h) hit = s.selection[0];
      }
      if (hit) {
        let ids = s.selection;
        if (!ids.includes(hit)) {
          ids = press.shift ? [...ids, ...expandToGroup(doc, hit)] : expandToGroup(doc, hit);
          useUi.setState({ selection: ids });
        }
        // A locked photo shows its controls when selected but never moves.
        const movable = ids.filter((id) => !doc.refs.find((r) => r.id === id)?.locked);
        if (!movable.length) return void (g = press.touch ? { kind: 'pan', start: press.start, view: s.view } : { kind: 'ignore' });
        g = { kind: 'move', startDoc: press.startDoc, ids: new Set(movable), box: selectionBBox(doc, movable), mat: translate(0, 0) };
        return;
      }
      if (press.touch) {
        g = { kind: 'pan', start: p, view: s.view };
        // start panning from where the finger first landed, not where the slop was crossed
        (g as Extract<Gesture, { kind: 'pan' }>).start = press.start;
        return;
      }
      g = { kind: 'marquee', startDoc: press.startDoc, additive: press.shift };
    };

    const onMove = (e: PointerEvent): void => {
      const p = local(e);
      const s = ui();

      if (!pointers.has(e.pointerId)) {
        // Hovering mouse.
        if (e.pointerType !== 'mouse') return;
        const d = toDoc(s.view, p);
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
          svg.style.cursor = h.handle.kind === 'rot' ? 'grab' : h.handle.kind === 'box' ? 'nwse-resize' : 'pointer';
          if (h.handle.kind === 'box') {
            const at = h.handle.at;
            const rotated = Math.abs(h.frame.rot) > 0.01;
            svg.style.cursor = rotated
              ? 'move'
              : at === 'n' || at === 's'
                ? 'ns-resize'
                : at === 'e' || at === 'w'
                  ? 'ew-resize'
                  : at === 'nw' || at === 'se'
                    ? 'nwse-resize'
                    : 'nesw-resize';
          }
          return;
        }
        const hits = hitItems(getDoc(), d, 7 / s.view.k, s.showGuides);
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
        beginDrag(g, p);
      }

      const d = toDoc(s.view, p);
      const doc = getDoc();

      switch (g.kind) {
        case 'draw':
          g.tool.move(d, e);
          break;
        case 'pan':
          useUi.setState({ view: { k: g.view.k, x: g.view.x + (p.x - g.start.x), y: g.view.y + (p.y - g.start.y) } });
          break;
        case 'move': {
          let dx = d.x - g.startDoc.x;
          let dy = d.y - g.startDoc.y;
          if (e.shiftKey && !ui().multi) {
            if (Math.abs(dx) > Math.abs(dy)) dy = 0;
            else dx = 0;
          }
          let lines: { a: Pt; b: Pt }[] = [];
          if (g.box && !e.altKey && s.snap) {
            // A lone circle first tries to sit exactly against its neighbours.
            const only = g.ids.size === 1 ? [...g.ids][0]! : null;
            const tan = only ? snapTangent(doc, only, dx, dy, 5 / s.view.k) : null;
            const sn = tan ?? snapMove(doc, g.ids, g.box, dx, dy, 6 / s.view.k, s.grid);
            dx = sn.dx;
            dy = sn.dy;
            lines = sn.lines;
          }
          g.mat = translate(dx, dy);
          drag().set({ ids: g.ids, mat: g.mat, snapLines: lines });
          break;
        }
        case 'box': {
          const h = g.handle;
          g.mat = h.kind === 'rot' ? rotateMatrix(g.frame, g.startDoc, d, e.altKey) : h.kind === 'box' ? boxHandleMatrix(g.frame, h.at, d) : g.mat;
          drag().set({ ids: g.ids, mat: g.mat });
          break;
        }
        case 'pt': {
          if (g.part !== 'pt') {
            if (g.guide.type === 'path') g.current = movePathControl(g.guide, g.index, g.part, d, e.altKey);
            drag().set({ guide: g.current });
            break;
          }
          let anchor: Pt | undefined;
          if (g.guide.type === 'line') {
            anchor = g.index === 0 ? { x: g.guide.x1, y: g.guide.y1 } : { x: g.guide.x0, y: g.guide.y0 };
          }
          const sn = e.altKey || !s.snap ? { p: d, lines: [] } : snapPoint(doc, g.guide.id, d, 7 / s.view.k, anchor, s.grid);
          g.current = moveGuideHandle(g.guide, g.index, sn.p);
          drag().set({ guide: g.current, snapLines: sn.lines });
          break;
        }
        case 'marquee': {
          const x = Math.min(g.startDoc.x, d.x);
          const y = Math.min(g.startDoc.y, d.y);
          drag().set({ marquee: { x, y, w: Math.abs(d.x - g.startDoc.x), h: Math.abs(d.y - g.startDoc.y) } });
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
      if (press.handle) {
        const h = press.handle;
        if (h.kind !== 'pt') return;
        const now = performance.now();
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
      if (!hits.length) {
        if (!press.shift) useUi.setState({ selection: [] });
        lastTap = { p: press.start, id: null, t: performance.now() };
        return;
      }
      // Tapping the same spot again steps to the next thing underneath.
      const again = Math.hypot(press.start.x - lastTap.p.x, press.start.y - lastTap.p.y) < 10 && performance.now() - lastTap.t < 4000;
      let pick = hits[0]!;
      if (again && lastTap.id) {
        const top = hits[0]!;
        const group = expandToGroup(doc, top);
        const wholeWord = group.length > 1 && group.every((id) => s.selection.includes(id)) && s.selection.length === group.length;
        if (wholeWord && lastTap.id === top) {
          // Second tap on a word: just that letter.
          useUi.setState({ selection: [top] });
          lastTap = { p: press.start, id: `${top}#letter`, t: performance.now() };
          return;
        }
        const i = hits.indexOf(lastTap.id.replace('#letter', ''));
        if (i >= 0 && hits.length > 1) pick = hits[(i + 1) % hits.length]!;
      }
      const ids = expandToGroup(doc, pick);
      if (press.shift) {
        const has = ids.every((id) => s.selection.includes(id));
        useUi.setState({ selection: has ? s.selection.filter((id) => !ids.includes(id)) : [...new Set([...s.selection, ...ids])] });
      } else {
        useUi.setState({ selection: ids });
      }
      lastTap = { p: press.start, id: pick, t: performance.now() };
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
      const cur = g;
      g = { kind: 'none' };
      const doc = getDoc();

      switch (cur.kind) {
        case 'press':
          tap(cur);
          break;
        case 'draw':
          cur.tool.up(d, e);
          break;
        case 'move':
        case 'box':
          drag().reset();
          transformSelectionOf(cur.ids, cur.mat);
          break;
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
            const all = [...(s.showGuides ? doc.guides : []), ...doc.shapes];
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
            const next = paintFaces(doc, arr, faces, s.erasing ? null : s.ink);
            // A short tick where the device has one, on the same frame as the color landing.
            if (next !== doc && e.pointerType === 'touch') navigator.vibrate?.(8);
            commit(next);
          }
          break;
        }
        default:
          drag().reset();
      }
    };

    const transformSelectionOf = (ids: Set<string>, m: Mat): void => {
      if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0) return;
      const sel = ui().selection;
      if (sel.length === ids.size && sel.every((id) => ids.has(id))) transformSelection(m);
      else commit(transformItems(getDoc(), ids, m));
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
    svg.addEventListener('contextmenu', stopGesture);
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
      svg.removeEventListener('contextmenu', stopGesture);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [ref]);
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}
