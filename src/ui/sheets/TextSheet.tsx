import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ringsToPath } from '@/geom';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { resolveFill } from '@/model/doc';
import { commitText } from '@/actions';
import { DEFAULT_FONT } from '@/text/fonts';
import { addCustomFont, allFonts, ensureCssFont } from '@/text/load';
import type { Layout } from '@/text/layout';
import { Sheet, Slider } from '../primitives';

const SAMPLE = 'Logo';

function Preview({ value, fontId, spacing, color }: { value: string; fontId: string; spacing: number; color: string }) {
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void import('@/text/layout')
        .then((m) => m.layoutText(value.trim() || SAMPLE, fontId, 100, spacing))
        .then((l) => alive && setLayout(l))
        .catch(() => alive && setLayout(null));
    }, 60);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [value, fontId, spacing]);
  const d = useMemo(() => (layout ? layout.glyphs.map((g) => ringsToPath(g.rings, 1)).join('') : ''), [layout]);
  const w = Math.max(40, layout?.width ?? 200);
  const asc = layout?.ascent ?? 100;
  const desc = layout?.descent ?? -25;
  return (
    <div className="flex items-center justify-center rounded-2xl bg-sunken" style={{ height: 112, padding: 14 }}>
      <svg viewBox={`${-6} ${-asc} ${w + 12} ${asc - desc}`} style={{ maxWidth: '100%', maxHeight: '100%' }} aria-label="Preview">
        <path d={d} fill={color} opacity={value.trim() ? 1 : 0.28} />
      </svg>
    </div>
  );
}

export function TextSheet() {
  const open = useUi((s) => s.sheet === 'text');
  const target = useUi((s) => s.textTarget);
  const mode = useUi((s) => s.mode);
  const ink = useUi((s) => s.ink);
  const doc = useDoc((s) => s.doc);
  const existing = target ? doc.groups[target]?.text : undefined;

  const [value, setValue] = useState('');
  const [fontId, setFontId] = useState(DEFAULT_FONT);
  const [size, setSize] = useState(220);
  const [spacing, setSpacing] = useState(0);
  const [fill, setFill] = useState<number | string>(0);
  const [busy, setBusy] = useState(false);
  const [fonts, setFonts] = useState(allFonts);
  const input = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(existing?.value ?? '');
    setFontId(existing?.fontId ?? fontId);
    setSize(existing?.size ?? 220);
    setSpacing(existing?.spacing ?? 0);
    setFill(existing?.fill ?? (typeof ink === 'number' ? ink : 0));
    setFonts(allFonts());
    const t = setTimeout(() => input.current?.focus(), 120);
    return () => clearTimeout(t);
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  const close = (): void => useUi.setState({ sheet: null, textTarget: null });
  const submit = async (): Promise<void> => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      const ok = await commitText({ value, fontId, size, spacing, fill }, target);
      if (ok) close();
    } catch {
      toast.error('That font could not be loaded. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const swatches = mode === 'advanced' ? doc.palette : doc.palette.slice(0, 3);

  return (
    <Sheet open={open} onClose={close} title={existing ? 'Edit text' : 'Add text'}>
      <Preview value={value} fontId={fontId} spacing={spacing} color={resolveFill(doc, fill)} />
      <input
        ref={input}
        className="field mt-3"
        placeholder="Type a word"
        value={value}
        maxLength={40}
        enterKeyHint="done"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Text"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />

      <div className="label">Font</div>
      <div className="scroll-x -mx-[18px] flex gap-2 px-[18px] pb-1" data-vaul-no-drag>
        {fonts.map((f) => (
          <button
            key={f.id}
            type="button"
            className="row-btn"
            aria-pressed={fontId === f.id}
            style={{
              width: 'auto',
              flexShrink: 0,
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
              padding: '8px 14px',
              minWidth: 96,
              background: fontId === f.id ? 'var(--accent-soft)' : 'var(--sunken)',
              boxShadow: fontId === f.id ? 'inset 0 0 0 1.5px var(--accent)' : undefined,
            }}
            onClick={() => setFontId(f.id)}
          >
            <span style={{ fontFamily: `'${ensureCssFont(f)}', system-ui`, fontSize: 24, lineHeight: 1.15, whiteSpace: 'nowrap' }}>Aa</span>
            <span className="whitespace-nowrap text-[11.5px] font-medium text-muted">{f.name}</span>
          </button>
        ))}
        {mode === 'advanced' && (
          <button type="button" className="row-btn" style={{ width: 'auto', flexShrink: 0, background: 'var(--sunken)', padding: '8px 14px' }} onClick={() => file.current?.click()}>
            <Upload />
            <span className="whitespace-nowrap text-[13px]">Your font</span>
          </button>
        )}
      </div>
      <input
        ref={file}
        type="file"
        accept=".ttf,.otf,.woff"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const def = await addCustomFont(f);
            setFonts(allFonts());
            setFontId(def.id);
          } catch {
            toast.error('That file is not a font this app can read (TTF, OTF or WOFF).');
          }
        }}
      />

      <div className="label">Size</div>
      <Slider label="Size" min={40} max={480} step={2} value={size} onChange={setSize} format={(v) => String(v)} />
      <div className="label">Letter spacing</div>
      <Slider label="Letter spacing" min={-8} max={40} value={Math.round(spacing * 100)} onChange={(v) => setSpacing(v / 100)} format={(v) => `${v}`} />

      <div className="label">Color</div>
      <div className="flex gap-1">
        {swatches.map((c, i) => (
          <button key={i} type="button" className="swatch" style={{ height: 44 }} data-active={fill === i} aria-label={`Color ${i + 1}`} onClick={() => setFill(i)}>
            <span className="swatch-dot" style={{ background: c }} />
          </button>
        ))}
      </div>

      <button type="button" className="btn mt-4 w-full" data-variant="primary" data-size="lg" disabled={!value.trim() || busy} onClick={() => void submit()}>
        {existing ? 'Update' : 'Add to canvas'}
      </button>
    </Sheet>
  );
}
