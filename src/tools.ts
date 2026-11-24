/** Drawing tools: pen (click points, drag to bend), brush, freehand draw, and cut. */
import { create } from 'zustand';
import { chainsToPath, ellipseChain, fmt, splineChain, type Pt, type Ring } from '@/geom';
import { strokeOutline } from '@/engine';
import { commit, getDoc } from '@/store/doc';
import { ui, useUi } from '@/store/ui';
import { addGuide, addShapes } from '@/model/ops';
import { guideCenterline } from '@/model/guides';
import type { CurveGuide, PathGuide, PathNode, Shape } from '@/model/types';
import { cutAlong } from '@/model/cut';
import { toast } from 'sonner';
import { uid } from '@/model/ids';
import { registerDrawTool } from '@/canvas/useGestures';
import { useDrag } from '@/canvas/drag';

// ---------------------------------------------------------------------------
// Pen
// ---------------------------------------------------------------------------

export const usePen = create<{ count: number }>(() => ({ count: 0 }));

let nodes: PathNode[] = [];
let pressing = false;
let hoverAt: Pt | null = null;

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

function dot(p: Pt, r: number): string {
  return `M${fmt(p.x - r)} ${fmt(p.y)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(r * 2)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-r * 2)} 0`;
}

function showPen(): void {
  usePen.setState({ count: nodes.length });
  if (!nodes.length) return void useDrag.getState().set({ draft: null, draftWidth: 0 });
  const k = ui().view.k;
  let d = '';
  if (nodes.length >= 2) d += chainsToPath(guideCenterline({ id: '_pen', type: 'path', nodes, closed: false, width: 0 }));
  const last = nodes[nodes.length - 1]!;
  if (hoverAt && !pressing) {
    d += `M${fmt(last.x)} ${fmt(last.y)}`;
    d += last.ox !== undefined ? `C${fmt(last.ox)} ${fmt(last.oy!)} ${fmt(hoverAt.x)} ${fmt(hoverAt.y)} ${fmt(hoverAt.x)} ${fmt(hoverAt.y)}` : `L${fmt(hoverAt.x)} ${fmt(hoverAt.y)}`;
  }
  for (const n of nodes) d += dot(n, 3.2 / k);
  if (last.ox !== undefined && last.oy !== undefined) {
    d += `M${fmt(last.ix ?? last.x)} ${fmt(last.iy ?? last.y)}L${fmt(last.ox)} ${fmt(last.oy)}`;
  }
  useDrag.getState().set({ draft: d, draftWidth: 0 });
}

/** Finish the path being drawn. `close` joins the last point back to the first. */
export function finishPen(close: boolean): void {
  const made = nodes;
  nodes = [];
  pressing = false;
  hoverAt = null;
  usePen.setState({ count: 0 });
  useDrag.getState().set({ draft: null, draftWidth: 0 });
  if (made.length < 2) return;
  const g: PathGuide = { id: uid('g'), type: 'path', nodes: made, closed: close && made.length >= 3, width: 0 };
  commit(addGuide(getDoc(), g));
  useUi.setState({ tool: 'arrange', erasing: false, selection: [g.id], showGuides: true });
}

export function undoPenPoint(): void {
  nodes = nodes.slice(0, -1);
  showPen();
}

registerDrawTool('pen', {
  down(p) {
    const k = ui().view.k;
    if (nodes.length >= 3 && dist(p, nodes[0]!) < 12 / k) return finishPen(true);
    nodes = [...nodes, { x: p.x, y: p.y }];
    pressing = true;
    showPen();
  },
  move(p) {
    if (!pressing || !nodes.length) return;
    const n = nodes[nodes.length - 1]!;
    if (dist(p, n) > 5 / ui().view.k) {
      // Dragging while placing a point pulls out its handles: a smooth point.
      nodes = [...nodes.slice(0, -1), { x: n.x, y: n.y, ox: p.x, oy: p.y, ix: 2 * n.x - p.x, iy: 2 * n.y - p.y }];
      showPen();
    }
  },
  up() {
    pressing = false;
    showPen();
  },
  cancel() {
    if (pressing) nodes = nodes.slice(0, -1);
    pressing = false;
    showPen();
  },
  hover(p) {
    hoverAt = p;
    if (nodes.length) showPen();
  },
});

// ---------------------------------------------------------------------------
// Brush
// ---------------------------------------------------------------------------

let stroke: Pt[] = [];

/** Ramer–Douglas–Peucker: drop points that do not change the stroke's shape. */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = pts[a]!;
    const pb = pts[b]!;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i]!.x - pa.x) * dy - (pts[i]!.y - pa.y) * dx) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function showStroke(): void {
  if (!stroke.length) return void useDrag.getState().set({ draft: null, draftWidth: 0 });
  let d = `M${fmt(stroke[0]!.x)} ${fmt(stroke[0]!.y)}`;
  for (let i = 1; i < stroke.length; i++) d += `L${fmt(stroke[i]!.x)} ${fmt(stroke[i]!.y)}`;
  if (stroke.length === 1) d += 'h0.01';
  useDrag.getState().set({ draft: d, draftWidth: ui().brushWidth });
}

registerDrawTool('brush', {
  down(p) {
    stroke = [p];
    showStroke();
  },
  move(p) {
    const last = stroke[stroke.length - 1];
    if (last && dist(p, last) < 1.5 / ui().view.k) return;
    stroke.push(p);
    showStroke();
  },
  up() {
    const pts = stroke;
    stroke = [];
    useDrag.getState().set({ draft: null, draftWidth: 0 });
    if (!pts.length) return;
    const s = ui();
    const w = s.brushWidth;
    let rings: Ring[] | null = null;
    const simple = simplify(pts, 1.4 / s.view.k);
    if (simple.length < 2 || dist(simple[0]!, simple[simple.length - 1]!) < 0.5) {
      rings = simple.length < 2 || pts.length < 3 ? [ellipseChain(pts[0]!.x, pts[0]!.y, w / 2, w / 2).edges] : null;
    }
    if (!rings) {
      try {
        rings = strokeOutline(splineChain(simple, false), w)
          .filter((c) => c.closed)
          .map((c) => c.edges);
      } catch {
        rings = [];
      }
    }
    if (!rings.length) return;
    const shape: Shape = { id: uid('s'), rings, fill: s.ink };
    commit(addShapes(getDoc(), [shape]));
  },
  cancel() {
    stroke = [];
    useDrag.getState().set({ draft: null, draftWidth: 0 });
  },
});

// ---------------------------------------------------------------------------
// Draw: a freehand line that comes out as a smooth, editable curve
// ---------------------------------------------------------------------------

let sketch: Pt[] = [];

function showSketch(): void {
  if (!sketch.length) return void useDrag.getState().set({ draft: null, draftWidth: 0, draftDashed: false });
  let d = `M${fmt(sketch[0]!.x)} ${fmt(sketch[0]!.y)}`;
  for (let i = 1; i < sketch.length; i++) d += `L${fmt(sketch[i]!.x)} ${fmt(sketch[i]!.y)}`;
  useDrag.getState().set({ draft: d, draftWidth: 0, draftDashed: false });
}

registerDrawTool('draw', {
  down(p) {
    sketch = [p];
    showSketch();
  },
  move(p) {
    const last = sketch[sketch.length - 1];
    if (last && dist(p, last) < 1.5 / ui().view.k) return;
    sketch.push(p);
    showSketch();
  },
  up() {
    const pts = sketch;
    sketch = [];
    useDrag.getState().set({ draft: null, draftWidth: 0 });
    const k = ui().view.k;
    if (pts.length < 3 || dist(pts[0]!, pts[pts.length - 1]!) + pts.length < 6) return;
    // Keep only the points that carry the shape; the curve through them is the smoothing.
    let keep = simplify(pts, 7 / k);
    if (keep.length < 2) return;
    const closed = keep.length >= 4 && dist(keep[0]!, keep[keep.length - 1]!) < 18 / k;
    if (closed) keep = keep.slice(0, -1);
    const g: CurveGuide = { id: uid('g'), type: 'curve', pts: keep.map((q) => ({ x: q.x, y: q.y })), closed, width: 0 };
    commit(addGuide(getDoc(), g));
    useUi.setState({ showGuides: true });
  },
  cancel() {
    sketch = [];
    useDrag.getState().set({ draft: null, draftWidth: 0 });
  },
});

// ---------------------------------------------------------------------------
// Cut: drag a line across things to separate them along it
// ---------------------------------------------------------------------------

let cutFrom: Pt | null = null;
let cutTo: Pt | null = null;

function showCut(): void {
  if (!cutFrom || !cutTo) return void useDrag.getState().set({ draft: null, draftDashed: false });
  useDrag.getState().set({ draft: `M${fmt(cutFrom.x)} ${fmt(cutFrom.y)}L${fmt(cutTo.x)} ${fmt(cutTo.y)}`, draftWidth: 0, draftDashed: true });
}

registerDrawTool('cut', {
  down(p) {
    cutFrom = p;
    cutTo = p;
    showCut();
  },
  move(p, e) {
    if (!cutFrom) return;
    let q = p;
    if (e.shiftKey) {
      // hold Shift for a cut at a clean angle
      const a = Math.round(Math.atan2(p.y - cutFrom.y, p.x - cutFrom.x) / (Math.PI / 12)) * (Math.PI / 12);
      const len = dist(p, cutFrom);
      q = { x: cutFrom.x + Math.cos(a) * len, y: cutFrom.y + Math.sin(a) * len };
    }
    cutTo = q;
    showCut();
  },
  up() {
    const a = cutFrom;
    const b = cutTo;
    cutFrom = cutTo = null;
    useDrag.getState().set({ draft: null, draftDashed: false });
    if (!a || !b || dist(a, b) < 6 / ui().view.k) return;
    const doc = getDoc();
    let next = doc;
    try {
      next = cutAlong(doc, a, b, { outlines: ui().showGuides });
    } catch {
      next = doc;
    }
    if (next === doc) {
      toast('Nothing to cut there', { description: 'Drag the line all the way across a shape or an outline.' });
      return;
    }
    navigator.vibrate?.(8);
    commit(next);
    useUi.setState({ showCuts: true });
  },
  cancel() {
    cutFrom = cutTo = null;
    useDrag.getState().set({ draft: null, draftDashed: false });
  },
});

// Leaving the pen with a path half-drawn keeps what was drawn.
useUi.subscribe((s, prev) => {
  if (prev.tool === 'pen' && s.tool !== 'pen' && nodes.length) finishPen(false);
});

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (ui().tool !== 'pen') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finishPen(false);
    } else if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      if (nodes.length) finishPen(false);
      else useUi.setState({ tool: 'arrange' });
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && nodes.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      undoPenPoint();
    }
  }, true);
}
