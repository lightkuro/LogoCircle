import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Brush,
  Circle,
  Hand,
  Hexagon,
  Image as ImageIcon,
  Lasso,
  MousePointer2,
  MousePointerClick,
  PenTool,
  Pencil,
  Plus,
  Scissors,
  Square,
  SquareDashed,
  Star,
  Triangle,
  Type,
} from 'lucide-react';
import { useDoc } from '@/store/doc';
import { useUi, type SelectMode } from '@/store/ui';
import { addOutline, addSwatch, colorLimit, pickEraser, pickInk, pickPhoto, setTool, type AddKind } from '@/actions';
import { openSwatchMenu } from './menus';
import { ColorPanel } from './ColorPanel';
import { Tip, useIsPhone } from './primitives';
import { CurveIcon, EraseIcon, LineIcon } from './icons';

const fine = (): boolean => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

interface Entry {
  id: string;
  label: string;
  icon: ReactNode;
  keys?: string;
  run: () => void;
  active?: boolean;
}

export function openPhoto(): void {
  const { doc } = useDoc.getState();
  const ref = doc.refs[doc.refs.length - 1];
  // With a photo already placed, the button opens its controls instead of the file picker.
  if (ref && useUi.getState().mode === 'classic') useUi.setState({ tool: 'arrange', erasing: false, selection: [ref.id], trayOpen: false });
  else pickPhoto();
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
 * Several related tools behind one button. Hovering (mouse) or tapping opens
 * the list; with a mouse, clicking the button itself repeats the one shown.
 */
function Group({ label, entries, align }: { label: string; entries: Entry[]; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
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
    setLast(i);
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
          if (fine() && open) pick(entries.indexOf(shown));
          else setOpen(!open);
        }}
      >
        {shown.icon}
        <span>{label}</span>
      </button>
      {open && (
        <div className="pop flyout" data-align={align} role="menu" aria-label={label}>
          {entries.map((e, i) => (
            <button key={e.id} type="button" role="menuitem" className="menu-item" data-active={e.active || undefined} onClick={() => pick(i)}>
              {e.icon}
              {e.label}
              {e.keys && <kbd>{e.keys}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Swatch({ index, color, last }: { index: number; color: string; last: boolean }) {
  const active = useUi((s) => (s.tool === 'color' || s.tool === 'brush' || s.tool === 'draw' || s.tool === 'pen') && !s.erasing && s.ink === index);
  const panel = useUi((s) => s.colorPanel === index);
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);
  return (
    <div className="swatch-wrap">
      <Tip label={`Color ${index + 1}`} keys={String(index + 1)}>
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
              navigator.vibrate?.(10);
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
  const erasing = useUi((s) => s.tool === 'color' && s.erasing);
  const paperPanel = useUi((s) => s.colorPanel === 'paper');
  const limit = mode === 'classic' ? 4 : 24;
  void colorLimit;
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
            <span className="swatch-num">Add</span>
          </button>
        </Tip>
      )}
      <div className="swatch-wrap">
        <Tip label="Erase" keys="E">
          <button type="button" className="tool" aria-pressed={erasing} data-active={erasing || undefined} onClick={pickEraser}>
            <EraseIcon />
            <span>Erase</span>
          </button>
        </Tip>
        {paperPanel && <ColorPanel target="paper" align="end" />}
      </div>
    </>
  );
}

export function Dock() {
  const phone = useIsPhone();
  const tool = useUi((s) => s.tool);
  const mode = useUi((s) => s.mode);
  const selectMode = useUi((s) => s.selectMode);
  const advanced = mode === 'advanced';
  const arranging = tool === 'arrange';

  const select = (m: SelectMode) => (): void => useUi.setState({ selectMode: m, tool: 'arrange', erasing: false, colorPanel: null, frameEdit: false });
  const selects: Entry[] = [
    { id: 'move', label: 'Move', keys: 'V', icon: <MousePointer2 />, run: select('move'), active: arranging && selectMode === 'move' ? false : undefined },
    { id: 'pan', label: 'Pan', keys: 'Space', icon: <Hand />, run: select('pan'), active: arranging && selectMode === 'pan' },
    { id: 'box', label: 'Box select', keys: 'Shift drag', icon: <SquareDashed />, run: select('box'), active: arranging && selectMode === 'box' },
    { id: 'lasso', label: 'Lasso select', icon: <Lasso />, run: select('lasso'), active: arranging && selectMode === 'lasso' },
    { id: 'single', label: 'One at a time', icon: <MousePointerClick />, run: select('single'), active: arranging && selectMode === 'single' },
  ];
  const add = (kind: AddKind) => (): void => addOutline(kind);
  const shapes: Entry[] = [
    { id: 'rect', label: 'Square', keys: 'R', icon: <Square />, run: add('rect') },
    { id: 'triangle', label: 'Triangle', icon: <Triangle />, run: add('triangle') },
    { id: 'polygon', label: 'Polygon', icon: <Hexagon />, run: add('polygon') },
    { id: 'star', label: 'Star', icon: <Star />, run: add('star') },
  ];
  const lines: Entry[] = [
    { id: 'line', label: 'Line', keys: 'L', icon: <LineIcon />, run: add('line') },
    { id: 'curve', label: 'Curve', keys: 'U', icon: <CurveIcon />, run: add('curve') },
    { id: 'draw', label: 'Draw', keys: 'D', icon: <Pencil />, run: () => setTool('draw'), active: tool === 'draw' },
    ...(advanced ? [{ id: 'pen', label: 'Pen', keys: 'N', icon: <PenTool />, run: () => setTool('pen'), active: tool === 'pen' }] : []),
  ];

  const tools = (
    <div className="glass dock" role="toolbar" aria-label="Tools">
      <Group label="Select" entries={selects} align="start" />
      <Single entry={{ id: 'text', label: 'Text', keys: 'T', icon: <Type />, run: openText }} />
      <Single entry={{ id: 'circle', label: 'Circle', keys: 'O', icon: <Circle />, run: add('circle') }} />
      <Group label="Shapes" entries={shapes} />
      <Group label="Lines" entries={lines} />
      <Single entry={{ id: 'cut', label: 'Cut', keys: 'X', icon: <Scissors />, run: () => setTool('cut'), active: tool === 'cut' }} />
      <Single entry={{ id: 'brush', label: 'Brush', keys: 'B', icon: <Brush />, run: () => setTool('brush'), active: tool === 'brush' }} />
      <Single entry={{ id: 'photo', label: 'Photo', keys: 'P', icon: <ImageIcon />, run: openPhoto }} />
      {!phone && (
        <>
          <span className="sep" />
          <Colors />
        </>
      )}
    </div>
  );

  if (!phone) return tools;
  // Phones: colors on their own row above the tools, both within thumb reach.
  return (
    <div className="dock-stack">
      <div className="glass dock" role="toolbar" aria-label="Colors">
        <Colors />
      </div>
      {tools}
    </div>
  );
}
