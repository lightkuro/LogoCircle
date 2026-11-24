import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { BASIC_COLORS, PALETTES, PAPERS } from '@/model/doc';
import { removeSwatch, usePalette } from '@/actions';
import { useLiveEdit } from './live';

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(v: string): string | null {
  const m = HEX.exec(v.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return `#${h}`;
}

/**
 * The small panel that opens above a swatch: a picker, a few plain colors and
 * a hex field. Color sets live one step further, under More.
 */
export function ColorPanel({ target, align }: { target: number | 'paper'; align?: 'end' }) {
  const palette = useDoc((s) => s.doc.palette);
  const paper = useDoc((s) => s.doc.paper);
  const live = useLiveEdit();
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const value = target === 'paper' ? (paper ?? '#ffffff') : (palette[target] ?? '#000000');
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  const set = (hex: string | null): void =>
    live.change((doc) =>
      target === 'paper'
        ? { ...doc, paper: hex, updatedAt: Date.now() }
        : { ...doc, palette: doc.palette.map((c, i) => (i === target ? (hex ?? c) : c)), updatedAt: Date.now() },
    );

  // Keep the whole panel on screen, whichever way it opened.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.translate = '';
    const r = el.getBoundingClientRect();
    const pad = 8;
    const dy = r.top < pad ? pad - r.top : r.bottom > window.innerHeight - pad ? window.innerHeight - pad - r.bottom : 0;
    const dx = r.left < pad ? pad - r.left : r.right > window.innerWidth - pad ? window.innerWidth - pad - r.right : 0;
    if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
  }, [target, more]);

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

  return (
    <div ref={ref} className="pop color-panel" data-align={align} role="dialog" aria-label={target === 'paper' ? 'Paper color' : `Color ${target + 1}`}>
      {target === 'paper' && (
        <div className="flex flex-wrap gap-1 pb-2">
          {PAPERS.map((p) => (
            <button
              key={p ?? 'none'}
              type="button"
              className="chip"
              style={{ height: 30, padding: '0 9px', fontSize: 12, background: 'var(--sunken)' }}
              data-active={paper === p || undefined}
              onClick={() => set(p)}
            >
              <span className={`swatch-sm ${p ? '' : 'swatch-clear'}`} style={{ width: 14, height: 14, ...(p ? { background: p } : {}) }} />
              {p === null ? 'Clear' : p === '#ffffff' ? 'White' : p === '#111111' ? 'Black' : 'Cream'}
            </button>
          ))}
        </div>
      )}
      <HexColorPicker color={value} onChange={set} />
      <div className="basic-grid">
        {BASIC_COLORS.map((c) => (
          <button key={c} type="button" className="basic-dot" style={{ background: c }} aria-label={c} data-active={value.toLowerCase() === c || undefined} onClick={() => set(c)} />
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
        {target !== 'paper' && (
          <>
            <button type="button" className="chip" style={{ height: 34, padding: '0 9px' }} aria-expanded={more} onClick={() => setMore(!more)}>
              More
              <ChevronDown style={{ width: 14, height: 14, transform: more ? 'rotate(180deg)' : undefined, transition: 'transform 160ms var(--ease-out)' }} />
            </button>
            <button
              type="button"
              className="ib"
              style={{ width: 34, height: 34 }}
              aria-label="Remove color"
              title="Remove this color"
              disabled={palette.length <= 1}
              onClick={() => removeSwatch(target)}
            >
              <Trash2 style={{ width: 16, height: 16 }} />
            </button>
          </>
        )}
      </div>
      {more && target !== 'paper' && (
        <div className="pt-2">
          <div className="pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Color sets</div>
          <div className="grid grid-cols-2 gap-1">
            {PALETTES.map((p) => (
              <button
                key={p.name}
                type="button"
                className="menu-item"
                style={{ minHeight: 34, padding: '0 6px', gap: 6, fontSize: 12.5, background: 'var(--sunken)' }}
                onClick={() => {
                  live.commit();
                  usePalette(p.colors);
                  useUi.setState({ colorPanel: null });
                }}
              >
                <span className="flex shrink-0">
                  {p.colors.map((c, i) => (
                    <span key={i} className="swatch-sm" style={{ background: c, width: 13, height: 13, marginLeft: i ? -4 : 0, boxShadow: '0 0 0 1.5px var(--surface-solid), inset 0 0 0 1px var(--swatch-ring)' }} />
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
}
