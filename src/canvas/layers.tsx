import { memo, useEffect, useMemo, useState } from 'react';
import { apply, chainsToPath, polygonToPath, ringsToPath, toCss, type Mat, type Pt } from '@/geom';
import { withFollowers, type Arrangement } from '@/engine';
import { useDoc } from '@/store/doc';
import { selectionKey, useUi } from '@/store/ui';
import { useIsDark, useSettings } from '@/store/settings';
import { imageUrl } from '@/store/persist';
import { board, resolveFill } from '@/model/doc';
import { useTextPreview } from './textPreview';
import { guideCenterline, guideChains, guideWidth } from '@/model/guides';
import type { Doc, Guide, RefImage, Shape } from '@/model/types';
import { useDrag } from './drag';
import { boxHandles, frameCorners, placeHandles, selectionFrame, type Frame } from './frame';
import { toScreen } from './view';

// ---------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------

function useImage(id: string): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    void imageUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}

const RefItem = memo(function RefItem({ r }: { r: RefImage }) {
  const url = useImage(r.blob);
  const mat = useDrag((s) => (s.ids?.has(r.id) ? s.mat : null));
  if (!url || r.hidden) return null;
  const deg = (r.rot * 180) / Math.PI;
  return (
    <g transform={mat ? toCss(mat) : undefined}>
      <image
        href={url}
        x={r.cx - r.w / 2}
        y={r.cy - r.h / 2}
        width={r.w}
        height={r.h}
        opacity={r.opacity}
        preserveAspectRatio="none"
        transform={deg ? `rotate(${deg} ${r.cx} ${r.cy})` : undefined}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
});

/** Photos sit under the artwork, or — when asked — over it, so tracing can continue on colored areas. */
export function PhotoLayer({ above = false }: { above?: boolean }) {
  const refs = useDoc((s) => s.doc.refs);
  return (
    <g>
      {refs
        .filter((r) => !!r.above === above)
        .map((r) => (
          <RefItem key={r.id} r={r} />
        ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const ShapeItem = memo(function ShapeItem({ shape, fill, stroke, ghost }: { shape: Shape; fill: string; stroke: string | null; ghost: boolean }) {
  // While an outline is dragged, the fills that follow it are shown as they will end up.
  const live = useDrag((s) => (s.shapeRings && shape.id in s.shapeRings ? s.shapeRings[shape.id] : undefined));
  const rings = live === undefined ? shape.rings : live;
  const d = useMemo(() => (rings ? ringsToPath(rings) : ''), [rings]);
  const mat = useDrag((s) => (s.ids?.has(shape.id) ? s.mat : null));
  if (shape.hidden || !d) return null;
  return (
    <g transform={mat ? toCss(mat) : undefined}>
      <path
        d={d}
        fill={fill}
        stroke={stroke ?? undefined}
        strokeWidth={shape.stroke?.width}
        strokeLinejoin={shape.stroke?.join ?? 'round'}
        strokeLinecap={shape.stroke?.cap ?? 'round'}
        paintOrder={shape.stroke?.outside ? 'stroke' : undefined}
        opacity={shape.opacity}
      />
      {ghost && <path d={d} className="ghost" />}
    </g>
  );
});

export function ShapesLayer() {
  const shapes = useDoc((s) => s.doc.shapes);
  const palette = useDoc((s) => s.doc.palette);
  const paper = useDoc((s) => s.doc.paper);
  const showGuides = useUi((s) => s.showGuides);
  // a word being retyped is shown by the text preview instead
  const hide = useTextPreview((s) => s.hide);
  return (
    <g>
      {shapes.map((s) => {
        if (hide && s.group === hide) return null;
        const fill = resolveFill({ palette }, s.fill);
        return (
          <ShapeItem
            key={s.id}
            shape={s}
            fill={fill}
            stroke={s.stroke ? resolveFill({ palette }, s.stroke.color) : null}
            // a white shape on white paper would otherwise be invisible while editing
            ghost={showGuides && !!paper && fill.toLowerCase() === paper.toLowerCase() && !s.stroke}
          />
        );
      })}
    </g>
  );
}

/** The word being typed in the text panel, as it will land. */
export function TextPreviewLayer() {
  const d = useTextPreview((s) => s.d);
  const fill = useTextPreview((s) => s.fill);
  const stroke = useTextPreview((s) => s.stroke);
  const palette = useDoc((s) => s.doc.palette);
  if (!d) return null;
  return (
    <path
      d={d}
      fill={resolveFill({ palette }, fill)}
      stroke={stroke ? resolveFill({ palette }, stroke.color) : undefined}
      strokeWidth={stroke?.width}
      strokeLinejoin="round"
      paintOrder={stroke?.outside ? 'stroke' : undefined}
      className="text-preview"
      style={{ pointerEvents: 'none' }}
    />
  );
}

// ---------------------------------------------------------------------------
// Guides (construction outlines)
// ---------------------------------------------------------------------------

/** Is a color dark enough that a black line on it gets lost? */
function isDark(color: string | null | undefined): boolean {
  if (!color) return false;
  let h = color.trim().replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(h)) return false;
  const lin = (i: number): number => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4) < 0.1;
}

/** One guide's halo, or its line. The two are drawn in separate passes so the halos can be masked. */
const GuideItem = memo(function GuideItem({ guide, selected, quiet, part }: { guide: Guide; selected: boolean; quiet: boolean; part: 'halo' | 'line' }) {
  const override = useDrag((s) => (s.guide?.id === guide.id ? s.guide : null));
  const mat = useDrag((s) => (s.ids?.has(guide.id) ? s.mat : null));
  const g = override ?? guide;
  const d = useMemo(() => chainsToPath(guideChains(g)), [g]);
  const spine = useMemo(() => (part === 'line' && guideWidth(g) > 0 ? chainsToPath(guideCenterline(g)) : null), [g, part]);
  if (g.hidden) return null;
  const cut = g.type === 'line' && g.cut;
  return (
    <g transform={mat ? toCss(mat) : undefined} className={`guide${selected ? ' is-selected' : quiet ? ' is-quiet' : ''}${cut ? ' is-cut' : ''}`}>
      {part === 'halo' ? <path d={d} className="guide-halo" /> : <path d={d} className="guide-line" />}
      {spine && <path d={spine} className="guide-spine" />}
    </g>
  );
});

const FAR = 100000;

const MaskShape = memo(function MaskShape({ shape, dark }: { shape: Shape; dark: boolean }) {
  const live = useDrag((s) => (s.shapeRings && shape.id in s.shapeRings ? s.shapeRings[shape.id] : undefined));
  const rings = live === undefined ? shape.rings : live;
  const d = useMemo(() => (rings ? ringsToPath(rings) : ''), [rings]);
  const mat = useDrag((s) => (s.ids?.has(shape.id) ? s.mat : null));
  if (shape.hidden || !d) return null;
  return <path d={d} transform={mat ? toCss(mat) : undefined} fill={dark ? '#fff' : '#000'} />;
});

/**
 * Where the canvas is dark. Outlines are black; over these places they get a
 * light halo so they stay readable, and nowhere else.
 */
function DarkMask() {
  const shapes = useDoc((s) => s.doc.shapes);
  const palette = useDoc((s) => s.doc.palette);
  const paper = useDoc((s) => s.doc.paper);
  const art = useDoc((s) => s.doc.artboard);
  const refs = useDoc((s) => s.doc.refs);
  const liveBoard = useDrag((s) => s.board);
  const darkUi = useIsDark();
  const b = liveBoard ?? board({ artboard: art });
  // A photo that has not been faded much may well be dark; treat it as such.
  const photo = (above: boolean): React.ReactNode =>
    refs
      .filter((r) => !r.hidden && !!r.above === above && r.opacity > 0.65)
      .map((r) => <rect key={r.id} x={r.cx - r.w / 2} y={r.cy - r.h / 2} width={r.w} height={r.h} fill="#fff" transform={r.rot ? `rotate(${(r.rot * 180) / Math.PI} ${r.cx} ${r.cy})` : undefined} />);
  return (
    <mask id="lc-dark" maskUnits="userSpaceOnUse" x={-FAR} y={-FAR} width={FAR * 2} height={FAR * 2}>
      <rect x={-FAR} y={-FAR} width={FAR * 2} height={FAR * 2} fill={darkUi ? '#fff' : '#000'} />
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={isDark(paper) ? '#fff' : '#000'} />
      {photo(false)}
      {shapes.map((s) => (
        <MaskShape key={s.id} shape={s} dark={isDark(resolveFill({ palette }, s.fill))} />
      ))}
      {photo(true)}
    </mask>
  );
}

export function GuidesLayer() {
  const guides = useDoc((s) => s.doc.guides);
  const selection = useUi((s) => s.selection);
  const show = useUi((s) => s.showGuides);
  const showCuts = useUi((s) => s.showCuts);
  const quiet = useUi((s) => s.tool === 'color');
  if (!show) return null;
  const list = guides.filter((g) => !(g.type === 'line' && g.cut && !showCuts));
  return (
    <g>
      <DarkMask />
      <g mask="url(#lc-dark)">
        {list.map((g) => (
          <GuideItem key={g.id} guide={g} selected={selection.includes(g.id)} quiet={quiet} part="halo" />
        ))}
      </g>
      {list.map((g) => (
        <GuideItem key={g.id} guide={g} selected={selection.includes(g.id)} quiet={quiet} part="line" />
      ))}
      {showCuts && <TrimmedLayer />}
    </g>
  );
}

/** Pieces removed with the Cut tool: faint and dotted, there to be brought back. */
function TrimmedLayer() {
  const trimmed = useDoc((s) => s.doc.trimmed);
  const d = useMemo(() => (trimmed?.length ? trimmed.map((g) => chainsToPath(guideCenterline(g))).join('') : ''), [trimmed]);
  if (!d) return null;
  return <path d={d} className="trimmed" />;
}

// ---------------------------------------------------------------------------
// Faces (Color tool preview)
// ---------------------------------------------------------------------------

function facesPath(arr: Arrangement, ids: Iterable<number>): string {
  let d = '';
  for (const id of ids) {
    const f = arr.faces[id];
    if (!f) continue;
    for (const loop of f.loops) d += polygonToPath(loop);
  }
  return d;
}

export function FacesLayer({ arr }: { arr: Arrangement | null }) {
  const paint = useDrag((s) => s.paint);
  const hover = useDrag((s) => s.hover);
  const erasing = useUi((s) => s.erasing);
  const ink = useUi((s) => s.ink);
  const palette = useDoc((s) => s.doc.palette);
  const strong = useMemo(() => (arr && paint.length ? facesPath(arr, withFollowers(arr, paint)) : ''), [arr, paint]);
  const soft = useMemo(() => (arr && hover >= 0 && !paint.includes(hover) ? facesPath(arr, withFollowers(arr, [hover])) : ''), [arr, hover, paint]);
  if (!arr) return null;
  const color = resolveFill({ palette }, ink);
  return (
    <g style={{ pointerEvents: 'none' }} fillRule="evenodd">
      {soft && (erasing ? <path d={soft} fill="url(#lc-erase)" opacity={0.55} /> : <path d={soft} fill={color} opacity={0.4} />)}
      {strong && (erasing ? <path d={strong} fill="url(#lc-erase)" /> : <path d={strong} fill={color} opacity={0.85} />)}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Snap lines, marquee, drafts (inside the scene, document space)
// ---------------------------------------------------------------------------

export function SceneOverlays() {
  const lines = useDrag((s) => s.snapLines);
  const marquee = useDrag((s) => s.marquee);
  const draft = useDrag((s) => s.draft);
  const draftWidth = useDrag((s) => s.draftWidth);
  const dashed = useDrag((s) => s.draftDashed);
  const trim = useDrag((s) => s.trim);
  const trimWidth = useDrag((s) => s.trimWidth);
  const restore = useDrag((s) => s.restore);
  const mirror = useDrag((s) => s.mirror);
  const mirroring = useUi((s) => s.tool === 'mirror');
  const artboard = useDoc((s) => s.doc.artboard);
  const ink = useUi((s) => s.ink);
  const palette = useDoc((s) => s.doc.palette);
  const b = board({ artboard });
  return (
    <g style={{ pointerEvents: 'none' }}>
      {mirroring && (
        // the frame's centre lines, there to be mirrored across
        <path d={`M${b.x + b.w / 2} ${b.y}V${b.y + b.h}M${b.x} ${b.y + b.h / 2}H${b.x + b.w}`} className="mirror-centre" />
      )}
      {mirror && (
        <>
          <path d={mirror.reach} className="mirror-reach" />
          <path d={mirror.ghost} className="mirror-ghost" />
          <path d={mirror.axis} className="mirror-axis" />
        </>
      )}
      {trim && trimWidth > 0 && <path d={trim} className="trim-band" strokeWidth={trimWidth} />}
      {trim && <path d={trim} className="trim-hot" />}
      {restore && <path d={restore} className="restore-hot" />}
      {lines.map((l, i) => (
        <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} className="snap-line" />
      ))}
      {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} className="marquee" />}
      {draft &&
        (draftWidth > 0 ? (
          <path d={draft} fill="none" stroke={resolveFill({ palette }, ink)} strokeWidth={draftWidth} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
        ) : (
          <>
            <path d={draft} className="draft-halo" />
            <path d={draft} className={dashed ? 'draft is-dashed' : 'draft'} />
          </>
        ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Selection frame and handles (screen space, so they never scale with zoom)
// ---------------------------------------------------------------------------

function previewDoc(doc: Doc, override: Guide | null): Doc {
  if (!override) return doc;
  return { ...doc, guides: doc.guides.map((g) => (g.id === override.id ? override : g)) };
}

function transformFrameCorners(f: Frame, m: Mat | null): Pt[] {
  const c = frameCorners(f);
  return m ? c.map((p) => apply(m, p)) : c;
}

export function SelectionOverlay() {
  const doc = useDoc((s) => s.doc);
  const selection = useUi((s) => s.selection);
  const view = useUi((s) => s.view);
  const tool = useUi((s) => s.tool);
  const selRot = useUi((s) => s.selRot);
  const corner = useUi((s) => s.corner);
  const frameEdit = useUi((s) => s.frameEdit);
  const moveOnly = useUi((s) => s.moveOnly);
  const selectMode = useUi((s) => s.selectMode);
  // redraw when the add-point dots are switched on or off
  useSettings((s) => s.addDots);
  const mat = useDrag((s) => s.mat);
  const dragIds = useDrag((s) => s.ids);
  const override = useDrag((s) => s.guide);

  if (frameEdit) return <BoardOverlay />;
  // Mirroring shows what is being mirrored, without handles to drag.
  const mirroring = tool === 'mirror';
  if ((tool !== 'arrange' && !mirroring) || !selection.length) return null;
  const d = previewDoc(doc, override);
  const frame = selectionFrame(d, selection, selRot);
  if (!frame) return null;
  const moving = !!(mat && dragIds);
  const corners = transformFrameCorners(frame, moving ? mat : null).map((p) => toScreen(view, p));
  const isLine = selection.length === 1 && d.guides.find((g) => g.id === selection[0])?.type === 'line';
  const lockedPhoto = selection.length === 1 && !!d.refs.find((r) => r.id === selection[0])?.locked;
  const handles = moving || lockedPhoto || mirroring ? [] : placeHandles(d, selection, frame, view.k, moveOnly === selectionKey(selection), selectMode === 'points');
  const rot = handles.find((h) => h.handle.kind === 'rot');
  const top = { x: (corners[0]!.x + corners[1]!.x) / 2, y: (corners[0]!.y + corners[1]!.y) / 2 };
  const points = corners.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <g style={{ pointerEvents: 'none' }}>
      {!isLine && (
        <>
          <polygon points={points} className="sel-halo" />
          <polygon points={points} className="sel-frame" />
        </>
      )}
      {rot && <line x1={top.x} y1={top.y} x2={toScreen(view, rot.p).x} y2={toScreen(view, rot.p).y} className="sel-stem" />}
      {handles.map((h, i) => {
        const p = toScreen(view, h.p);
        switch (h.handle.kind) {
          case 'rot':
            return (
              <g key={i} transform={`translate(${p.x} ${p.y})`}>
                <circle r={9} className="handle-rot" />
                <path d="M-3.6 -1.2A3.9 3.9 0 1 1 -2.6 2.9M-3.9 -4.1V-1H-0.8" className="handle-rot-glyph" />
              </g>
            );
          case 'pt': {
            const picked = corner && corner.id === selection[0] && (corner.index === h.handle.index || corner.index < 0);
            // Under a stretch handle (a polygon's top and bottom points, a triangle's corners) the stretch
            // handle is what a drag gets; the point still shows, as a ring around it, and its menu is a right-click away.
            if (handles.some((o) => o.handle.kind === 'box' && Math.hypot(toScreen(view, o.p).x - p.x, toScreen(view, o.p).y - p.y) < 8))
              return <circle key={i} cx={p.x} cy={p.y} r={9} className={picked ? 'handle-pt-ring is-picked' : 'handle-pt-ring'} />;
            return <circle key={i} cx={p.x} cy={p.y} r={5.5} className={picked ? 'handle-pt is-picked' : 'handle-pt'} />;
          }
          case 'hin':
          case 'hout': {
            const g0 = d.guides.find((x) => x.id === selection[0]);
            const node = g0?.type === 'path' ? g0.nodes[h.handle.index] : undefined;
            const a = node ? toScreen(view, node) : p;
            return (
              <g key={i}>
                <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} className="sel-stem" />
                <rect x={p.x - 4} y={p.y - 4} width={8} height={8} rx={1.5} className="handle-box" />
              </g>
            );
          }
          case 'mid':
            // under a stretch handle (the sides of a hexagon), the stretch handle is what is there
            if (handles.some((o) => o.handle.kind === 'box' && Math.hypot(toScreen(view, o.p).x - p.x, toScreen(view, o.p).y - p.y) < 10)) return null;
            return <circle key={i} cx={p.x} cy={p.y} r={3.2} className="handle-mid" />;
          default: {
            const at = h.handle.kind === 'box' ? RECT_CORNER[h.handle.at] : undefined;
            const picked = corner && corner.id === selection[0] && at !== undefined && (corner.index === at || corner.index < 0) && d.guides.find((x) => x.id === corner.id)?.type === 'rect';
            return <circle key={i} cx={p.x} cy={p.y} r={picked ? 6 : 5} className={picked ? 'handle-box is-picked' : 'handle-box'} />;
          }
        }
      })}
    </g>
  );
}

/** A rectangle's corners, in the order their rounding is stored. */
const RECT_CORNER: Partial<Record<string, number>> = { nw: 0, ne: 1, se: 2, sw: 3 };

/** While the export frame is being adjusted: everything outside it dims, and it gets handles. */
function BoardOverlay() {
  const art = useDoc((s) => s.doc.artboard);
  const live = useDrag((s) => s.board);
  const view = useUi((s) => s.view);
  const stage = useUi((s) => s.stage);
  const b = live ?? board({ artboard: art });
  const a = toScreen(view, { x: b.x, y: b.y });
  const c = toScreen(view, { x: b.x + b.w, y: b.y + b.h });
  const frame: Frame = { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rot: 0 };
  return (
    <g style={{ pointerEvents: 'none' }}>
      <path d={`M0 0H${stage.w}V${stage.h}H0ZM${a.x} ${a.y}V${c.y}H${c.x}V${a.y}Z`} className="frame-dim" fillRule="evenodd" />
      <rect x={a.x} y={a.y} width={c.x - a.x} height={c.y - a.y} className="frame-edge" />
      {boxHandles(frame).map((h, i) => {
        const p = toScreen(view, h.p);
        return <circle key={i} cx={p.x} cy={p.y} r={6} className="handle-box" />;
      })}
      <text x={(a.x + c.x) / 2} y={a.y - 10} textAnchor="middle" fontSize={12} fontWeight={600} fill="#fff" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(b.w)} × {Math.round(b.h)}
      </text>
    </g>
  );
}
