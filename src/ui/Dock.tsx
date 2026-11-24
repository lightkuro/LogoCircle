import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardPaste,
  Crop,
  Ellipsis,
  Eye,
  EyeOff,
  FlipHorizontal,
  Hand,
  Hexagon,
  ImagePlus,
  Image as ImageIcon,
  Lasso,
  Magnet,
  Maximize,
  Minus,
  MousePointer2,
  MousePointerClick,
  PenTool,
  Pin,
  PinOff,
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
import { buzz, layoutKindNow, settings, useIsPhone, useIsSide, useIsTouch, useSettings } from '@/store/settings';
import { useKeys } from '@/keys';
import { resolveFill } from '@/model/doc';
import { addOutline, addSwatch, editFrame, fitToScreen, openBackground, openPhoto, pastePhoto, pickEraser, pickInk, pickPhoto, setSticky, setTool, startMirror, zoomBy, type AddKind } from '@/actions';
import { openSwatchMenu } from './menus';
import { ColorPanel } from './ColorPanel';
import { Tip } from './primitives';
import { useSlidePick } from './slidePick';
import { CurveIcon, EraseIcon, LineIcon } from './icons';

interface Entry {
  id: string;
  label: string;
  icon: ReactNode;
  keys?: string;
  /** `from` is where the list's button is on screen, for anything that opens beside it. */
  run: (from?: DOMRect) => void;
  active?: boolean;
  /** Draw a divider above this entry in the list. */
  divide?: boolean;
  /** A switch rather than a tool: shows its state, and never becomes the button's face. */
  checked?: boolean;
  /** A heading that opens to more entries, in place. */
  children?: Entry[];
}

const openText = (): void =>
  useUi.setState({
    sheet: 'text',
    textTarget: null,
    tool: 'arrange',
    erasing: false,
    colorPanel: null,
  });

// --- Pinning tools to the bar (desktop) --------------------------------------------

/** The tools that get a button of their own when the bar is opened out, unless changed in Settings. */
export const DEFAULT_PINS = ['cut', 'erase', 'circle', 'rect', 'triangle', 'line', 'curve', 'draw', 'brush'];
/** The order groups open out in when there is not room for all of them. */
const PRIORITY = ['cut', 'shapes', 'lines', 'select', 'more'] as const;
type GroupId = (typeof PRIORITY)[number];

export const currentPins = (): string[] => settings().pins ?? DEFAULT_PINS;
/** Switches and headings stay in their lists; any tool can have a button of its own. */
const pinnable = (e: Entry): boolean => e.checked === undefined && !e.children;

export function togglePin(id: string): void {
  const s = settings();
  const pins = currentPins();
  const on = pins.includes(id);
  // Pinning opens the bar out, so the new button shows.
  s.set({ pins: on ? pins.filter((p) => p !== id) : [...pins, id], dockLevel: on ? s.dockLevel : Math.max(s.dockLevel, PRIORITY.length) });
}

/** Right-click on a tool, in the bar or in a list: pin it to the bar, or take it off. */
function pinMenu(e: Entry, ev: MouseEvent): void {
  ev.preventDefault();
  if (layoutKindNow() !== 'desktop' || !pinnable(e)) return;
  const on = currentPins().includes(e.id);
  useUi.setState({ menu: { x: ev.clientX, y: ev.clientY, items: [{ label: on ? 'Unpin from bar' : 'Pin to bar', icon: on ? PinOff : Pin, onSelect: () => togglePin(e.id) }] } });
}

function Single({ entry, pin }: { entry: Entry; pin?: boolean }) {
  return (
    <Tip label={entry.label} keys={entry.keys}>
      <button
        type="button"
        className="tool"
        aria-label={entry.label}
        aria-pressed={entry.active}
        data-active={entry.active || undefined}
        onClick={() => entry.run()}
        onContextMenu={pin ? (ev) => pinMenu(entry, ev.nativeEvent) : undefined}
      >
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
  primary,
  pin,
}: {
  label: string;
  entries: Entry[];
  icon?: ReactNode;
  caret?: boolean;
  /** Which way the list opens: up from a bar along the bottom, or sideways from a rail down an edge. */
  out?: 'up' | 'right' | 'left';
  /** A tool with a few extras: a click always picks the tool on the button; the list holds the extras. */
  primary?: boolean;
  /** Right-click a tool in the list to pin it to the bar (desktop). */
  pin?: boolean;
}) {
  const touch = useIsTouch();
  const [open, setOpen] = useState(false);
  // the tool shown on the button: never a switch such as Cut lines
  const [last, setLast] = useState(() =>
    Math.max(
      0,
      entries.findIndex((e) => e.checked === undefined),
    ),
  );
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

  const [unfolded, setUnfolded] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setUnfolded(null);
  }, [open]);
  // Hold and drag (a setting): press the button, slide onto a choice, let go.
  const slide = useSlidePick({
    open: () => {
      clearTimeout(timer.current);
      setOpen(true);
    },
    isOpen: open,
    close: () => setOpen(false),
    list,
  });
  const pick = (e: Entry): void => {
    if (e.children) return setUnfolded(unfolded === e.id ? null : e.id);
    const i = entries.indexOf(e);
    if (i >= 0 && e.checked === undefined) setLast(i);
    const from = wrap.current?.getBoundingClientRect();
    setOpen(false);
    e.run(from);
  };
  const row = (e: Entry, inner = false): ReactNode => (
    <div key={e.id}>
      {e.divide && <div className="menu-sep" />}
      <button
        type="button"
        role={e.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={e.checked}
        aria-expanded={e.children ? unfolded === e.id : undefined}
        className={inner ? 'menu-item menu-inner' : 'menu-item'}
        data-active={e.active || undefined}
        onClick={() => pick(e)}
        onContextMenu={pin ? (ev) => pinMenu(e, ev.nativeEvent) : undefined}
      >
        {e.checked === undefined && e.icon}
        {e.label}
        {e.keys && <kbd>{e.keys}</kbd>}
        {/* a switch shows its state with its icon, after the words */}
        {e.checked !== undefined && <span className="menu-trail">{e.icon}</span>}
        {e.children && <ChevronDown className="menu-fold" data-open={unfolded === e.id || undefined} aria-hidden />}
      </button>
      {e.children && unfolded === e.id && e.children.map((c) => row(c, true))}
    </div>
  );

  return (
    <div
      ref={wrap}
      className="tool-group"
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        // With a mouse the list is there the moment the pointer is.
        clearTimeout(timer.current);
        setOpen(true);
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
        onContextMenu={pin && primary ? (ev) => pinMenu(shown, ev.nativeEvent) : undefined}
        {...slide.props}
        onClick={() => {
          if (slide.handled()) return;
          // Mouse: the list is already open from hovering, so a click means "this one again".
          if ((primary || (!touch && open)) && !icon) pick(shown);
          else setOpen(!open);
        }}
      >
        {caret && (
          <svg className="tool-caret" data-open={open || undefined} viewBox="0 0 11 5" aria-hidden>
            <path d="M2.25 3.75 5.5 1.25l3.25 2.5" />
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
          style={{
            [out === 'up' ? 'left' : 'top']: at ?? 0,
            visibility: at === null ? 'hidden' : undefined,
          }}
        >
          {entries.map((e) => row(e))}
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
  const adding = useUi((s) => s.colorPanel === 'new');
  const limit = mode === 'classic' ? 4 : 24;
  const shown = palette.slice(0, limit);
  return (
    <>
      {shown.map((c, i) => (
        <Swatch key={i} index={i} color={c} last={i >= shown.length - 1 && i > 1} />
      ))}
      {(palette.length < limit || adding) && (
        <div className="swatch-wrap">
          <Tip label="Add a color">
            <button type="button" className="swatch" data-swatch aria-label="Add a color" aria-expanded={adding} onClick={addSwatch}>
              <span
                className="swatch-dot flex items-center justify-center"
                style={{
                  background: 'var(--sunken)',
                  boxShadow: 'inset 0 0 0 1px var(--border-strong)',
                }}
              >
                <Plus style={{ width: 15, height: 15 }} />
              </span>
            </button>
          </Tip>
          {adding && <ColorPanel target="new" />}
        </div>
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
      <div className="color-strip-area is-folded">
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
  const sticky = useUi((s) => s.stickyPoints);
  const side = useIsSide();
  const advanced = mode === 'advanced';
  const arranging = tool === 'arrange';

  const select = (m: SelectMode) => (): void =>
    useUi.setState({
      selectMode: m,
      tool: 'arrange',
      erasing: false,
      colorPanel: null,
      frameEdit: false,
    });
  const selects: Entry[] = [
    {
      id: 'move',
      label: 'Move',
      keys: key('move'),
      icon: <MousePointer2 />,
      run: select('move'),
      active: arranging && selectMode === 'move' ? false : undefined,
    },
    {
      id: 'pan',
      label: 'Pan',
      keys: touch ? undefined : 'Space',
      icon: <Hand />,
      run: select('pan'),
      active: arranging && selectMode === 'pan',
    },
    {
      id: 'box',
      label: 'Box select',
      keys: touch ? undefined : 'Shift drag',
      icon: <SquareDashed />,
      run: select('box'),
      active: arranging && selectMode === 'box',
    },
    {
      id: 'lasso',
      label: 'Lasso select',
      icon: <Lasso />,
      run: select('lasso'),
      active: arranging && selectMode === 'lasso',
    },
    {
      id: 'single',
      label: 'One at a time',
      icon: <MousePointerClick />,
      run: select('single'),
      active: arranging && selectMode === 'single',
    },
  ];
  const add = (kind: AddKind) => (): void => addOutline(kind);
  const shapes: Entry[] = [
    {
      id: 'circle',
      label: 'Circle',
      keys: key('circle'),
      icon: <Circle />,
      run: add('circle'),
    },
    {
      id: 'rect',
      label: 'Square',
      keys: key('square'),
      icon: <Square />,
      run: add('rect'),
    },
    {
      id: 'triangle',
      label: 'Triangle',
      icon: <Triangle />,
      run: add('triangle'),
    },
    { id: 'polygon', label: 'Polygon', icon: <Hexagon />, run: add('polygon') },
    { id: 'star', label: 'Star', icon: <Star />, run: add('star') },
  ];
  const lines: Entry[] = [
    {
      id: 'line',
      label: 'Line',
      keys: key('line'),
      icon: <LineIcon />,
      run: add('line'),
    },
    {
      id: 'curve',
      label: 'Curve',
      keys: key('curve'),
      icon: <CurveIcon />,
      run: add('curve'),
    },
    {
      id: 'draw',
      label: 'Draw',
      keys: key('draw'),
      icon: <Pencil />,
      run: () => setTool('draw'),
      active: tool === 'draw',
    },
    {
      id: 'brush',
      label: 'Brush',
      keys: key('brush'),
      icon: <Brush />,
      run: () => setTool('brush'),
      active: tool === 'brush',
    },
    ...(advanced
      ? [
          {
            id: 'pen',
            label: 'Pen',
            keys: key('pen'),
            icon: <PenTool />,
            run: () => setTool('pen'),
            active: tool === 'pen',
          },
        ]
      : []),
  ];
  const photos: Entry[] = [
    {
      id: 'import',
      label: 'Import photo',
      icon: <ImagePlus />,
      run: () => undefined,
      children: [
        {
          id: 'choose',
          label: 'Choose photo',
          keys: hasPhoto ? undefined : key('photo'),
          icon: <ImageIcon />,
          run: pickPhoto,
        },
        {
          id: 'paste',
          label: 'Paste photo',
          keys: key('paste'),
          icon: <ClipboardPaste />,
          run: () => void pastePhoto(),
        },
      ],
    },
    ...(hasPhoto && !advanced
      ? [
          {
            id: 'controls',
            label: 'Photo settings',
            keys: key('photo'),
            icon: <SlidersHorizontal />,
            run: openPhoto,
          },
        ]
      : []),
  ];
  const cuts: Entry[] = [
    // A switch, at the top so the tools sit right above the button.
    {
      id: 'marks',
      label: 'Cut lines',
      icon: showCuts ? <Eye /> : <EyeOff />,
      run: () => useUi.setState({ showCuts: !showCuts }),
      checked: showCuts,
    },
    {
      id: 'cut',
      label: 'Cut',
      keys: key('cut'),
      icon: <Scissors />,
      run: () => setTool('cut'),
      active: tool === 'cut',
      divide: true,
    },
    {
      id: 'erase',
      label: 'Erase',
      keys: key('erase'),
      icon: <EraseIcon />,
      run: pickEraser,
      active: erasing,
    },
  ];
  // The things reached for less often share one button.
  const more: Entry[] = [
    ...photos,
    {
      id: 'paper',
      label: 'Background color',
      icon: <PaintBucket />,
      run: (from) => openBackground(from, side ? 'beside' : 'above'),
      divide: true,
    },
    {
      id: 'frame',
      label: 'Frame size',
      icon: <Crop />,
      run: () => editFrame(true),
    },
    {
      id: 'fit',
      label: 'Zoom to fit',
      icon: <Maximize />,
      run: () => fitToScreen(),
    },
    {
      id: 'sticky',
      label: 'Sticky points',
      icon: <Magnet style={{ opacity: sticky ? 1 : 0.45 }} />,
      run: () => setSticky(!sticky),
      checked: sticky,
      divide: true,
    },
    // A tool: last, right above the button.
    {
      id: 'mirror',
      label: 'Mirror copy',
      keys: key('mirror'),
      icon: <FlipHorizontal />,
      run: startMirror,
      active: tool === 'mirror',
      divide: true,
    },
  ];

  return { key, selects, shapes, lines, cuts, photos, more };
}

/** The groups of the bar, in the order they sit on it, for the bar and for Settings. */
export function useBarGroups(): { id: GroupId; label: string; entries: Entry[] }[] {
  const { selects, shapes, lines, cuts, more } = useEntries();
  return [
    { id: 'shapes', label: 'Shapes', entries: shapes },
    { id: 'lines', label: 'Lines', entries: lines },
    { id: 'cut', label: 'Cut', entries: cuts },
    { id: 'select', label: 'Select', entries: selects },
    { id: 'more', label: 'More', entries: more },
  ];
}

/**
 * One group of the bar. Compact, it is a single button with a list. Opened
 * out, its pinned tools get buttons of their own; what is left stays in the
 * list (a list left with only switches, such as Cut lines, hangs off the
 * first tool instead).
 */
function Section({ label, entries, open, pins, icon, caret }: { label: string; entries: Entry[]; open: boolean; pins: string[]; icon?: ReactNode; caret?: boolean }) {
  if (!open) return <Group label={label} entries={entries} icon={icon} caret={caret} pin />;
  const pinned = entries.filter((e) => pinnable(e) && pins.includes(e.id));
  const rest = entries.filter((e) => !pinned.includes(e));
  if (!pinned.length) return <Group label={label} entries={entries} icon={icon} caret={caret} pin />;
  if (rest.some((e) => e.checked === undefined)) {
    return (
      <>
        {pinned.map((e) => (
          <Single key={e.id} entry={e} pin />
        ))}
        <Group label={label} entries={rest} icon={icon} caret={caret} pin />
      </>
    );
  }
  const [first, ...others] = pinned;
  return (
    <>
      {rest.length ? <Group label={first!.label} entries={[...rest, first!]} caret primary pin /> : <Single entry={first!} pin />}
      {others.map((e) => (
        <Single key={e.id} entry={e} pin />
      ))}
    </>
  );
}

/** How many more buttons a group takes up opened out than as one button. */
function extraButtons(entries: Entry[], pins: string[]): number {
  const pinned = entries.filter((e) => pinnable(e) && pins.includes(e.id)).length;
  if (!pinned) return 0;
  const restTools = entries.some((e) => !(pinnable(e) && pins.includes(e.id)) && e.checked === undefined);
  return pinned + (restTools ? 1 : 0) - 1;
}

/**
 * Desktop: the tab at the end of the bar. Click to open the bar out (as far
 * as the screen allows) or fold it back; drag it to open out one group at a
 * time.
 */
function ExpandTab({ level, max, growth, onLevel }: { level: number; max: number; growth: (n: number) => number; onLevel: (n: number) => void }) {
  const from = useRef<{ x: number; level: number; moved: boolean } | null>(null);
  const label = level > 0 ? 'Fold bar' : 'Expand bar';
  return (
    <Tip label={`${label}: click or drag`}>
      <button
        type="button"
        className="dock-tab"
        aria-label={label}
        aria-expanded={level > 0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          from.current = { x: e.clientX, level, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const f = from.current;
          if (!f) return;
          const dx = e.clientX - f.x;
          if (!f.moved && Math.abs(dx) < 4) return;
          f.moved = true;
          // The bar stays centred, so its end moves half as far as it grows.
          const want = growth(f.level) / 2 + dx;
          let best = 0;
          for (let n = 0; n <= max; n++) if (Math.abs(growth(n) / 2 - want) < Math.abs(growth(best) / 2 - want)) best = n;
          if (best !== level) onLevel(best);
        }}
        onPointerUp={() => {
          const f = from.current;
          from.current = null;
          if (f && !f.moved) onLevel(level > 0 ? 0 : PRIORITY.length);
        }}
        onPointerCancel={() => (from.current = null)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          onLevel(level > 0 ? 0 : PRIORITY.length);
        }}
      >
        {level > 0 ? <ChevronLeft /> : <ChevronRight />}
      </button>
    </Tip>
  );
}

export function Dock() {
  const phone = useIsPhone();
  const side = useIsSide();
  const { key, selects, shapes, lines, cuts, more } = useEntries();
  const stored = useSettings((s) => s.dockLevel);
  const pins = useSettings((s) => s.pins) ?? DEFAULT_PINS;
  // re-measure when the words under the icons come or go
  useSettings((s) => s.toolLabels);
  const bar = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number>(PRIORITY.length);
  const text: Entry = {
    id: 'text',
    label: 'Text',
    keys: key('text'),
    icon: <Type />,
    run: openText,
  };

  // The groups that can open out, in the order they do: only those with something pinned.
  const byId: Record<GroupId, Entry[]> = { cut: cuts, shapes, lines, select: selects, more };
  const order = PRIORITY.filter((id) => extraButtons(byId[id], pins) > 0);
  const level = Math.min(stored, order.length);
  const shown = Math.min(level, fit);
  const open = new Set(order.slice(0, shown));
  const extras = order.map((id) => extraButtons(byId[id], pins));
  const width = useRef(56);
  const growth = (n: number): number => extras.slice(0, n).reduce((a, b) => a + b, 0) * width.current;

  // How many groups fit: the bar stays clear of the zoom buttons in the corner.
  useLayoutEffect(() => {
    if (phone || side) return;
    const measure = (): void => {
      const el = bar.current;
      if (!el) return;
      const tool = el.querySelector<HTMLElement>('.tool');
      if (tool) width.current = tool.offsetWidth + 2;
      const compact = el.offsetWidth - growth(shown);
      const zoom = document.querySelector('.zoom-control')?.getBoundingClientRect().width ?? 190;
      const room = window.innerWidth - 2 * (zoom + 26);
      let n = 0;
      while (n < order.length && compact + growth(n + 1) <= room) n++;
      setFit(n);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

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

  if (phone) {
    return (
      <div className="glass dock" role="toolbar" aria-label="Tools">
        <Single entry={text} />
        <Group label="Shapes" entries={shapes} caret />
        <Group label="Lines" entries={lines} caret />
        <Group label="Cut" entries={cuts} caret />
        <Group label="Select" entries={selects} />
        <Group label="More" entries={more} icon={<Ellipsis />} />
      </div>
    );
  }

  return (
    <div ref={bar} className="glass dock" role="toolbar" aria-label="Tools">
      <Single entry={text} />
      <Section label="Shapes" entries={shapes} open={open.has('shapes')} pins={pins} caret />
      <Section label="Lines" entries={lines} open={open.has('lines')} pins={pins} caret />
      <Section label="Cut" entries={cuts} open={open.has('cut')} pins={pins} caret />
      <span className="sep" />
      <Colors />
      <span className="sep" />
      <Section label="Select" entries={selects} open={open.has('select')} pins={pins} />
      <Section label="More" entries={more} open={open.has('more')} pins={pins} icon={<Ellipsis />} />
      {order.length > 0 && <ExpandTab level={shown} max={Math.min(fit, order.length)} growth={growth} onLevel={(n) => settings().set({ dockLevel: n })} />}
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
