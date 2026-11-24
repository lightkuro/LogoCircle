/**
 * Preferences that belong to the person rather than to a logo: how the
 * interface is laid out, how the mouse behaves, which keys do what.
 * Kept in localStorage.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';

/** `auto` follows the screen; the others force the phone or the desktop interface. */
export type Layout = 'auto' | 'desktop' | 'mobile';
export type Theme = 'auto' | 'light' | 'dark';
/**
 * What dragging on empty canvas does with the left mouse button. The right
 * button drag does the other one.
 */
export type DragEmpty = 'pan' | 'select';

export interface Settings {
  layout: Layout;
  theme: Theme;
  dragEmpty: DragEmpty;
  /** A short vibration when coloring or opening a hold menu, where the device has one. */
  haptics: boolean;
  /** Key bindings that differ from the defaults: command id → combo ('' = no key). */
  keys: Record<string, string>;
}

const DEFAULTS: Settings = { layout: 'auto', theme: 'auto', dragEmpty: 'pan', haptics: true, keys: {} };
const KEY = 'lc.settings';

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      layout: raw.layout === 'desktop' || raw.layout === 'mobile' ? raw.layout : 'auto',
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'auto',
      dragEmpty: raw.dragEmpty === 'select' ? 'select' : 'pan',
      haptics: raw.haptics !== false,
      keys: raw.keys && typeof raw.keys === 'object' ? { ...raw.keys } : {},
    };
  } catch {
    return { ...DEFAULTS, keys: {} };
  }
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((set) => ({
  ...load(),
  set: (patch) => set(patch),
  reset: () => set({ ...DEFAULTS, keys: {} }),
}));

export const settings = (): SettingsState => useSettings.getState();

useSettings.subscribe((s) => {
  try {
    const { layout, theme, dragEmpty, haptics, keys } = s;
    localStorage.setItem(KEY, JSON.stringify({ layout, theme, dragEmpty, haptics, keys }));
  } catch {
    /* private mode: preferences simply do not persist */
  }
});

// --- What kind of device this is ------------------------------------------------

const PHONE = '(max-width: 639px)';
/** A phone on its side: little height to spare, so the controls move to the sides. */
const SHORT = '(max-height: 500px) and (orientation: landscape)';
const TOUCH = '(hover: none), (pointer: coarse)';
const DARK = '(prefers-color-scheme: dark)';

const matches = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;

function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => matches(q));
  useEffect(() => {
    const m = matchMedia(q);
    const change = (): void => setOn(m.matches);
    change();
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, [q]);
  return on;
}

/**
 * Which interface to lay out: `phone` (upright: tools along the bottom),
 * `side` (a phone on its side: tools down both edges, the canvas between them
 * at full height) or `desktop`.
 */
export type LayoutKind = 'phone' | 'side' | 'desktop';

function layoutKind(layout: Layout, narrow: boolean, short: boolean): LayoutKind {
  if (layout === 'desktop') return 'desktop';
  if (short) return 'side';
  return layout === 'mobile' || narrow ? 'phone' : 'desktop';
}

export function useLayoutKind(): LayoutKind {
  const layout = useSettings((s) => s.layout);
  return layoutKind(layout, useMedia(PHONE), useMedia(SHORT));
}

export const layoutKindNow = (): LayoutKind => layoutKind(settings().layout, matches(PHONE), matches(SHORT));

/** The compact, touch-first interface: phones, upright or on their side. */
export function useIsPhone(): boolean {
  return useLayoutKind() !== 'desktop';
}

/** A phone on its side. */
export function useIsSide(): boolean {
  return useLayoutKind() === 'side';
}

/** Fingers rather than a mouse: decides the wording ("tap" or "click") and which controls are offered. */
export function useIsTouch(): boolean {
  const layout = useSettings((s) => s.layout);
  const touch = useMedia(TOUCH);
  return layout === 'auto' ? touch : layout === 'mobile';
}

export const isPhone = (): boolean => layoutKindNow() !== 'desktop';
export const isSide = (): boolean => layoutKindNow() === 'side';

export const isTouch = (): boolean => {
  const { layout } = settings();
  return layout === 'auto' ? matches(TOUCH) : layout === 'mobile';
};

export function useIsDark(): boolean {
  const theme = useSettings((s) => s.theme);
  const dark = useMedia(DARK);
  return theme === 'auto' ? dark : theme === 'dark';
}

/** Mirror the layout and theme onto <html>, where the stylesheet reads them. */
export function useDocumentAttributes(): void {
  const kind = useLayoutKind();
  const touch = useIsTouch();
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.layout = kind;
    root.dataset.input = touch ? 'touch' : 'mouse';
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [kind, touch, theme]);
}

/** A short vibration, unless switched off. */
export function buzz(ms = 10): void {
  if (settings().haptics) navigator.vibrate?.(ms);
}
