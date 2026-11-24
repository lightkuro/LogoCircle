import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Brush,
  ChevronLeft,
  Circle,
  ClipboardPaste,
  Crop,
  Ellipsis,
  Eye,
  Hand,
  Hexagon,
  ImagePlus,
  Lasso,
  Maximize,
  Minus,
  MousePointer2,
  MousePointerClick,
  PenTool,
  PaintBucket,
  Pencil,
  Plus,
  Scissors,
  SlidersHorizontal,
  Square,
  SquareDashed,
  Star,
  Triangle,
  Type,
} from 'lucide-react';
import { useDoc } from '@/store/doc';
import { remember, useUi, type SelectMode } from '@/store/ui';
import { buzz, useIsPhone, useIsSide, useIsTouch } from '@/store/settings';
import { useKeys } from '@/keys';
import { resolveFill } from '@/model/doc';
import { addOutline, addSwatch, editFrame, fitToScreen, openPhoto, pastePhoto, pickEraser, pickInk, pickPhoto, setTool, zoomBy, type AddKind } from '@/actions';
import { openSwatchMenu } from './menus';
import { ColorPanel } from './ColorPanel';
import { Tip } from './primitives';
import { CurveIcon, EraseIcon, LineIcon } from './icons';

interface Entry {
  id: string;
  label: string;
  icon: ReactNode;
  keys?: string;
  run: () => void;
  active?: boolean;
  /** Draw a divider above this entry in the list. */
  divide?: boolean;
  /** A switch rather than a tool: shows a check, and never becomes the button's face. */
  checked?: boolean;
}

const openText = (): void => useUi.setState({ sheet: 'text', textTarget: null, tool: 'arrange', erasing: false, colorPanel: null });

function Single({ entry }: { entry: Entry }) {
  return (
    <Tip label={entry.label} keys={entry.keys}>
      <button type="button" className="tool" aria-pressed={entry.active} data-active={entry.active || undefined} onClick={entry.run}>
        {entry.icon}
        <span>{entry.label}</span>
      </button>
    </Tip>
  );
}

/**
 * Several related tools behind one button, marked with a small arrow. A tap
 * opens the list. With a mouse, hovering opens it too, and clicking the button
 * itself picks the tool shown on it again.
 */
function Group({
  label,
  entries,
  icon,
  caret,
  out = 'up',
}: {
  label: string;
  entries: Entry[];
  icon?: ReactNode;
  caret?: boolean;
  /** Which way the list opens: up from a bar along the bottom, or sideways from a rail down an edge. */
  out?: 'up' | 'right' | 'left';
}) {
  const touch = useIsTouch();
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<number | null>(null);

  // A list is centred on its button (above it, or level with it out of a rail), and kept on the screen.
  useLayoutEffect(() => {
    if (!open || !list.current || !wrap.current) return setAt(null);
    const b = wrap.current.getBoundingClientRect();
    const pad = 8;
    if (out === 'up') {
      const w = list.current.offsetWidth;
      setAt(Math.max(pad, Math.min(b.left + b.width / 2 - w / 2, window.innerWidth - w - pad)) - b.left);
    } else {
      const h = list.current.offsetHeight;
      setAt(Math.max(pad, Math.min(b.top + b.height / 2 - h / 2, window.innerHeight - h - pad)) - b.top);
    }
  }, [open, out, entries.length]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activeIndex = entries.findIndex((e) => e.active);
  const shown = entries[activeIndex >= 0 ? activeIndex : Math.min(last, entries.length - 1)]!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pick = (i: number): void => {
    if (entries[i]!.checked === undefined) setLast(i);
    setOpen(false);
    entries[i]!.run();
  };

  return (
    <div
      ref={wrap}
      className="tool-group"
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(true), 140);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(false), 220);
      }}
    >
      <button
        type="button"
        className="tool tool-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-active={activeIndex >= 0 || undefined}
        onClick={() => {
          // Mouse: the list is already open from hovering, so a click means "this one again".
          if (!touch && open && !icon) pick(entries.indexOf(shown));
          else setOpen(!open);
        }}
      >
        {caret && (
          <svg className="tool-caret" data-open={open || undefined} viewBox="0 0 16 6" aria-hidden>
            <path d="M2 4.6 8 1.4l6 3.2" />
          </svg>
        )}
        {icon ?? shown.icon}
        <span>{label}</span>
      </button>
      {open && (
        <div
          ref={list}
          className="pop flyout"
          data-out={out}
          role="menu"
          aria-label={label}
          style={{ [out === 'up' ? 'left' : 'top']: at ?? 0, visibility: at === null ? 'hidden' : undefined }}
        >
          {entries.map((e, i) => (
            <div key={e.id}>
              {e.divide && <div className="menu-sep" />}
              <button
                type="button"
                role={e.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={e.checked}
                className="menu-item"
                data-active={e.active || undefined}
                onClick={() => pick(i)}
              >
                {e.icon}
                {e.label}
                {e.keys && <kbd>{e.keys}</kbd>}
                {e.checked !== undefined && <span className="menu-switch" data-on={e.checked || undefined} aria-hidden />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Swatch({ index, color, last }: { index: number; color: string; last: boolean }) {
  const key = useKeys();
  const active = useUi((s) => (s.tool === 'color' || s.tool === 'brush' || s.tool === 'draw' || s.tool === 'pen') && !s.erasing && s.ink === index);
  const panel = useUi((s) => s.colorPanel === index);
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);
  return (
    <div className="swatch-wrap">
      <Tip label={`Color ${index + 1}`} keys={key(`color${index + 1}`)}>
        <button
          type="button"
          className="swatch"
          data-swatch
          aria-label={`Color ${index + 1}`}
          aria-pressed={active}
          data-active={active}
          onClick={() => {
            if (held.current) return void (held.current = false);
            pickInk(index);
          }}
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse') return;
            const at = { x: e.clientX, y: e.clientY };
            held.current = false;
            clearTimeout(hold.current);
            hold.current = setTimeout(() => {
              held.current = true;
              buzz();
              openSwatchMenu(at, index, true);
            }, 520);
          }}
          onPointerUp={() => clearTimeout(hold.current)}
          onPointerLeave={() => clearTimeout(hold.current)}
          onPointerCancel={() => clearTimeout(hold.current)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!held.current) openSwatchMenu({ x: e.clientX, y: e.clientY }, index);
          }}
        >
          <span className="swatch-dot" style={{ background: color }} />
          <span className="swatch-num">{index + 1}</span>
        </button>
      </Tip>
      {panel && <ColorPanel target={index} align={last ? 'end' : undefined} />}
    </div>
  );
}

function Colors() {
  const palette = useDoc((s) => s.doc.palette);
  const mode = useUi((s) => s.mode);
  const paperPanel = useUi((s) => s.colorPanel === 'paper');
  const limit = mode === 'classic' ? 4 : 24;
  const shown = palette.slice(0, limit);
  return (
    <>
      {shown.map((c, i) => (
        <Swatch key={i} index={i} color={c} last={i >= shown.length - 1 && i > 1} />
      ))}
      {palette.length < limit && (
        <Tip label="Add a color">
          <button type="button" className="swatch" data-swatch aria-label="Add a color" onClick={addSwatch}>
            <span className="swatch-dot flex items-center justify-center" style={{ background: 'var(--sunken)', boxShadow: 'inset 0 0 0 1px var(--border-strong)' }}>
              <Plus style={{ width: 15, height: 15 }} />
            </span>
          </button>
        </Tip>
      )}
      {/* The paper's color panel opens here, beside the colors, wherever it was asked for. */}
      <div className="swatch-wrap paper-anchor">{paperPanel && <ColorPanel target="paper" align="end" />}</div>
    </>
  );
}

/**
 * Phones: the colors run down the left edge, out of the way of the tools, and
 * fold away to a single dot.
 */
export function ColorStrip() {
  // A color being edited needs its panel, and the panel lives in the strip: unfold for it.
  const folded = useUi((s) => s.colorsFolded && s.colorPanel === null);
  const ink = useUi((s) => s.ink);
  const erasing = useUi((s) => s.tool === 'color' && s.erasing);
  const palette = useDoc((s) => s.doc.palette);
  const fold = (v: boolean): void => {
    useUi.setState({ colorsFolded: v, colorPanel: null });
    remember('lc.colorsFolded', v ? '1' : '');
  };
  if (folded) {
    return (
      <div className="color-strip-area">
        <button type="button" className="glass color-fold" aria-label="Show the colors" aria-expanded={false} onClick={() => fold(false)}>
          {erasing ? <EraseIcon /> : <span className="swatch-dot" style={{ background: resolveFill({ palette }, ink) }} />}
        </button>
      </div>
    );
  }
  return (
    <div className="color-strip-area">
      <div className="glass color-strip" role="toolbar" aria-label="Colors" aria-orientation="vertical">
        <Colors />
        <button type="button" className="strip-fold" aria-label="Hide the colors" aria-expanded onClick={() => fold(true)}>
          <ChevronLeft />
        </button>
      </div>
    </div>
  );
}

/** Everything the tool buttons offer, shared by the bottom dock and the side rails. */
function useEntries() {
  const touch = useIsTouch();
  const key = useKeys();
  const tool = useUi((s) => s.tool);
  const mode = useUi((s) => s.mode);
  const selectMode = useUi((s) => s.selectMode);
  const hasPhoto = useDoc((s) => s.doc.refs.length > 0);
  const erasing = useUi((s) => s.tool === 'color' && s.erasing);
  const showCuts = useUi((s) => s.showCuts);
  const advanced = mode === 'advanced';
  const arranging = tool === 'arrange';

  const select = (m: SelectMode) => (): void => useUi.setState({ selectMode: m, tool: 'arrange', erasing: false, colorPanel: null, frameEdit: false });
  const selects: Entry[] = [
    { id: 'move', label: 'Move', keys: key('move'), icon: <MousePointer2 />, run: select('move'), active: arranging && selectMode === 'move' ? false : undefined },
    { id: 'pan', label: 'Pan', keys: touch ? undefined : 'Space', icon: <Hand />, run: select('pan'), active: arranging && selectMode === 'pan' },
    { id: 'box', label: 'Box select', keys: touch ? undefined : 'Shift drag', icon: <SquareDashed />, run: select('box'), active: arranging && selectMode === 'box' },
    { id: 'lasso', label: 'Lasso select', icon: <Lasso />, run: select('lasso'), active: arranging && selectMode === 'lasso' },
    { id: 'single', label: 'One at a time', icon: <MousePointerClick />, run: select('single'), active: arranging && selectMode === 'single' },
  ];
  const add = (kind: AddKind) => (): void => addOutline(kind);
  const shapes: Entry[] = [
    { id: 'circle', label: 'Circle', keys: key('circle'), icon: <Circle />, run: add('circle') },
    { id: 'rect', label: 'Square', keys: key('square'), icon: <Square />, run: add('rect') },
    { id: 'triangle', label: 'Triangle', icon: <Triangle />, run: add('triangle') },
    { id: 'polygon', label: 'Polygon', icon: <Hexagon />, run: add('polygon') },
    { id: 'star', label: 'Star', icon: <Star />, run: add('star') },
  ];
  const lines: Entry[] = [
    { id: 'line', label: 'Line', keys: key('line'), icon: <LineIcon />, run: add('line') },
    { id: 'curve', label: 'Curve', keys: key('curve'), icon: <CurveIcon />, run: add('curve') },
    { id: 'draw', label: 'Draw', keys: key('draw'), icon: <Pencil />, run: () => setTool('draw'), active: tool === 'draw' },
    { id: 'brush', label: 'Brush', keys: key('brush'), icon: <Brush />, run: () => setTool('brush'), active: tool === 'brush' },
    ...(advanced ? [{ id: 'pen', label: 'Pen', keys: key('pen'), icon: <PenTool />, run: () => setTool('pen'), active: tool === 'pen' }] : []),
  ];
  const photos: Entry[] = [
    { id: 'choose', label: hasPhoto && !advanced ? 'Choose another photo' : 'Choose a photo', keys: hasPhoto ? undefined : key('photo'), icon: <ImagePlus />, run: pickPhoto },
    { id: 'paste', label: 'Paste a photo', keys: key('paste'), icon: <ClipboardPaste />, run: () => void pastePhoto() },
    ...(hasPhoto && !advanced ? [{ id: 'controls', label: 'Photo settings', keys: key('photo'), icon: <SlidersHorizontal />, run: openPhoto }] : []),
  ];
  const cuts: Entry[] = [
    { id: 'cut', label: 'Cut', keys: key('cut'), icon: <Scissors />, run: () => setTool('cut'), active: tool === 'cut' },
    { id: 'erase', label: 'Erase', keys: key('erase'), icon: <EraseIcon />, run: pickEraser, active: erasing },
    { id: 'marks', label: 'Show cut lines', icon: <Eye />, run: () => useUi.setState({ showCuts: !showCuts }), checked: showCuts, divide: true },
  ];
  // Phones: the things reached for less often share one button.
  const more: Entry[] = [
    ...photos,
    { id: 'paper', label: 'Background color', icon: <PaintBucket />, run: () => useUi.setState({ colorPanel: 'paper' }), divide: true },
    { id: 'frame', label: 'Export frame', icon: <Crop />, run: () => editFrame(true) },
    { id: 'fit', label: 'Zoom to fit', icon: <Maximize />, run: () => fitToScreen() },
  ];

  return { key, selects, shapes, lines, cuts, photos, more };
}

export function Dock() {
  const phone = useIsPhone();
  const side = useIsSide();
  const { key, selects, shapes, lines, cuts, more } = useEntries();
  const text: Entry = { id: 'text', label: 'Text', keys: key('text'), icon: <Type />, run: openText };

  if (side) {
    // A phone on its side: the tools run down the left edge, Select sits with the zoom on the right.
    return (
      <div className="glass dock rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
        <Single entry={text} />
        <Group label="Shapes" entries={shapes} caret out="right" />
        <Group label="Lines" entries={lines} caret out="right" />
        <Group label="Cut" entries={cuts} caret out="right" />
        <Group label="More" entries={more} icon={<Ellipsis />} out="right" />
      </div>
    );
  }

  return (
    <div className="glass dock" role="toolbar" aria-label="Tools">
      <Single entry={text} />
      <Group label="Shapes" entries={shapes} caret />
      <Group label="Lines" entries={lines} caret />
      <Group label="Cut" entries={cuts} caret />
      {!phone && (
        <>
          <span className="sep" />
          <Colors />
          <span className="sep" />
        </>
      )}
      <Group label="Select" entries={selects} />
      <Group label="More" entries={more} icon={<Ellipsis />} />
    </div>
  );
}

/** A phone on its side: Select and the zoom, in one column down the right edge. */
export function SideControls() {
  const { selects } = useEntries();
  const k = useUi((s) => s.view.k);
  return (
    <div className="glass rail side-controls" role="toolbar" aria-label="Select and zoom" aria-orientation="vertical">
      <Group label="Select" entries={selects} out="left" />
      <span className="sep" />
      <button type="button" className="ib" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
        <Plus />
      </button>
      <button type="button" className="rail-zoom" aria-label="Fit to screen" onClick={() => fitToScreen()}>
        {Math.round(k * 100)}%
      </button>
      <button type="button" className="ib" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
        <Minus />
      </button>
    </div>
  );
}
