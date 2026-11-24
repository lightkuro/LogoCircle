import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useUi, type MenuItem } from '@/store/ui';

/**
 * The right-click / press-and-hold menu. Opens at the pointer and stays inside
 * the window. An item with `children` is a heading: with a mouse its items
 * open beside it on hover; with a finger they fold out in place.
 */
export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // The heading whose items are open beside it (mouse), and where its panel goes.
  const [sub, setSub] = useState<{ index: number; anchor: DOMRect } | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);
  // The heading folded out in place (touch).
  const [unfolded, setUnfolded] = useState<number | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);

  const openedAt = useRef(0);

  useLayoutEffect(() => {
    setSub(null);
    setUnfolded(null);
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

  // A side panel goes to the right of its heading, or to the left when there is no room.
  useLayoutEffect(() => {
    if (!sub || !subRef.current) return setSubPos(null);
    const r = subRef.current.getBoundingClientRect();
    const pad = 8;
    let left = sub.anchor.right + 2;
    if (left + r.width > window.innerWidth - pad) left = sub.anchor.left - r.width - 2;
    setSubPos({
      left: Math.max(pad, left),
      top: Math.max(pad, Math.min(sub.anchor.top - 5, window.innerHeight - r.height - pad)),
    });
  }, [sub]);

  useEffect(() => {
    if (!menu) return;
    const close = (): void => useUi.setState({ menu: null });
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !subRef.current?.contains(t)) close();
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
  useEffect(() => () => clearTimeout(closing.current), []);

  if (!menu) return null;

  const choose = (it: MenuItem): void => {
    // A finger lifting off sends a stray click right where the menu just appeared: not a choice.
    if (menu.touch && performance.now() - openedAt.current < 350) return;
    useUi.setState({ menu: null });
    it.onSelect();
  };

  const row = (it: MenuItem, i: number, inner = false) => {
    const heading = !!it.children?.length;
    const openHere = heading && (menu.touch ? unfolded === i : sub?.index === i);
    return (
      <div key={i}>
        {it.divide && i > 0 && <div className="menu-sep" />}
        <button
          type="button"
          role="menuitem"
          className={inner ? 'menu-item menu-inner' : 'menu-item'}
          data-tone={it.danger ? 'danger' : undefined}
          data-open={openHere || undefined}
          aria-haspopup={heading ? 'menu' : undefined}
          aria-expanded={heading ? openHere : undefined}
          aria-checked={it.checked}
          disabled={it.disabled}
          onPointerEnter={(e) => {
            if (e.pointerType !== 'mouse' || menu.touch || inner) return;
            clearTimeout(closing.current);
            if (heading) {
              const anchor = e.currentTarget.getBoundingClientRect();
              setSub({ index: i, anchor });
            } else if (sub) {
              // a moment's grace, for a pointer on its way across to the side panel
              closing.current = setTimeout(() => setSub(null), 180);
            }
          }}
          onClick={(e) => {
            if (!heading) return choose(it);
            if (menu.touch) setUnfolded(unfolded === i ? null : i);
            else setSub(sub?.index === i ? null : { index: i, anchor: e.currentTarget.getBoundingClientRect() });
          }}
        >
          {it.swatch ? <span className="swatch-sm" style={{ background: it.swatch, width: 16, height: 16 }} /> : it.icon ? <it.icon /> : <span className="menu-gap" />}
          {it.label}
          {it.keys && <kbd>{it.keys}</kbd>}
          {it.checked && <Check className="menu-check" />}
          {heading && (menu.touch ? <ChevronDown className="menu-fold" data-open={openHere || undefined} /> : <ChevronRight className="menu-fold" />)}
        </button>
        {heading && menu.touch && unfolded === i && it.children!.map((c, k) => row(c, k, true))}
      </div>
    );
  };

  const subItems = sub ? menu.items[sub.index]?.children : undefined;
  return (
    <>
      <div
        ref={ref}
        className="pop ctx-menu"
        role="menu"
        style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {menu.items.map((it, i) => row(it, i))}
      </div>
      {subItems && (
        <div
          ref={subRef}
          className="pop ctx-menu ctx-sub"
          role="menu"
          aria-label={menu.items[sub!.index]!.label}
          style={{ left: subPos?.left ?? 0, top: subPos?.top ?? 0, visibility: subPos ? 'visible' : 'hidden' }}
          onPointerEnter={() => clearTimeout(closing.current)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {subItems.map((it, k) => (
            <div key={k}>
              {it.divide && k > 0 && <div className="menu-sep" />}
              <button type="button" role="menuitem" className="menu-item" data-tone={it.danger ? 'danger' : undefined} aria-checked={it.checked} disabled={it.disabled} onClick={() => choose(it)}>
                {it.swatch ? <span className="swatch-sm" style={{ background: it.swatch, width: 16, height: 16 }} /> : it.icon ? <it.icon /> : <span className="menu-gap" />}
                {it.label}
                {it.keys && <kbd>{it.keys}</kbd>}
                {it.checked && <Check className="menu-check" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
