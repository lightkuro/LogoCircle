import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUi } from '@/store/ui';

/** The right-click / press-and-hold menu. Opens at the pointer and stays inside the window. */
export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const openedAt = useRef(0);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(null);
    openedAt.current = performance.now();
    const r = ref.current.getBoundingClientRect();
    const pad = 8;
    // Opened by a finger: sit above it (or below when there is no room), never underneath it.
    let top = menu.y;
    let left = menu.x;
    if (menu.touch) {
      left = menu.x - r.width / 2;
      top = menu.y - r.height - 18;
      if (top < pad) top = menu.y + 28;
    }
    setPos({
      left: Math.max(pad, Math.min(left, window.innerWidth - r.width - pad)),
      top: Math.max(pad, Math.min(top, window.innerHeight - r.height - pad)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (): void => useUi.setState({ menu: null });
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    // capture: the canvas takes pointer events for itself
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="pop ctx-menu"
      role="menu"
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((it, i) => (
        <div key={i}>
          {it.divide && i > 0 && <div className="menu-sep" />}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            data-tone={it.danger ? 'danger' : undefined}
            disabled={it.disabled}
            onClick={() => {
              // A finger lifting off sends a stray click right where the menu just appeared: not a choice.
              if (menu.touch && performance.now() - openedAt.current < 350) return;
              useUi.setState({ menu: null });
              it.onSelect();
            }}
          >
            {it.swatch && <span className="swatch-sm" style={{ background: it.swatch, width: 16, height: 16 }} />}
            {it.label}
            {it.keys && <kbd>{it.keys}</kbd>}
          </button>
        </div>
      ))}
    </div>
  );
}
