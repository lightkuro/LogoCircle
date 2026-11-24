import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { BASIC_COLORS, NEW_COLOR, PALETTES, PAPERS } from '@/model/doc';
import { addColor } from '@/model/ops';
import { removeSwatch, usePalette } from '@/actions';
import { svgDataUrl, thumbnail } from '@/export/svg';
import { Picker } from './Picker';
import { useLiveEdit } from './live';

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(v: string): string | null {
  const m = HEX.exec(v.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return `#${h}`;
}

/** The logo as it stands, small, on the background being chosen. */
function PaperPreview() {
  const doc = useDoc((s) => s.doc);
  const url = useMemo(() => svgDataUrl(thumbnail(doc)), [doc]);
  return (
    <div className={`paper-preview${doc.paper ? '' : ' swatch-clear'}`} aria-label="Preview" role="img">
      <img src={url} alt="" draggable={false} />
    </div>
  );
}

/**
 * The small panel for a color: a picker, a few plain colors and a hex field.
 * Color sets live one step further, under Sets.
 *
 * `target` is a swatch, the background ('paper'), or a swatch still to be
 * added ('new'): that one is only created once a color is chosen, so opening
 * it and clicking away leaves the colors as they were.
 *
 * It is drawn on top of everything and placed from where it was opened: beside
 * a strip of colors running down an edge, above colors in a bar along the
 * bottom, or by the button or menu that asked for it. Always inside the screen,
 * clear of the bars at the top and bottom, and scrolling when there is not the
 * room.
 */
export function ColorPanel({ target, align }: { target: number | 'paper' | 'new'; align?: 'end' }) {
  const palette = useDoc((s) => s.doc.palette);
  const paper = useDoc((s) => s.doc.paper);
  const anchor = useUi((s) => s.colorAnchor);
  const live = useLiveEdit();
  const ref = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const [more, setMore] = useState(false);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    maxHeight?: number;
  } | null>(null);
  // A new swatch, once a color has been chosen for it.
  const [created, setCreated] = useState<number | null>(null);
  const slot = target === 'new' ? created : target === 'paper' ? null : target;
  const value = target === 'paper' ? (paper ?? '#ffffff') : slot === null ? NEW_COLOR : (palette[slot] ?? '#000000');
  // Nothing is shown as chosen in a new swatch's panel until something is.
  const chosen = target !== 'new' || created !== null;
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  const set = (hex: string | null): void => {
    if (target === 'paper')
      return live.change((doc) => ({
        ...doc,
        paper: hex,
        updatedAt: Date.now(),
      }));
    if (!hex) return;
    if (slot === null) {
      // The first choice creates the swatch; the rest of the visit edits it, all as one undo step.
      let index = 0;
      live.change((doc) => {
        const r = addColor(doc, hex);
        index = r.index;
        return r.doc;
      });
      setCreated(index);
      useUi.setState({ ink: index });
      return;
    }
    live.change((doc) => ({
      ...doc,
      palette: doc.palette.map((c, i) => (i === slot ? hex : c)),
      updatedAt: Date.now(),
    }));
  };

  useLayoutEffect(() => {
    const el = ref.current;
    const at = marker.current;
    if (!el || !at) return;
    const pad = 8;
    const rects = (sel: string): DOMRect[] => [...document.querySelectorAll(sel)].map((b) => b.getBoundingClientRect()).filter((r) => r.height > 0);
    const strip = at.closest('.color-strip');
    // Opened from a button or a menu (the background, from More): placed by that instead.
    const from = target === 'paper' && anchor ? anchor : null;
    const home = from ?? (strip ?? at.closest('.swatch-wrap') ?? at.parentElement)!.getBoundingClientRect();
    const inBar = (r: { top: number; bottom: number }): boolean => !strip && !from && !(r.bottom < home.top || r.top > home.bottom);
    // the bars along the top, and those along the bottom other than the one these colors are in
    const top = Math.max(pad, ...rects('.chrome-top > *').map((r) => r.bottom + pad));
    const bottom = Math.min(
      window.innerHeight - pad,
      ...rects('.chrome-bottom > *')
        .filter((r) => !inBar(r))
        .map((r) => r.top - pad),
    );
    const room = Math.max(160, Math.min(bottom, from && from.side === 'above' ? home.top - 12 : bottom) - top);
    el.style.maxHeight = '';
    const w = el.offsetWidth;
    const h = Math.min(el.scrollHeight, room);
    let left: number;
    let y: number;
    if (from?.side === 'above') {
      // above the button it came from, centred on it
      left = home.left + home.width / 2 - w / 2;
      y = home.top - 12 - h;
    } else if (strip || from) {
      // beside the strip or the button, level with its middle
      left = home.right + 10;
      y = home.top + home.height / 2 - h / 2;
    } else {
      // above the swatch, centred on it, or ending at it for the last ones
      left = align === 'end' ? home.right + 8 - w : home.left + home.width / 2 - w / 2;
      y = home.top - 12 - h;
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    y = Math.max(top, Math.min(y, bottom - h));
    setPos({
      left: Math.round(left),
      top: Math.round(y),
      maxHeight: h < el.scrollHeight ? Math.round(h) : undefined,
    });
  }, [target, more, align, anchor, created]);

  // One undo step for the whole visit; close on a click anywhere else.
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest('[data-swatch]')) return;
      useUi.setState({ colorPanel: null });
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useUi.setState({ colorPanel: null });
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      live.commit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const name = target === 'paper' ? 'Background color' : slot === null ? 'New color' : `Color ${slot + 1}`;
  const panel = (
    <div
      ref={ref}
      className="pop color-panel"
      role="dialog"
      aria-label={name}
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        maxHeight: pos?.maxHeight,
        visibility: pos ? undefined : 'hidden',
      }}
    >
      {target === 'paper' && (
        <div className="paper-head">
          <div className="paper-choices">
            {PAPERS.map((p) => (
              <button
                key={p ?? 'none'}
                type="button"
                className="chip"
                style={{
                  height: 30,
                  padding: '0 9px',
                  fontSize: 12,
                  ...(paper === p ? null : { background: 'var(--sunken)' }),
                }}
                data-active={paper === p || undefined}
                onClick={() => set(p)}
              >
                <span
                  className={`swatch-sm ${p ? '' : 'swatch-clear'}`}
                  style={{
                    width: 14,
                    height: 14,
                    ...(p ? { background: p } : {}),
                  }}
                />
                {p === null ? 'Clear' : p === '#ffffff' ? 'White' : p === '#111111' ? 'Black' : 'Paper'}
              </button>
            ))}
          </div>
          <PaperPreview />
        </div>
      )}
      <Picker color={value} onChange={set} />
      <div className="basic-grid">
        {BASIC_COLORS.map((c) => (
          <button key={c} type="button" className="basic-dot" style={{ background: c }} aria-label={c} data-active={(chosen && value.toLowerCase() === c) || undefined} onClick={() => set(c)} />
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          className="field field-sm"
          value={text}
          aria-label="Hex color"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex) set(hex);
          }}
          onBlur={() => setText(value)}
          onKeyDown={(e) => e.key === 'Enter' && useUi.setState({ colorPanel: null })}
        />
        {target !== 'paper' && slot !== null && target !== 'new' && (
          <>
            <button type="button" className="chip" style={{ height: 34, padding: '0 9px' }} aria-expanded={more} onClick={() => setMore(!more)}>
              Sets
              <ChevronDown
                style={{
                  width: 14,
                  height: 14,
                  transform: more ? 'rotate(180deg)' : undefined,
                  transition: 'transform 160ms var(--ease-out)',
                }}
              />
            </button>
            <button
              type="button"
              className="ib"
              style={{ width: 34, height: 34 }}
              aria-label="Remove color"
              title="Remove color"
              disabled={palette.length <= 1}
              onClick={() => removeSwatch(slot)}
            >
              <Trash2 style={{ width: 16, height: 16 }} />
            </button>
          </>
        )}
      </div>
      {more && target !== 'paper' && target !== 'new' && (
        <div className="pt-2">
          <div className="grid grid-cols-2 gap-1" role="group" aria-label="Color sets">
            {PALETTES.map((p) => (
              <button
                key={p.name}
                type="button"
                className="menu-item"
                style={{
                  minHeight: 34,
                  padding: '0 6px',
                  gap: 6,
                  fontSize: 12.5,
                  background: 'var(--sunken)',
                }}
                onClick={() => {
                  live.commit();
                  usePalette(p.colors);
                  useUi.setState({ colorPanel: null });
                }}
              >
                <span className="flex shrink-0">
                  {p.colors.map((c, i) => (
                    <span
                      key={i}
                      className="swatch-sm"
                      style={{
                        background: c,
                        width: 13,
                        height: 13,
                        marginLeft: i ? -4 : 0,
                        boxShadow: 'inset 0 0 0 1px var(--swatch-ring)',
                      }}
                    />
                  ))}
                </span>
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
  return (
    <>
      <span ref={marker} hidden />
      {createPortal(panel, document.body)}
    </>
  );
}
