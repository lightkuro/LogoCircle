/**
 * A color picker: a square for saturation and brightness, and a strip for the
 * hue. Unlike the usual strip, which runs from red all the way round to red
 * again, this one runs from a deep red to pink, so red sits at one end only.
 * The strip is drawn a little softer than the colors it stands for.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** The hue strip runs from HUE_START to HUE_END degrees (past 360 is not used). */
const HUE_START = -12;
const HUE_END = 330;

interface Hsv {
  h: number;
  s: number;
  v: number;
}

function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number): number => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  const to = (c: number): string =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

/** Where a hue sits on the strip, 0 to 1. Hues past the pink end are folded onto the nearer end. */
function hueToStrip(h: number): number {
  let x = h;
  if (x > HUE_END) x = x - 360 >= HUE_START ? x - 360 : x > (HUE_END + 360 + HUE_START) / 2 ? HUE_START : HUE_END;
  return (x - HUE_START) / (HUE_END - HUE_START);
}
const stripToHue = (t: number): number => (HUE_START + t * (HUE_END - HUE_START) + 360) % 360;

const STRIP = (() => {
  const stops: string[] = [];
  for (let i = 0; i <= 12; i++) {
    const h = HUE_START + (i / 12) * (HUE_END - HUE_START);
    stops.push(`hsl(${Math.round((h + 360) % 360)} 68% 58%) ${((i / 12) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
})();

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Follow a pointer across an element, reporting where it is as fractions of the element's size. */
function useDrag(onAt: (x: number, y: number) => void) {
  const el = useRef<HTMLDivElement>(null);
  const at = (e: PointerEvent): void => {
    const r = el.current!.getBoundingClientRect();
    onAt(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  };
  return {
    ref: el,
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault();
      el.current?.setPointerCapture(e.pointerId);
      el.current?.focus({ preventScroll: true });
      at(e);
    },
    onPointerMove: (e: PointerEvent) => {
      if (el.current?.hasPointerCapture(e.pointerId)) at(e);
    },
  };
}

export function Picker({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  // Kept as HSV so the hue survives greys and black, where the hex alone cannot hold it.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));
  const sent = useRef(color.toLowerCase());
  useEffect(() => {
    if (color.toLowerCase() === sent.current) return;
    sent.current = color.toLowerCase();
    const next = hexToHsv(color);
    setHsv((prev) => (next.s === 0 || next.v === 0 ? { ...next, h: prev.h } : next));
  }, [color]);

  const update = (next: Hsv): void => {
    setHsv(next);
    const hex = hsvToHex(next);
    sent.current = hex;
    onChange(hex);
  };

  const square = useDrag((x, y) => update({ ...hsv, s: x, v: 1 - y }));
  const strip = useDrag((x) => update({ ...hsv, h: stripToHue(x) }));

  const keySquare = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    update({ ...hsv, s: clamp01(hsv.s + d[0]!), v: clamp01(hsv.v + d[1]!) });
  };
  const keyStrip = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : 0;
    if (!d) return;
    e.preventDefault();
    update({ ...hsv, h: stripToHue(clamp01(hueToStrip(hsv.h) + d)) });
  };

  const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const hex = hsvToHex(hsv);
  const t = hueToStrip(hsv.h);
  return (
    <div className="picker2">
      <div
        {...square}
        className="picker2-square"
        style={{ backgroundColor: pure }}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={hex}
        aria-valuenow={Math.round(hsv.s * 100)}
        onKeyDown={keySquare}
      >
        <span className="picker2-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div
        {...strip}
        className="picker2-strip"
        style={{ background: STRIP }}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(t * 100)}
        onKeyDown={keyStrip}
      >
        <span className="picker2-knob" style={{ left: `${t * 100}%`, top: '50%', background: pure }} />
      </div>
    </div>
  );
}
