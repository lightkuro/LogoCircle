import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { buildDocArrangement } from '@/model/paint';
import type { Arrangement } from '@/engine';
import { fitToScreen } from '@/actions';
import { arrangementRef, useGestures } from './useGestures';
import { FacesLayer, GuidesLayer, PhotoLayer, SceneOverlays, SelectionOverlay, ShapesLayer } from './layers';
import { Loupe } from './Loupe';

function useArrangement(): Arrangement | null {
  const tool = useUi((s) => s.tool);
  const showGuides = useUi((s) => s.showGuides);
  const guides = useDoc((s) => s.doc.guides);
  const shapes = useDoc((s) => s.doc.shapes);
  const artboard = useDoc((s) => s.doc.artboard);
  const arr = useMemo(() => {
    if (tool !== 'color') return null;
    try {
      return buildDocArrangement(useDoc.getState().doc, showGuides);
    } catch (err) {
      console.error('Could not divide the canvas into areas', err);
      return null;
    }
    // `guides`, `shapes` and `artboard` are what the arrangement is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, showGuides, guides, shapes, artboard]);
  useLayoutEffect(() => {
    arrangementRef.current = arr;
  }, [arr]);
  return arr;
}

export function Stage() {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const view = useUi((s) => s.view);
  const artboard = useDoc((s) => s.doc.artboard);
  const paper = useDoc((s) => s.doc.paper);
  const tool = useUi((s) => s.tool);
  const arr = useArrangement();
  useGestures(svg);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const prev = useUi.getState().stage;
      if (prev.w === w && prev.h === h) return;
      useUi.setState({ stage: { w, h } });
      if (first && w > 0 && h > 0) {
        first = false;
        fitToScreen();
      } else if (prev.w > 0) {
        // Keep the same document point in the middle when the window changes size.
        const v = useUi.getState().view;
        useUi.setState({ view: { k: v.k, x: v.x + (w - prev.w) / 2, y: v.y + (h - prev.h) / 2 } });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrap} className="stage" data-tool={tool}>
      <svg ref={svg} className="stage-svg" role="application" aria-label="Logo canvas">
        <defs>
          <pattern id="lc-checker" width="24" height="24" patternUnits="userSpaceOnUse">
            <rect width="24" height="24" className="checker-a" />
            <path d="M0 0h12v12H0zM12 12h12v12H12z" className="checker-b" />
          </pattern>
          <pattern id="lc-erase" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" className="erase-a" />
            <rect width="2.2" height="7" className="erase-b" />
          </pattern>
          <clipPath id="lc-artboard-clip">
            <rect x={0} y={0} width={artboard.w} height={artboard.h} />
          </clipPath>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <g id="lc-scene-inner">
            <rect x={0} y={0} width={artboard.w} height={artboard.h} fill={paper ?? 'url(#lc-checker)'} />
            <PhotoLayer />
            <ShapesLayer />
            <FacesLayer arr={arr} />
            <rect x={0} y={0} width={artboard.w} height={artboard.h} className="artboard-edge" />
            <GuidesLayer />
          </g>
          <SceneOverlays />
        </g>
        <SelectionOverlay />
      </svg>
      <Loupe />
    </div>
  );
}
