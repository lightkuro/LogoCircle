import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import '@/styles/text.css';
import { ringsToPath } from '@/geom';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { resolveFill } from '@/model/doc';
import { commitText } from '@/actions';
import { DEFAULT_FONT, FONTS, FONT_KINDS, type FontDef, type FontKind } from '@/text/fonts';
import { addCustomFont, cssFontLoaded, cssFontReady, customFonts, cssFamily, isCustomFont, removeCustomFont, restoreCustomFonts } from '@/text/load';
import type { Layout } from '@/text/layout';
import { Sheet, Slider } from '../primitives';

/** What the previews say until a word has been typed. */
const PLACEHOLDER = 'Test';
const POPULAR = FONTS.filter((f) => f.popular);
const MORE = FONTS.filter((f) => !f.popular);

const lastFont = (): string => {
  try {
    const id = localStorage.getItem('lc.font');
    if (id && (FONTS.some((f) => f.id === id) || isCustomFont(id))) return id;
  } catch {
    /* private mode */
  }
  return DEFAULT_FONT;
};

// --- one observer for every tile: a font file is fetched when its tile comes into view ---

let observer: IntersectionObserver | null = null;
const waiting = new WeakMap<Element, () => void>();

function whenVisible(el: Element, run: () => void): () => void {
  if (typeof IntersectionObserver !== 'function') {
    run();
    return () => undefined;
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const cb = waiting.get(entry.target);
        waiting.delete(entry.target);
        observer!.unobserve(entry.target);
        cb?.();
      }
    },
    { rootMargin: '140px 0px' },
  );
  waiting.set(el, run);
  observer.observe(el);
  return () => {
    waiting.delete(el);
    observer?.unobserve(el);
  };
}

const FontTile = memo(function FontTile({
  def,
  word,
  active,
  onPick,
  onRemove,
}: {
  def: FontDef;
  word: string;
  active: boolean;
  onPick: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // null = still loading, '' = could not load (falls back to the system font)
  const [family, setFamily] = useState<string | null>(() => (cssFontLoaded(def) ? cssFamily(def) : null));

  useEffect(() => {
    if (family !== null || !ref.current) return;
    let alive = true;
    const stop = whenVisible(ref.current, () => {
      cssFontReady(def).then(
        (f) => alive && setFamily(f),
        () => alive && setFamily(''),
      );
    });
    return () => {
      alive = false;
      stop();
    };
  }, [def, family]);

  return (
    <div className="tx-tile">
      <button ref={ref} type="button" className="tx-font" aria-pressed={active} aria-label={def.name} title={def.name} onClick={() => onPick(def.id)}>
        <span className="tx-font-word" data-ready={family !== null} style={{ fontFamily: family ? `'${family}', system-ui, sans-serif` : undefined }} aria-hidden>
          {word}
        </span>
        <span className="tx-font-name">{def.name}</span>
      </button>
      {family === null && <span className="tx-font-wait" aria-hidden />}
      {onRemove && (
        <button type="button" className="tx-remove" aria-label={`Remove ${def.name}`} onClick={() => onRemove(def.id)}>
          <X />
        </button>
      )}
    </div>
  );
});

/** The word as it will land on the canvas, on the canvas's own background. */
function Preview({ value, fontId, spacing, color, paper }: { value: string; fontId: string; spacing: number; color: string; paper: string | null }) {
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void import('@/text/layout')
        .then((m) => m.layoutText(value.trim() || PLACEHOLDER, fontId, 100, spacing))
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
    <div className={`tx-preview${paper ? '' : ' tx-checker'}`} style={paper ? { background: paper } : undefined} data-paper={paper ?? 'none'}>
      <svg viewBox={`${-6} ${-asc} ${w + 12} ${asc - desc}`} aria-label="Preview">
        <path d={d} fill={color} opacity={value.trim() ? 1 : 0.3} />
      </svg>
    </div>
  );
}

export function TextSheet() {
  const open = useUi((s) => s.sheet === 'text');
  const target = useUi((s) => s.textTarget);
  const ink = useUi((s) => s.ink);
  const palette = useDoc((s) => s.doc.palette);
  const paper = useDoc((s) => s.doc.paper);
  const existing = useDoc((s) => (target ? s.doc.groups[target]?.text : undefined));

  const [value, setValue] = useState('');
  const [fontId, setFontId] = useState(lastFont);
  const [size, setSize] = useState(220);
  const [spacing, setSpacing] = useState(0);
  const [fill, setFill] = useState<number | string>(0);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<FontDef[]>(customFonts);
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FontKind | 'all'>('all');
  const input = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const font = existing?.fontId ?? fontId;
    setValue(existing?.value ?? '');
    setFontId(font);
    setSize(existing?.size ?? 220);
    setSpacing(existing?.spacing ?? 0);
    setFill(existing?.fill ?? (typeof ink === 'number' && ink < palette.length ? ink : 0));
    setQuery('');
    setKind('all');
    // A font from the long list stays in sight when the sheet reopens.
    setMore(MORE.some((f) => f.id === font));
    setMine(customFonts());
    void restoreCustomFonts().then(setMine);
    const t = setTimeout(() => input.current?.focus(), 120);
    return () => clearTimeout(t);
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  const pick = (id: string): void => {
    setFontId(id);
    try {
      localStorage.setItem('lc.font', id);
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  };

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

  const upload = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    try {
      const def = await addCustomFont(f);
      setMine(customFonts());
      pick(def.id);
    } catch {
      toast.error('That file is not a font this app can read (TTF, OTF or WOFF).');
    }
  };

  const remove = (id: string): void => {
    removeCustomFont(id);
    setMine(customFonts());
    if (fontId === id) pick(DEFAULT_FONT);
  };

  // The tiles show the word being typed, so fonts are compared on the real thing.
  const word = useMemo(() => {
    const t = value.trim();
    return t ? [...t].slice(0, 12).join('') : PLACEHOLDER;
  }, [value]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    // Searching looks through everything; browsing shows what is not already above.
    const pool = q ? [...mine, ...FONTS] : MORE;
    return pool.filter((f) => (kind === 'all' || f.kind === kind) && (!q || f.name.toLowerCase().includes(q)));
  }, [q, kind, mine]);

  const safeFill = typeof fill === 'number' && fill >= palette.length ? 0 : fill;

  return (
    <Sheet open={open} onClose={close} title={existing ? 'Edit text' : 'Add text'} place="left">
      <div className="tx-top">
        <Preview value={value} fontId={fontId} spacing={spacing} color={resolveFill({ palette }, safeFill)} paper={paper} />
        <input
          ref={input}
          className="field mt-2.5"
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
      </div>

      <div className="tx-row" style={{ marginTop: 4 }}>
        <span className="label">Font</span>
        <button type="button" className="tx-pill" onClick={() => file.current?.click()}>
          <Upload />
          Your font
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void upload(f);
        }}
      />

      <div className="tx-grid" role="group" aria-label="Fonts">
        {mine.map((f) => (
          <FontTile key={f.id} def={f} word={word} active={fontId === f.id} onPick={pick} onRemove={remove} />
        ))}
        {POPULAR.map((f) => (
          <FontTile key={f.id} def={f} word={word} active={fontId === f.id} onPick={pick} />
        ))}
      </div>

      <button type="button" className="tx-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
        <span>
          More fonts <small>· {MORE.length} to choose from</small>
        </span>
        <ChevronDown />
      </button>

      {more && (
        <>
          <div className="tx-search">
            <Search />
            <input
              className="field"
              type="search"
              placeholder={`Search all ${FONTS.length + mine.length} fonts`}
              value={query}
              aria-label="Search fonts"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </div>
          <div className="tx-kinds" role="group" aria-label="Kind of font">
            <button type="button" className="tx-pill" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
              All
            </button>
            {FONT_KINDS.map((k) => (
              <button key={k.kind} type="button" className="tx-pill" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
                {k.label}
              </button>
            ))}
          </div>
          {results.length ? (
            <div className="tx-grid" role="group" aria-label="More fonts">
              {results.map((f) => (
                <FontTile key={f.id} def={f} word={word} active={fontId === f.id} onPick={pick} />
              ))}
            </div>
          ) : (
            <p className="tx-empty">No font by that name here. “Your font” adds one from a file.</p>
          )}
        </>
      )}

      <div className="label">Size</div>
      <Slider label="Size" min={40} max={480} step={2} typeMax={1200} value={size} onChange={setSize} format={(v) => String(Math.round(v))} />
      <div className="label">Letter spacing</div>
      <Slider
        label="Letter spacing"
        min={-8}
        max={40}
        typeMax={200}
        value={Math.round(spacing * 100)}
        onChange={(v) => setSpacing(v / 100)}
        format={(v) => String(Math.round(v))}
      />

      <div className="label">Color</div>
      <div className="tx-colors" role="group" aria-label="Color">
        {palette.map((c, i) => (
          <button key={i} type="button" className="tx-color" aria-pressed={safeFill === i} aria-label={`Color ${i + 1}`} onClick={() => setFill(i)}>
            <span className="tx-color-dot" style={{ background: c }} />
            <span aria-hidden>{i + 1}</span>
          </button>
        ))}
      </div>

      <div className="tx-foot">
        <button type="button" className="btn w-full" data-variant="primary" data-size="lg" disabled={!value.trim() || busy} onClick={() => void submit()}>
          {existing ? 'Update' : 'Add to canvas'}
        </button>
      </div>
    </Sheet>
  );
}
