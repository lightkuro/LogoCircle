import { memo, useEffect, useMemo, useState } from 'react';
import { apply, chainsToPath, polygonToPath, ringsToPath, toCss, type Mat, type Pt } from '@/geom';
import { withFollowers, type Arrangement } from '@/engine';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { imageUrl } from '@/store/persist';
import { resolveFill } from '@/model/doc';
import { guideCenterline, guideChains, guideWidth } from '@/model/guides';
import type { Doc, Guide, RefImage, Shape } from '@/model/types';
import { useDrag } from './drag';
import { frameCorners, placeHandles, selectionFrame, type Frame } from './frame';
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

export function PhotoLayer() {
  const refs = useDoc((s) => s.doc.refs);
  return (
    <g>
      {refs.map((r) => (
        <RefItem key={r.id} r={r} />
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const ShapeItem = memo(function ShapeItem({ shape, fill, stroke }: { shape: Shape; fill: string; stroke: string | null }) {
  const d = useMemo(() => ringsToPath(shape.rings), [shape.rings]);
  const mat = useDrag((s) => (s.ids?.has(shape.id) ? s.mat : null));
  if (shape.hidden) return null;
  return (
    <path
      d={d}
      fill={fill}
      stroke={stroke ?? undefined}
      strokeWidth={shape.stroke?.width}
      strokeLinejoin={shape.stroke?.join ?? 'round'}
      strokeLinecap={shape.stroke?.cap ?? 'round'}
      opacity={shape.opacity}
      transform={mat ? toCss(mat) : undefined}
    />
  );
});

export function ShapesLayer() {
  const shapes = useDoc((s) => s.doc.shapes);
  const palette = useDoc((s) => s.doc.palette);
  return (
    <g>
      {shapes.map((s) => (
        <ShapeItem
          key={s.id}
          shape={s}
          fill={resolveFill({ palette }, s.fill)}
          stroke={s.stroke ? resolveFill({ palette }, s.stroke.color) : null}
        />
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Guides (construction outlines)
// ---------------------------------------------------------------------------

const GuideItem = memo(function GuideItem({ guide, selected, quiet }: { guide: Guide; selected: boolean; quiet: boolean }) {
  const override = useDrag((s) => (s.guide?.id === guide.id ? s.guide : null));
  const mat = useDrag((s) => (s.ids?.has(guide.id) ? s.mat : null));
  const g = override ?? guide;
  const d = useMemo(() => chainsToPath(guideChains(g)), [g]);
  const spine = useMemo(() => (guideWidth(g) > 0 ? chainsToPath(guideCenterline(g)) : null), [g]);
  if (g.hidden) return null;
  return (
    <g transform={mat ? toCss(mat) : undefined} className={selected ? 'guide is-selected' : quiet ? 'guide is-quiet' : 'guide'}>
      <path d={d} className="guide-halo" />
      <path d={d} className="guide-line" />
      {spine && <path d={spine} className="guide-spine" />}
    </g>
  );
});

export function GuidesLayer() {
  const guides = useDoc((s) => s.doc.guides);
  const selection = useUi((s) => s.selection);
  const show = useUi((s) => s.showGuides);
  const quiet = useUi((s) => s.tool === 'color');
  if (!show) return null;
  return (
    <g>
      {guides.map((g) => (
        <GuideItem key={g.id} guide={g} selected={selection.includes(g.id)} quiet={quiet} />
      ))}
    </g>
  );
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
  const soft = useMemo(
    () => (arr && hover >= 0 && !paint.includes(hover) ? facesPath(arr, withFollowers(arr, [hover])) : ''),
    [arr, hover, paint],
  );
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
  const ink = useUi((s) => s.ink);
  const palette = useDoc((s) => s.doc.palette);
  return (
    <g style={{ pointerEvents: 'none' }}>
      {lines.map((l, i) => (
        <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} className="snap-line" />
      ))}
      {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} className="marquee" />}
      {draft &&
        (draftWidth > 0 ? (
          <path d={draft} fill="none" stroke={resolveFill({ palette }, ink)} strokeWidth={draftWidth} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
        ) : (
          <path d={draft} className="draft" />
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
  const mat = useDrag((s) => s.mat);
  const dragIds = useDrag((s) => s.ids);
  const override = useDrag((s) => s.guide);

  if (tool !== 'arrange' || !selection.length) return null;
  const d = previewDoc(doc, override);
  const frame = selectionFrame(d, selection);
  if (!frame) return null;
  const moving = !!(mat && dragIds);
  const corners = transformFrameCorners(frame, moving ? mat : null).map((p) => toScreen(view, p));
  const isLine = selection.length === 1 && d.guides.find((g) => g.id === selection[0])?.type === 'line';
  const lockedPhoto = selection.length === 1 && !!d.refs.find((r) => r.id === selection[0])?.locked;
  const handles = moving || lockedPhoto ? [] : placeHandles(d, selection, frame, view.k);
  const rot = handles.find((h) => h.handle.kind === 'rot');
  const top = { x: (corners[0]!.x + corners[1]!.x) / 2, y: (corners[0]!.y + corners[1]!.y) / 2 };

  return (
    <g style={{ pointerEvents: 'none' }}>
      {!isLine && <polygon points={corners.map((p) => `${p.x},${p.y}`).join(' ')} className="sel-frame" />}
      {rot && (
        <line
          x1={top.x}
          y1={top.y}
          x2={toScreen(view, rot.p).x}
          y2={toScreen(view, rot.p).y}
          className="sel-stem"
        />
      )}
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
          case 'pt':
            return <circle key={i} cx={p.x} cy={p.y} r={6} className="handle-pt" />;
          case 'hin':
          case 'hout': {
            const g0 = d.guides.find((x) => x.id === selection[0]);
            const node = g0?.type === 'path' ? g0.nodes[h.handle.index] : undefined;
            const a = node ? toScreen(view, node) : p;
            return (
              <g key={i}>
                <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} className="sel-stem" opacity={0.7} />
                <rect x={p.x - 4} y={p.y - 4} width={8} height={8} rx={1.5} className="handle-box" />
              </g>
            );
          }
          case 'mid':
            return (
              <g key={i} transform={`translate(${p.x} ${p.y})`}>
                <circle r={7} className="handle-mid" />
                <path d="M-3 0H3M0 -3V3" className="handle-mid-glyph" />
              </g>
            );
          default:
            return <circle key={i} cx={p.x} cy={p.y} r={5.5} className="handle-box" />;
        }
      })}
    </g>
  );
}
