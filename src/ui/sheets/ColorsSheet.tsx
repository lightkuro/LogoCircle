import { useEffect, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { PALETTES, PAPERS } from '@/model/doc';
import { Sheet } from '../primitives';
import { useLiveEdit } from '../live';

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(v: string): string | null {
  const m = HEX.exec(v.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return `#${h}`;
}

function Picker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="picker" data-vaul-no-drag>
      <HexColorPicker color={value} onChange={onChange} />
      <input
        className="field mt-3"
        value={text}
        aria-label="Hex color"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        maxLength={7}
        onChange={(e) => {
          setText(e.target.value);
          const hex = normalizeHex(e.target.value);
          if (hex) onChange(hex);
        }}
        onBlur={() => setText(value)}
      />
    </div>
  );
}

export function ColorsSheet() {
  const open = useUi((s) => s.sheet === 'colors');
  const editing = useUi((s) => s.editing);
  const palette = useDoc((s) => s.doc.palette);
  const paper = useDoc((s) => s.doc.paper);
  const mode = useUi((s) => s.mode);
  const live = useLiveEdit();
  const close = (): void => {
    live.commit();
    useUi.setState({ sheet: null });
  };
  // One undo step per swatch edited.
  useEffect(() => () => live.commit(), [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const slots = mode === 'advanced' ? palette.length : Math.min(3, palette.length);
  const title = editing === 'paper' ? 'Paper' : typeof editing === 'number' ? `Color ${editing + 1}` : 'Colors';

  return (
    <Sheet open={open} onClose={close} title={title}>
      <div className="flex items-center gap-2 pb-3">
        {palette.slice(0, slots).map((c, i) => (
          <button
            key={i}
            type="button"
            className="swatch"
            style={{ height: 44 }}
            data-active={editing === i}
            aria-label={`Edit color ${i + 1}`}
            onClick={() => useUi.setState({ editing: i })}
          >
            <span className="swatch-dot" style={{ background: c }} />
          </button>
        ))}
        <span className="sep" style={{ height: 28, alignSelf: 'center' }} />
        <button type="button" className="chip" data-active={editing === 'paper'} onClick={() => useUi.setState({ editing: 'paper' })}>
          <span className={`swatch-sm ${paper ? '' : 'swatch-clear'}`} style={paper ? { background: paper } : undefined} />
          Paper
        </button>
      </div>

      {typeof editing === 'number' && palette[editing] !== undefined && (
        <Picker
          value={palette[editing]!}
          onChange={(hex) => live.change((doc) => ({ ...doc, palette: doc.palette.map((c, i) => (i === editing ? hex : c)), updatedAt: Date.now() }))}
        />
      )}

      {editing === 'paper' && (
        <>
          <div className="flex flex-wrap gap-2 pb-3">
            {PAPERS.map((p) => (
              <button
                key={p ?? 'none'}
                type="button"
                className="chip"
                style={{ background: 'var(--sunken)' }}
                data-active={paper === p}
                onClick={() => live.change((doc) => ({ ...doc, paper: p, updatedAt: Date.now() }))}
              >
                <span className={`swatch-sm ${p ? '' : 'swatch-clear'}`} style={p ? { background: p } : undefined} />
                {p === null ? 'Transparent' : p === '#ffffff' ? 'White' : p === '#111111' ? 'Black' : 'Cream'}
              </button>
            ))}
          </div>
          <Picker value={paper ?? '#ffffff'} onChange={(hex) => live.change((doc) => ({ ...doc, paper: hex, updatedAt: Date.now() }))} />
        </>
      )}

      <div className="label">Palettes</div>
      <div className="grid grid-cols-2 gap-2">
        {PALETTES.map((p) => {
          const active = p.colors.every((c, i) => palette[i]?.toLowerCase() === c);
          return (
            <button
              key={p.name}
              type="button"
              className="row-btn"
              style={{ background: active ? 'var(--accent-soft)' : 'var(--sunken)', minHeight: 52 }}
              onClick={() => {
                live.commit();
                const st = useDoc.getState();
                const next = [...st.doc.palette];
                p.colors.forEach((c, i) => (next[i] = c));
                st.commit({ ...st.doc, palette: next, updatedAt: Date.now() });
              }}
            >
              <span className="flex">
                {p.colors.map((c, i) => (
                  <span key={i} className="swatch-sm" style={{ background: c, marginLeft: i ? -6 : 0, boxShadow: '0 0 0 2px var(--surface-solid)' }} />
                ))}
              </span>
              <span className="text-[14px] font-semibold">{p.name}</span>
            </button>
          );
        })}
      </div>
      <p className="mb-0 mt-3 text-[12.5px] leading-snug text-muted">
        Swatches are linked: change one and everything painted with it follows.
      </p>
    </Sheet>
  );
}
