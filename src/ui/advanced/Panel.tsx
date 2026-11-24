import { useEffect, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Ban,
  Circle as CircleIcon,
  Eye,
  EyeOff,
  Grid3x3,
  Group as GroupIcon,
  Magnet,
  Image as ImageIcon,
  Lock,
  LockOpen,
  PaintBucket,
  Spline,
  SquaresExclude,
  SquaresIntersect,
  SquaresSubtract,
  SquaresUnite,
  Ungroup,
} from 'lucide-react';
import { useDoc, getDoc, commit } from '@/store/doc';
import { useUi } from '@/store/ui';
import { board, resolveFill } from '@/model/doc';
import { selectionBBox, updateGuide } from '@/model/ops';
import { isClosedGuide } from '@/model/guides';
import type { Doc, Fill, Guide } from '@/model/types';
import { editFrame, fillSelectedOutlines, fitToScreen, setBoard } from '@/actions';
import {
  alignSelection,
  booleanSelection,
  distributeSelection,
  groupSelection,
  orderSelection,
  rotateSelection,
  setSelectionBox,
  setSelectionFill,
  setSelectionOpacity,
  setSelectionStroke,
  shapesToOutlines,
  toggleHidden,
  toggleLocked,
  ungroupSelection,
} from '@/advanced/ops';
import { IconButton, Sheet, Slider, useIsPhone } from '../primitives';
import { useLiveEdit } from '../live';

function NumField({ label, value, onCommit, suffix }: { label: string; value: number; onCommit: (v: number) => void; suffix?: string }) {
  const shown = Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '';
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const apply = (): void => {
    const v = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(shown);
  };
  return (
    <label className="flex h-9 min-w-0 items-center gap-1.5 rounded-[10px] bg-sunken px-2.5 text-[13px]">
      <span className="shrink-0 font-semibold text-muted">{label}</span>
      <input
        className="w-full min-w-0 bg-transparent outline-none"
        style={{ fontVariantNumeric: 'tabular-nums' }}
        inputMode="decimal"
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(shown);
            e.currentTarget.blur();
          }
        }}
      />
      {suffix && <span className="shrink-0 text-muted">{suffix}</span>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-3.5 py-3 last:border-0">
      <h3 className="m-0 pb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">{title}</h3>
      {children}
    </section>
  );
}

function ColorRow({ doc, value, onPick, allowNone }: { doc: Doc; value: Fill | null | undefined; onPick: (f: Fill | null) => void; allowNone?: boolean }) {
  const custom = typeof value === 'string' ? value : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowNone && (
        <button type="button" className="ib" style={{ width: 30, height: 30 }} aria-label="None" data-active={value === null || undefined} onClick={() => onPick(null)}>
          <Ban style={{ width: 17, height: 17 }} />
        </button>
      )}
      {doc.palette.map((c, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Color ${i + 1}`}
          onClick={() => onPick(i)}
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            border: 0,
            background: c,
            boxShadow: value === i ? '0 0 0 2px var(--surface-solid), 0 0 0 4px var(--accent)' : 'inset 0 0 0 1px rgba(0,0,0,.15)',
          }}
        />
      ))}
      <label
        title="Any color"
        style={{
          position: 'relative',
          width: 26,
          height: 26,
          borderRadius: 999,
          overflow: 'hidden',
          background: custom ?? 'conic-gradient(#f43, #fc3, #3c6, #39f, #93f, #f43)',
          boxShadow: custom ? '0 0 0 2px var(--surface-solid), 0 0 0 4px var(--accent)' : 'inset 0 0 0 1px rgba(0,0,0,.15)',
        }}
      >
        <input
          type="color"
          aria-label="Any color"
          value={custom ?? '#888888'}
          onChange={(e) => onPick(e.target.value)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
        />
      </label>
    </div>
  );
}

function CanvasSettings() {
  const art = useDoc((s) => s.doc.artboard);
  const artboard = board({ artboard: art });
  const snap = useUi((s) => s.snap);
  const grid = useUi((s) => s.grid);
  const resize = (patch: Partial<{ x: number; y: number; w: number; h: number }>): void => {
    setBoard({ ...artboard, ...patch });
    requestAnimationFrame(() => fitToScreen());
  };
  return (
    <>
      <Section title="Export frame">
        <div className="grid grid-cols-2 gap-1.5">
          <NumField label="X" value={artboard.x} onCommit={(v) => resize({ x: v })} />
          <NumField label="Y" value={artboard.y} onCommit={(v) => resize({ y: v })} />
          <NumField label="W" value={artboard.w} onCommit={(v) => resize({ w: v })} />
          <NumField label="H" value={artboard.h} onCommit={(v) => resize({ h: v })} />
        </div>
        <button type="button" className="chip mt-1.5 w-full justify-center" style={{ background: 'var(--sunken)' }} onClick={() => editFrame(true)}>
          Adjust on the canvas
        </button>
      </Section>
      <Section title="Snapping">
        <div className="flex gap-1.5">
          <button type="button" className="chip flex-1 justify-center" style={{ background: 'var(--sunken)' }} data-active={snap} onClick={() => useUi.setState({ snap: !snap })}>
            <Magnet />
            {snap ? 'Snap on' : 'Snap off'}
          </button>
          <button
            type="button"
            className="chip flex-1 justify-center"
            style={{ background: 'var(--sunken)' }}
            data-active={grid > 0}
            onClick={() => useUi.setState({ grid: grid > 0 ? 0 : 64 })}
          >
            <Grid3x3 />
            Grid
          </button>
        </div>
        {grid > 0 && (
          <div className="grid grid-cols-2 gap-1.5 pt-1.5">
            <NumField label="Every" value={grid} onCommit={(v) => useUi.setState({ grid: Math.max(4, Math.min(512, v)) })} />
          </div>
        )}
      </Section>
      <p className="m-0 px-3.5 py-3 text-[13px] leading-snug text-muted">Select something to see its size, color and options.</p>
    </>
  );
}

function Inspector() {
  const doc = useDoc((s) => s.doc);
  const selection = useUi((s) => s.selection);
  const live = useLiveEdit();
  const [turn, setTurn] = useState(0);
  if (!selection.length) return <CanvasSettings />;
  const box = selectionBBox(doc, selection);
  const shapes = doc.shapes.filter((s) => selection.includes(s.id));
  const guides = doc.guides.filter((g) => selection.includes(g.id));
  const first = shapes[0];
  const rect = guides.length === 1 && guides[0]!.type === 'rect' ? guides[0] : null;
  const grouped = shapes.some((s) => s.group);
  const patchGuide = (g: Guide): void => commit(updateGuide(getDoc(), g.id, g));

  return (
    <>
      {box && (
        <Section title="Position and size">
          <div className="grid grid-cols-2 gap-1.5">
            <NumField label="X" value={box.x} onCommit={(v) => setSelectionBox({ x: v })} />
            <NumField label="Y" value={box.y} onCommit={(v) => setSelectionBox({ y: v })} />
            <NumField label="W" value={box.w} onCommit={(v) => setSelectionBox({ w: v })} />
            <NumField label="H" value={box.h} onCommit={(v) => setSelectionBox({ h: v })} />
            <NumField
              label="Turn"
              suffix="°"
              value={turn}
              onCommit={(v) => {
                rotateSelection(v);
                setTurn(0);
              }}
            />
            {rect && <NumField label="Radius" value={rect.radius} onCommit={(v) => patchGuide({ ...rect, radius: Math.max(0, v) })} />}
          </div>
        </Section>
      )}

      {shapes.length > 0 && (
        <>
          <Section title="Fill">
            <ColorRow doc={doc} value={first!.fill} onPick={setSelectionFill} allowNone />
          </Section>
          <Section title="Stroke">
            <div className="grid grid-cols-2 gap-1.5 pb-2">
              <NumField label="Width" value={first!.stroke?.width ?? 0} onCommit={(v) => setSelectionStroke(v > 0 ? { width: v } : null)} />
            </div>
            {first!.stroke && <ColorRow doc={doc} value={first!.stroke.color} onPick={(f) => f !== null && setSelectionStroke({ color: f })} />}
          </Section>
          <Section title="Opacity">
            <Slider
              label="Opacity"
              min={5}
              max={100}
              value={Math.round((first!.opacity ?? 1) * 100)}
              format={(v) => `${v}%`}
              onChange={(v) => live.change((d) => setSelectionOpacity(d, v / 100))}
              onCommit={live.commit}
            />
          </Section>
        </>
      )}

      <Section title="Align">
        <div className="flex flex-wrap gap-0.5">
          <IconButton label="Align left" onClick={() => alignSelection('left')}><AlignStartVertical /></IconButton>
          <IconButton label="Align centre" onClick={() => alignSelection('center')}><AlignCenterVertical /></IconButton>
          <IconButton label="Align right" onClick={() => alignSelection('right')}><AlignEndVertical /></IconButton>
          <IconButton label="Align top" onClick={() => alignSelection('top')}><AlignStartHorizontal /></IconButton>
          <IconButton label="Align middle" onClick={() => alignSelection('middle')}><AlignCenterHorizontal /></IconButton>
          <IconButton label="Align bottom" onClick={() => alignSelection('bottom')}><AlignEndHorizontal /></IconButton>
          <IconButton label="Space evenly across" disabled={selection.length < 3} onClick={() => distributeSelection('h')}><AlignHorizontalDistributeCenter /></IconButton>
          <IconButton label="Space evenly down" disabled={selection.length < 3} onClick={() => distributeSelection('v')}><AlignVerticalDistributeCenter /></IconButton>
        </div>
      </Section>

      {shapes.length > 0 && (
        <Section title="Combine and arrange">
          <div className="flex flex-wrap gap-0.5">
            <IconButton label="Unite" disabled={shapes.length < 2} onClick={() => booleanSelection('unite')}><SquaresUnite /></IconButton>
            <IconButton label="Subtract the ones on top" disabled={shapes.length < 2} onClick={() => booleanSelection('subtract')}><SquaresSubtract /></IconButton>
            <IconButton label="Keep the overlap" disabled={shapes.length < 2} onClick={() => booleanSelection('intersect')}><SquaresIntersect /></IconButton>
            <IconButton label="Remove the overlap" disabled={shapes.length < 2} onClick={() => booleanSelection('exclude')}><SquaresExclude /></IconButton>
          </div>
          <div className="flex flex-wrap gap-0.5 pt-1">
            <IconButton label="Bring to front" onClick={() => orderSelection('front')}><ArrowUpToLine /></IconButton>
            <IconButton label="Bring forward" onClick={() => orderSelection('forward')}><ArrowUp /></IconButton>
            <IconButton label="Send backward" onClick={() => orderSelection('backward')}><ArrowDown /></IconButton>
            <IconButton label="Send to back" onClick={() => orderSelection('back')}><ArrowDownToLine /></IconButton>
            <IconButton label="Group" disabled={shapes.length < 2} onClick={groupSelection}><GroupIcon /></IconButton>
            <IconButton label="Ungroup" disabled={!grouped} onClick={ungroupSelection}><Ungroup /></IconButton>
          </div>
          <button type="button" className="chip mt-1 w-full justify-start" style={{ background: 'var(--sunken)' }} onClick={shapesToOutlines}>
            <Spline />
            Edit points
          </button>
        </Section>
      )}

      {guides.some(isClosedGuide) && shapes.length === 0 && (
        <Section title="Outline">
          <button type="button" className="chip w-full justify-start" style={{ background: 'var(--sunken)' }} onClick={fillSelectedOutlines}>
            <PaintBucket />
            Make it a shape
          </button>
        </Section>
      )}
    </>
  );
}

function LayerRow({ id, label, icon, hidden, locked, selected }: { id: string; label: string; icon: React.ReactNode; hidden?: boolean; locked?: boolean; selected: boolean }) {
  return (
    <div
      className="group flex h-9 items-center gap-2 rounded-[10px] pl-2 pr-0.5 text-[13px]"
      style={{ background: selected ? 'var(--accent-soft)' : undefined, opacity: hidden ? 0.5 : 1 }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left"
        onClick={(e) => {
          if (locked) return;
          const sel = useUi.getState().selection;
          useUi.setState({
            tool: 'arrange',
            erasing: false,
            selection: e.shiftKey || e.metaKey || e.ctrlKey ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : [id],
          });
        }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      <button type="button" className="ib" style={{ width: 28, height: 28 }} aria-label={locked ? 'Unlock' : 'Lock'} onClick={() => toggleLocked(id)}>
        {locked ? <Lock style={{ width: 14, height: 14 }} /> : <LockOpen style={{ width: 14, height: 14, opacity: 0.35 }} />}
      </button>
      <button type="button" className="ib" style={{ width: 28, height: 28 }} aria-label={hidden ? 'Show' : 'Hide'} onClick={() => toggleHidden(id)}>
        {hidden ? <EyeOff style={{ width: 14, height: 14 }} /> : <Eye style={{ width: 14, height: 14, opacity: 0.35 }} />}
      </button>
    </div>
  );
}

const GUIDE_NAMES: Record<Guide['type'], string> = { ellipse: 'Circle', rect: 'Rectangle', line: 'Line', poly: 'Polygon', curve: 'Curve', path: 'Path', edges: 'Outline piece' };

function Layers() {
  const doc = useDoc((s) => s.doc);
  const selection = useUi((s) => s.selection);
  const empty = !doc.shapes.length && !doc.guides.length && !doc.refs.length;
  if (empty) return <p className="m-0 px-3.5 py-4 text-[13px] leading-snug text-muted">Everything you add appears here.</p>;
  return (
    <div className="px-2 py-2">
      {[...doc.shapes].reverse().map((s) => (
        <LayerRow
          key={s.id}
          id={s.id}
          selected={selection.includes(s.id)}
          hidden={s.hidden}
          locked={s.locked}
          label={s.name ? `“${s.name}”` : s.group && doc.groups[s.group]?.name ? `${doc.groups[s.group]!.name}` : 'Shape'}
          icon={<span style={{ width: 14, height: 14, borderRadius: 4, background: resolveFill(doc, s.fill), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.2)' }} />}
        />
      ))}
      {doc.guides.length > 0 && <div className="px-2 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Outlines</div>}
      {[...doc.guides].reverse().map((g) => (
        <LayerRow
          key={g.id}
          id={g.id}
          selected={selection.includes(g.id)}
          hidden={g.hidden}
          locked={g.locked}
          label={GUIDE_NAMES[g.type]}
          icon={<CircleIcon style={{ width: 14, height: 14, color: 'var(--guide)' }} />}
        />
      ))}
      {doc.refs.length > 0 && <div className="px-2 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Photos</div>}
      {doc.refs.map((r) => (
        <LayerRow key={r.id} id={r.id} selected={selection.includes(r.id)} hidden={r.hidden} label="Photo" icon={<ImageIcon style={{ width: 14, height: 14 }} />} />
      ))}
    </div>
  );
}

function PanelBody() {
  const [tab, setTab] = useState<'design' | 'layers'>('design');
  return (
    <>
      <div className="flex gap-1 border-b border-line p-1.5">
        {(['design', 'layers'] as const).map((t) => (
          <button key={t} type="button" className="chip flex-1 justify-center" data-active={tab === t} onClick={() => setTab(t)}>
            {t === 'design' ? 'Design' : 'Layers'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
        {tab === 'design' ? <Inspector /> : <Layers />}
      </div>
    </>
  );
}

/** Advanced mode's side panel. On phones it lives in a sheet instead. */
export function AdvancedPanel() {
  const mode = useUi((s) => s.mode);
  const open = useUi((s) => s.panelOpen);
  const phone = useIsPhone();
  if (mode !== 'advanced') return null;
  if (phone) {
    return (
      <Sheet open={open} onClose={() => useUi.setState({ panelOpen: false })} title="Design and layers">
        <div className="-mx-[18px] -mb-[18px] flex flex-col" style={{ height: '56dvh' }}>
          <PanelBody />
        </div>
      </Sheet>
    );
  }
  return (
    <aside className="glass flex flex-col overflow-hidden" style={{ position: 'absolute', right: 10, top: 74, bottom: 76, width: 264, zIndex: 9 }} aria-label="Design and layers">
      <PanelBody />
    </aside>
  );
}
