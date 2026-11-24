/**
 * Hold and drag: press a button that opens a list, slide onto a choice and let
 * go to pick it, all in one move. Resting on a heading that folds out opens it.
 * Off unless switched on in Settings.
 */
import { useRef, type PointerEvent, type RefObject } from 'react';
import { buzz, useSettings } from '@/store/settings';

const SLOP = 8;
/** How long to rest on a heading before it folds out. */
const DWELL_MS = 320;

interface Press {
  id: number;
  x: number;
  y: number;
  moved: boolean;
  /** The list was open before this press (so a plain tap keeps its usual meaning). */
  wasOpen: boolean;
}

export function useSlidePick({ open, isOpen, close, list }: { open: () => void; isOpen: boolean; close: () => void; list: RefObject<HTMLElement | null> }) {
  const on = useSettings((s) => s.slidePick);
  const press = useRef<Press | null>(null);
  const skip = useRef(false);
  const hot = useRef<HTMLElement | null>(null);
  const dwelt = useRef<HTMLElement | null>(null);
  const dwell = useRef<ReturnType<typeof setTimeout>>(undefined);

  const itemAt = (x: number, y: number): HTMLElement | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.menu-item');
    return el && list.current?.contains(el) && !(el as HTMLButtonElement).disabled ? el : null;
  };
  const light = (el: HTMLElement | null): void => {
    if (el === hot.current) return;
    hot.current?.removeAttribute('data-hot');
    hot.current = el;
    clearTimeout(dwell.current);
    if (!el) return;
    el.setAttribute('data-hot', '');
    buzz(4);
    if (el.getAttribute('aria-expanded') === 'false') {
      dwell.current = setTimeout(() => {
        dwelt.current = el;
        el.click();
      }, DWELL_MS);
    }
  };
  const end = (): void => {
    press.current = null;
    light(null);
  };

  return {
    /** Spread onto the button. Nothing at all while the setting is off. */
    props: on
      ? {
          style: { touchAction: 'none' } as const,
          onPointerDown: (e: PointerEvent<HTMLElement>) => {
            skip.current = false;
            if (e.button !== 0) return;
            press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, wasOpen: isOpen };
            dwelt.current = null;
            e.currentTarget.setPointerCapture(e.pointerId);
            open();
          },
          onPointerMove: (e: PointerEvent<HTMLElement>) => {
            const p = press.current;
            if (!p || p.id !== e.pointerId) return;
            if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < SLOP) return;
            p.moved = true;
            light(itemAt(e.clientX, e.clientY));
          },
          onPointerUp: (e: PointerEvent<HTMLElement>) => {
            const p = press.current;
            if (!p || p.id !== e.pointerId) return;
            const el = p.moved ? itemAt(e.clientX, e.clientY) : null;
            const onButton = e.currentTarget.contains(document.elementFromPoint(e.clientX, e.clientY));
            end();
            // A plain tap: the click that follows does what a tap always did, unless this press opened the list.
            if (!p.moved) {
              skip.current = !p.wasOpen;
              return;
            }
            skip.current = true;
            setTimeout(() => (skip.current = false), 400);
            if (el && el !== dwelt.current) el.click();
            else if (!el && !onButton) close();
          },
          onPointerCancel: end,
        }
      : {},
    /** True for a click the slide has already dealt with: the button should ignore it. */
    handled: (): boolean => {
      const s = skip.current;
      skip.current = false;
      return s;
    },
  };
}
