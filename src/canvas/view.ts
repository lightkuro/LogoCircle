import type { Pt } from '@/geom';
import type { View } from '@/store/ui';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 64;

export function toDoc(v: View, p: Pt): Pt {
  return { x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k };
}

export function toScreen(v: View, p: Pt): Pt {
  return { x: p.x * v.k + v.x, y: p.y * v.k + v.y };
}

/** Zoom by `factor`, keeping the document point under `at` (screen px) fixed. */
export function zoomAt(v: View, at: Pt, factor: number): View {
  const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.k * factor));
  const f = k / v.k;
  return { k, x: at.x - (at.x - v.x) * f, y: at.y - (at.y - v.y) * f };
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A view that shows the whole box, centred in the part of the stage not covered by chrome. */
export function fitView(
  stage: { w: number; h: number },
  box: { x: number; y: number; w: number; h: number },
  insets: Insets,
): View {
  const aw = Math.max(40, stage.w - insets.left - insets.right);
  const ah = Math.max(40, stage.h - insets.top - insets.bottom);
  const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(aw / box.w, ah / box.h)));
  return {
    k,
    x: insets.left + (aw - box.w * k) / 2 - box.x * k,
    y: insets.top + (ah - box.h * k) / 2 - box.y * k,
  };
}

/** Space the floating chrome takes at each edge, so content can be centred in what is left. */
export function chromeInsets(stage: { w: number; h: number }, sidePanel = false): Insets {
  const phone = stage.w < 640;
  return { top: phone ? 72 : 84, right: sidePanel && !phone ? 286 : 20, bottom: phone ? 168 : 150, left: 20 };
}
