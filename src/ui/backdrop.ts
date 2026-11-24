/**
 * Safari (every browser on iOS, and Safari on a Mac) can leave a frosted bar
 * showing an old, blurred copy of the canvas after the canvas underneath has
 * moved, until something else makes the bar redraw. While the canvas changes,
 * nudge the bars to redraw on every frame: an invisible change to their shadow
 * is enough, and costs next to nothing.
 */
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { useDrag } from '@/canvas/drag';

const webkit = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua);
};

export function startBackdropNudge(): () => void {
  if (!webkit()) return () => undefined;
  const root = document.documentElement;
  let flip = false;
  let frame = 0;
  const nudge = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      flip = !flip;
      root.style.setProperty('--nudge', flip ? '0.01px' : '0px');
    });
  };
  const stops = [
    useUi.subscribe((s, prev) => {
      if (s.view !== prev.view || s.selection !== prev.selection || s.showGuides !== prev.showGuides) nudge();
    }),
    useDoc.subscribe((s, prev) => {
      if (s.doc !== prev.doc) nudge();
    }),
    useDrag.subscribe(nudge),
  ];
  return () => {
    stops.forEach((stop) => stop());
    cancelAnimationFrame(frame);
  };
}
