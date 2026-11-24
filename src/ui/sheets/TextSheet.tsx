import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { useIsPhone, useLayoutKind } from '@/store/settings';
import { Segmented, Sheet, Slider } from '../primitives';

/** The pages of the phone panel. */
type Page = 'font' | 'size' | 'color';

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

/** The word as it will land on the canvas, on the canvas's own background. Bigger sizes show bigger. */
function Preview({ value, fontId, spacing, size, color, paper }: { value: string; fontId: string; spacing: number; size: number; color: string; paper: string | null }) {
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
  // From half the box at the smallest size to all of it at the largest on the slider.
  const k = 0.5 + 0.5 * Math.max(0, Math.min(1, (size - 40) / 440));
  return (
    <div className={`tx-preview${paper ? '' : ' tx-checker'}`} style={paper ? { background: paper } : undefined} data-paper={paper ?? 'none'}>
      <svg viewBox={`${-6} ${-asc} ${w + 12} ${asc - desc}`} style={{ height: `${Math.round(k * 100)}%` }} aria-label="Preview">
        <path d={d} fill={color} />
      </svg>
    </div>
  );
}

/** How much of the bottom of the screen the on-screen keyboard is covering. */
function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return void setInset(0);
    const update = (): void => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return inset;
}

/**
 * Phones: a panel that takes the lower half of the screen and leaves the
 * canvas in view. Pull it up (or tap its grip) for the whole thing; pull it
 * down to put it away.
 */
function HalfPanel({
  side = false,
  open,
  title,
  onClose,
  expanded,
  onExpanded,
  top,
  children,
  bodyRef,
}: {
  /** A phone on its side: a full-height panel down the left edge, nothing to pull. */
  side?: boolean;
  open: boolean;
  title: string;
  onClose: () => void;
  expanded: boolean;
  onExpanded: (v: boolean) => void;
  top: ReactNode;
  children: ReactNode;
  bodyRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [pull, setPull] = useState<number | null>(null); // height in px while a finger is dragging the grip
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const keyboard = useKeyboardInset(mounted);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  const end = (e: React.PointerEvent): void => {
    const d = drag.current;
    drag.current = null;
    setPull(null);
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.moved) onExpanded(!expanded); // a tap on the grip
    else if (dy < -36) onExpanded(true);
    else if (dy > 36) expanded ? onExpanded(false) : onClose();
  };
  return (
    <>
      <div className="txp-away" data-shown={shown || undefined} onPointerDown={onClose} />
      <div
        ref={panel}
        className={side ? 'txp txp-side' : 'txp'}
        role="dialog"
        aria-label={title}
        data-shown={shown || undefined}
        data-expanded={expanded || undefined}
        data-pulling={pull !== null || undefined}
        style={
          side
            ? keyboard
              ? { bottom: keyboard + 8 }
              : undefined
            : { bottom: keyboard, ...(pull !== null ? { height: pull } : null), ...(keyboard ? { maxHeight: `calc(100dvh - ${keyboard}px - 8px)` } : null) }
        }
      >
        <div
          hidden={side}
          className="txp-handle"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, h: panel.current?.offsetHeight ?? 0, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const dy = e.clientY - d.y;
            if (Math.abs(dy) > 6) d.moved = true;
            if (d.moved) setPull(Math.max(120, Math.min(window.innerHeight * 0.94, d.h - dy)));
          }}
          onPointerUp={end}
          onPointerCancel={() => {
            drag.current = null;
            setPull(null);
          }}
        >
          <button type="button" className="txp-grip" aria-label={expanded ? 'Make the panel smaller' : 'Make the panel bigger'} aria-expanded={expanded} />
        </div>
        <div className="txp-top">{top}</div>
        <div className="txp-body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </>
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
  const phone = useIsPhone();
  // Phones get the compact panel: along the bottom when upright, down the left side when turned.
  const layout = useLayoutKind();
  const upright = layout === 'phone' || layout === 'side';
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState<Page>('font');
  const body = useRef<HTMLDivElement>(null);

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
    setExpanded(false);
    setPage('font');
    // A font from the long list stays in sight when the sheet reopens.
    setMore(MORE.some((f) => f.id === font));
    setMine(customFonts());
    void restoreCustomFonts().then(setMine);
    // On a phone the keyboard would cover the panel: it waits for a tap on the field.
    if (phone) return;
    const t = setTimeout(() => input.current?.focus(), 120);
    return () => clearTimeout(t);
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  const goTo = (p: Page): void => {
    setPage(p);
    body.current?.scrollTo({ top: 0 });
  };

  const pick = (id: string): void => {
    setFontId(id);
    try {
      localStorage.setItem('lc.font', id);
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  };

  const close = (): void => useUi.setState({ sheet: null, textTarget: null });
  // Nothing typed? Then it says "Test": a word to place now and change later.
  const text = value.trim() ? value : PLACEHOLDER;
  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await commitText({ value: text, fontId, size, spacing, fill }, target);
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

  const title = existing ? 'Edit text' : 'Add text';
  const add = (
    <button type="button" className="btn" data-variant="primary" data-size={upright ? undefined : 'lg'} style={upright ? { height: 46, flexShrink: 0 } : { width: '100%' }} disabled={busy} onClick={() => void submit()}>
      {existing ? 'Update' : upright ? 'Add' : 'Add to canvas'}
    </button>
  );
  const field = (
    <input
      ref={input}
      className="field"
      placeholder={PLACEHOLDER}
      value={value}
      maxLength={40}
      enterKeyHint="done"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      aria-label="Text"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        if (phone) e.currentTarget.blur();
        else void submit();
      }}
    />
  );
  const preview = <Preview value={value} fontId={fontId} spacing={spacing} size={size} color={resolveFill({ palette }, safeFill)} paper={paper} />;

  const ownFont = (
    <button type="button" className="tx-pill" onClick={() => file.current?.click()}>
      <Upload />
      Your font
    </button>
  );
  const fonts = (
    <>
      {!upright && (
        <div className="tx-row" style={{ marginTop: 4 }}>
          <span className="label">Font</span>
          {ownFont}
        </div>
      )}
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
          More fonts
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
            <p className="tx-empty">No font by that name here. Your font adds one from a file.</p>
          )}
        </>
      )}
      {upright && <div className="tx-row">{ownFont}</div>}
    </>
  );

  const sizeSlider = <Slider label="Size" min={40} max={480} step={2} typeMax={1200} value={size} onChange={setSize} format={(v) => String(Math.round(v))} />;
  const spacingSlider = (
    <Slider label="Letter spacing" min={-8} max={40} typeMax={200} value={Math.round(spacing * 100)} onChange={(v) => setSpacing(v / 100)} format={(v) => String(Math.round(v))} />
  );
  const sliders = upright ? (
    // Phones: one line each, so both fit in the half-height panel.
    <div className="txp-sliders">
      <div className="txp-slider">
        <span>Size</span>
        {sizeSlider}
      </div>
      <div className="txp-slider">
        <span>Spacing</span>
        {spacingSlider}
      </div>
    </div>
  ) : (
    <div>
      <div className="label">Size</div>
      {sizeSlider}
      <div className="label">Letter spacing</div>
      {spacingSlider}
    </div>
  );

  const colors = (
    <div className="tx-colors" role="group" aria-label="Color">
      {palette.map((c, i) => (
        <button key={i} type="button" className="tx-color" aria-pressed={safeFill === i} aria-label={`Color ${i + 1}`} onClick={() => setFill(i)}>
          <span className="tx-color-dot" style={{ background: c }} />
          <span aria-hidden>{i + 1}</span>
        </button>
      ))}
    </div>
  );

  if (upright) {
    return (
      <HalfPanel
        side={layout === 'side'}
        open={open}
        title={title}
        onClose={close}
        expanded={expanded}
        onExpanded={setExpanded}
        bodyRef={body}
        top={
          <>
            {preview}
            <div className="txp-entry">
              {field}
              {add}
            </div>
            <div className="txp-tabs">
              <Segmented<Page>
                label="Text settings"
                value={page}
                onChange={goTo}
                options={[
                  { value: 'font', label: 'Font' },
                  { value: 'color', label: 'Color' },
                  { value: 'size', label: 'Size' },
                ]}
              />
              <button type="button" className="ib" aria-label="Close" onClick={close}>
                <X />
              </button>
            </div>
          </>
        }
      >
        {page === 'font' ? fonts : page === 'size' ? sliders : colors}
      </HalfPanel>
    );
  }

  return (
    <Sheet open={open} onClose={close} title={title} place="left">
      <div className="tx-top">
        {preview}
        <div className="mt-2.5">{field}</div>
      </div>
      {fonts}
      {sliders}
      <div className="label">Color</div>
      {colors}
      <div className="tx-foot">{add}</div>
    </Sheet>
  );
}
