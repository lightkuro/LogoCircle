import { useMemo, useState, type ReactNode } from 'react';
import {
  Check,
  CircleDot,
  CopyPlus,
  Crop,
  Ellipsis,
  Eye,
  EyeOff,
  FlipVertical2,
  FlipHorizontal,
  Grid2x2,
  FlipHorizontal2,
  Group as GroupIcon,
  Info,
  Layers2,
  Lock,
  LockOpen,
  Pencil,
  Repeat2,
  Replace,
  Scaling,
  SlidersHorizontal,
  Square,
  SquareDashed,
  SquareDashedMousePointer,
  SquareSquare,
  SquareRoundCorner,
  Trash2,
  Undo2,
  Ungroup,
  X,
} from 'lucide-react';
import { Popover } from '@base-ui/react/popover';
import { useDoc, getDoc, commit } from '@/store/doc';
import { useUi } from '@/store/ui';
import { useIsPhone, useIsTouch } from '@/store/settings';
import { useKeys } from '@/keys';
import {
  canRepeat,
  deleteSelection,
  doneTool,
  duplicateSelection,
  editFrame,
  fitBoardToArtwork,
  finishFillet,
  finishPattern,
  flipSelection,
  setFillet,
  setPattern,
  startPattern,
  startMirror,
  groupSelection,
  pickPhoto,
  repeatDuplicate,
  selectionGroups,
  setBoard,
  setBoardRatio,
  ungroupSelection,
} from '@/actions';
import { board } from '@/model/doc';
import { cornerRadius, guideBand, guideWidth, isClosedOutline, maxCornerRadius, setCornerRadius } from '@/model/guides';
import { selectionBBox, updateRef } from '@/model/ops';
import { defaultPattern, type PatternKind, type PatternSpec } from '@/model/pattern';
import type { Band, Fill, Guide, Shape } from '@/model/types';
import { borderStroke } from '@/model/border';
import { finishPen, undoPenPoint, usePen } from '@/tools';
import { roundCorner } from './menus';
import { Segmented, Slider, Tip } from './primitives';
import { useLiveEdit } from './live';

// --- Pieces -------------------------------------------------------------------

function Chip({
  label,
  icon,
  onClick,
  disabled,
  tone,
  tip,
  keys,
  active,
}: {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'danger';
  tip: string;
  keys?: string;
  active?: boolean;
}) {
  return (
    <Tip label={tip} keys={keys}>
      <button
        type="button"
        className="chip"
        data-tone={tone}
        data-active={active || undefined}
        aria-pressed={active}
        // A visible label is the name; the tooltip only names icon-only buttons.
        aria-label={label ? undefined : tip}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
        {label}
      </button>
    </Tip>
  );
}

/** A button that opens a small panel above the bar: where the less-used controls live. */
function Menu({
  label,
  icon,
  name,
  children,
  width = 248,
  hover,
  disabled,
}: {
  label?: string;
  icon: ReactNode;
  name: string;
  children: ReactNode;
  width?: number;
  hover?: boolean;
  disabled?: boolean;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger className="chip" aria-label={name} openOnHover={hover} delay={0} closeDelay={120} disabled={disabled}>
        {icon}
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={12} collisionPadding={8} style={{ zIndex: 30 }}>
          <Popover.Popup className="pop bar-menu" style={{ width }}>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A row in such a panel. Choosing it closes the panel. */
function Row({ icon, label, onClick, disabled, active, tone, keep }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean; tone?: 'danger'; keep?: boolean }) {
  const props = { className: 'menu-item', 'data-tone': tone, 'data-active': active || undefined, disabled, onClick };
  const inner = (
    <>
      {icon}
      {label}
      {active && <Check className="menu-check" />}
    </>
  );
  return keep ? (
    <button type="button" {...props}>
      {inner}
    </button>
  ) : (
    <Popover.Close {...props}>{inner}</Popover.Close>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <span className="bar-hint">{children}</span>;

function Done({ onClick = doneTool, label = 'Done' }: { onClick?: () => void; label?: string }) {
  const touch = useIsTouch();
  return <Chip tip="Finish tool" keys={touch ? undefined : 'Esc'} label={label} icon={<Check />} onClick={onClick} />;
}

// --- What to say about the tool in hand ------------------------------------------

const MODE_HINT = (tap: string): Record<string, string> => ({
  pan: 'Pan: drag to move view',
  points: 'Move points: drag corners and points',
  box: 'Box select: drag around items',
  lasso: 'Lasso: draw around items to select',
  single: `One at a time: ${tap.toLowerCase()} pieces to select, even in groups`,
});

/** One line about what the current tool or mode expects. Null when nothing needs saying. */
function useHint(): string | null {
  const touch = useIsTouch();
  const tool = useUi((s) => s.tool);
  const erasing = useUi((s) => s.erasing);
  const frameEdit = useUi((s) => s.frameEdit);
  const selectMode = useUi((s) => s.selectMode);
  const count = useUi((s) => s.selection.length);
  const none = count === 0;
  const multi = useUi((s) => s.multi);
  const corner = useUi((s) => s.corner);
  const points = usePen((s) => s.count);
  const marks = useUi((s) => s.showCuts);
  const tap = touch ? 'Tap' : 'Click';
  if (frameEdit) return 'Drag frame or handles to set export area';
  if (tool === 'color') return erasing ? `${tap} areas to clear` : `${tap} areas to color`;
  if (tool === 'pen') return points === 0 ? `${tap} to add points. Drag to bend.` : `${points} point${points === 1 ? '' : 's'}`;
  if (tool === 'brush') return 'Paint with chosen color';
  if (tool === 'cut') return marks ? `${tap} segment to remove. ${tap} dotted segment to restore.` : `${tap} segment to remove. Drag to slice shape.`;
  if (tool === 'draw') return 'Draw line. It becomes smooth curve.';
  if (tool === 'mirror') return `${tap} line to mirror across, or draw one`;
  if (corner) return corner.index < 0 ? 'Rounding all corners' : 'Rounding one corner';
  if (multi) return `${tap} items to add to selection`;
  if (selectMode === 'points' && tool === 'arrange' && !none) return 'Move points: drag corners and points';
  if (selectMode === 'single' && tool === 'arrange' && !none) return `${count} selected. ${tap} pieces to add or remove.`;
  if (none && selectMode !== 'move') return MODE_HINT(tap)[selectMode] ?? null;
  return null;
}

/** Phones: the hint sits under the top bar, leaving the bottom for the controls. */
export function TopHint() {
  const text = useHint();
  if (!text) return null;
  return (
    <div className="hint-area" aria-live="polite">
      <div className="glass hint-pill rise-down" key={text.replace(/\d+/g, '#')}>
        <Info />
        <span>{text}</span>
      </div>
    </div>
  );
}

// --- Thickness and corners ------------------------------------------------------

function ThicknessControls({ guides }: { guides: Guide[] }) {
  const live = useLiveEdit();
  const width = Math.round(guideWidth(guides[0]!));
  const ids = new Set(guides.map((g) => g.id));
  const closed = guides.every(isClosedOutline);
  const band = guideBand(guides[0]!);
  // Thick straight lines end rounded, or flat right at their ends.
  const lines = guides.every((g) => g.type === 'line');
  const first = guides[0]!;
  const ends = first.type === 'line' && first.ends === 'flat' ? 'flat' : 'round';
  return (
    <div className="bar-menu-pad">
      <div className="text-[12px] font-semibold text-muted">Thickness</div>
      <Slider
        label="Thickness"
        min={0}
        max={80}
        typeMax={600}
        value={width}
        format={(v) => (v === 0 ? 'Thin' : String(v))}
        onChange={(v) => live.change((doc) => ({ ...doc, guides: doc.guides.map((g) => (ids.has(g.id) ? ({ ...g, width: v } as Guide) : g)) }))}
        onCommit={live.commit}
      />
      {lines && width > 0 && (
        <div className="pb-2 pt-1">
          <Segmented<'round' | 'flat'>
            label="Ends"
            value={ends}
            onChange={(v) => commit({ ...getDoc(), guides: getDoc().guides.map((g) => (ids.has(g.id) && g.type === 'line' ? { ...g, ends: v } : g)), updatedAt: Date.now() })}
            options={[
              { value: 'round', label: 'Round ends' },
              { value: 'flat', label: 'Flat ends' },
            ]}
          />
        </div>
      )}
      {closed && (
        <div className="pb-2 pt-1">
          <Segmented<Band>
            label="Thicken towards"
            value={band}
            onChange={(b) => commit({ ...getDoc(), guides: getDoc().guides.map((g) => (ids.has(g.id) && g.type !== 'line' ? ({ ...g, band: b } as Guide) : g)), updatedAt: Date.now() })}
            options={[
              { value: 'in', label: 'Inside' },
              { value: 'mid', label: 'Middle' },
              { value: 'out', label: 'Outside' },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A border around the selected shapes (letters included): how wide it shows,
 * and its color. Drawn behind each shape, so the shapes keep their size.
 */
function BorderControls({ shapes }: { shapes: Shape[] }) {
  const live = useLiveEdit();
  const palette = useDoc((s) => s.doc.palette);
  const first = shapes[0]!;
  const width = first.stroke ? Math.round(first.stroke.outside ? first.stroke.width / 2 : first.stroke.width) : 0;
  const color: Fill = first.stroke?.color ?? (palette.length > 1 ? 1 : '#ffffff');
  const ids = new Set(shapes.map((s) => s.id));
  const set = (w: number, c: Fill): void =>
    live.change((doc) => {
      const groups = { ...doc.groups };
      // a whole word keeps its border when it is retyped
      for (const g of Object.values(doc.groups)) {
        if (!g.text) continue;
        const members = doc.shapes.filter((s) => s.group === g.id);
        if (members.length && members.every((s) => ids.has(s.id)))
          groups[g.id] = { ...g, text: { ...g.text, border: w > 0 ? { width: w, fill: c, hollow: members[0]!.fill === null || undefined } : undefined } };
      }
      return {
        ...doc,
        groups,
        shapes: doc.shapes.map((s) => (!ids.has(s.id) ? s : w <= 0 ? { ...s, stroke: undefined } : { ...s, stroke: borderStroke({ width: w, fill: c, hollow: s.fill === null }) })),
        updatedAt: Date.now(),
      };
    });
  const swatches: { fill: Fill; color: string; name: string }[] = [
    ...palette.map((c, i) => ({ fill: i as Fill, color: c, name: `Color ${i + 1}` })),
    { fill: '#ffffff', color: '#ffffff', name: 'White' },
    { fill: '#000000', color: '#000000', name: 'Black' },
  ];
  return (
    <div className="bar-menu-pad">
      <div className="text-[12px] font-semibold text-muted">Border</div>
      <Slider label="Border" min={0} max={40} typeMax={200} value={width} format={(v) => (v === 0 ? 'None' : String(v))} onChange={(v) => set(v, color)} onCommit={live.commit} />
      <div className="basic-grid" style={{ paddingTop: 4 }} role="group" aria-label="Border color">
        {swatches.map((x) => (
          <button
            key={String(x.fill)}
            type="button"
            className="basic-dot"
            style={{ background: x.color }}
            aria-label={`Border ${x.name.toLowerCase()}`}
            data-active={(width > 0 && color === x.fill) || undefined}
            onClick={() => {
              set(Math.max(width, 4), x.fill);
              live.commit();
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** One labelled slider in a bar. */
function BarSlider({ name, width = 190, ...props }: { name: string; width?: number } & Parameters<typeof Slider>[0]) {
  return (
    <div className="flex items-center gap-2 pl-2 pr-1" style={{ width }}>
      <span className="whitespace-nowrap text-[12px] font-semibold text-muted">{name}</span>
      <Slider {...props} />
    </div>
  );
}

/** Setting up a pattern: in a row, around a circle or in a grid; how many, and how far apart. */
function PatternBar() {
  const p = useUi((s) => s.pattern)!;
  const held = useDoc((s) => s.held);
  const phone = useIsPhone();
  const box = useMemo(() => (held ? selectionBBox(held, p.ids) : null), [held, p.ids]);
  const size = Math.max(1, box?.w ?? 1, box?.h ?? 1);
  const spec = p.spec;
  const set = (patch: Partial<PatternSpec>): void => setPattern({ ...spec, ...patch });
  const circle = spec.kind === 'circle';
  const kind = (
    <Segmented<PatternKind>
      label="Pattern"
      value={spec.kind}
      onChange={(k) => box && setPattern({ ...defaultPattern(k, box), ...(k === spec.kind ? spec : {}) })}
      options={[
        { value: 'row', label: 'Row' },
        { value: 'circle', label: 'Circle' },
        { value: 'grid', label: 'Grid' },
      ]}
    />
  );
  const w = phone ? 236 : 190;
  const sliders = (
    <>
      <BarSlider
        width={w}
        name={spec.kind === 'grid' ? 'Across' : 'Count'}
        label={spec.kind === 'grid' ? 'Across' : 'Count'}
        min={spec.kind === 'grid' ? 1 : 2}
        max={circle ? 36 : 24}
        typeMax={200}
        value={spec.count}
        onChange={(v) => set({ count: v })}
      />
      {spec.kind === 'grid' && <BarSlider width={w} name="Down" label="Down" min={1} max={24} typeMax={200} value={spec.rows} onChange={(v) => set({ rows: v })} />}
      <BarSlider
        width={w}
        name={circle ? 'Radius' : 'Distance'}
        label={circle ? 'Radius' : 'Distance'}
        min={circle ? Math.round(size * 0.3) : -Math.round(size * 0.5)}
        max={Math.round(size * (circle ? 6 : 3))}
        typeMax={Math.round(size * 40)}
        value={spec.distance}
        onChange={(v) => set({ distance: v })}
      />
      {spec.kind === 'row' && <BarSlider width={w} name="Angle" label="Angle" min={-180} max={180} value={spec.angle} format={(v) => `${Math.round(v)}°`} onChange={(v) => set({ angle: v })} />}
    </>
  );
  const end = (
    <>
      <Chip tip="Cancel pattern" label={phone ? undefined : 'Cancel'} icon={<X />} onClick={() => finishPattern(false)} />
      <Done onClick={() => finishPattern(true)} />
    </>
  );
  if (phone) {
    return (
      <div className="glass bar rise" role="toolbar" aria-label="Pattern">
        <Menu name="Pattern settings" icon={<SlidersHorizontal />} label="Pattern" width={268}>
          <div className="bar-menu-pad grid gap-2">
            {kind}
            {sliders}
          </div>
        </Menu>
        <span className="sep" />
        {end}
      </div>
    );
  }
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Pattern">
      <div className="pl-1" style={{ width: 210 }}>
        {kind}
      </div>
      {sliders}
      <span className="sep" />
      {end}
    </div>
  );
}

/** Rounding off a crossing: how big the arc is. */
function FilletBar() {
  const f = useUi((s) => s.fillet)!;
  const phone = useIsPhone();
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Round crossing">
      <BarSlider width={phone ? 220 : 280} name="Radius" label="Radius" min={1} max={Math.max(2, Math.floor(f.max))} value={Math.round(f.r)} onChange={setFillet} />
      <span className="sep" />
      <Chip tip="Cancel" label={phone ? undefined : 'Cancel'} icon={<X />} onClick={() => finishFillet(false)} />
      <Done onClick={() => finishFillet(true)} />
    </div>
  );
}

/** Rounding of one corner, or of all of them: a slider, a number that can be typed, and a way back to sharp. */
function CornerBar({ guide, index }: { guide: Guide; index: number }) {
  const live = useLiveEdit();
  const phone = useIsPhone();
  const count = guide.type === 'rect' ? 4 : guide.type === 'poly' ? guide.pts.length : 0;
  let max = Infinity;
  if (index < 0) for (let i = 0; i < count; i++) max = Math.min(max, maxCornerRadius(guide, i));
  else max = maxCornerRadius(guide, index);
  max = Math.max(1, Math.round(Number.isFinite(max) ? max : 1));
  const value = Math.round(cornerRadius(guide, index));
  const set = (v: number): void => live.change((doc) => ({ ...doc, guides: doc.guides.map((g) => (g.id === guide.id ? setCornerRadius(g, index, v) : g)) }));
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Corner rounding">
      <div className="flex items-center gap-2 pl-3 pr-1" style={{ width: phone ? 230 : 280 }}>
        <span className="whitespace-nowrap text-[12px] font-semibold text-muted">{index < 0 ? 'All corners' : 'Corner'}</span>
        <Slider label="Corner rounding" min={0} max={max} value={Math.min(value, max)} onChange={set} onCommit={live.commit} />
      </div>
      {!phone && (
        <Chip
          tip="Remove rounding"
          label="Sharp"
          icon={<Square />}
          disabled={value === 0}
          onClick={() => {
            set(0);
            live.commit();
          }}
        />
      )}
      <span className="sep" />
      <Done onClick={() => useUi.setState({ corner: null })} />
    </div>
  );
}

// --- Bars for tools ---------------------------------------------------------------

function PhotoBar({ id }: { id: string }) {
  const ref = useDoc((s) => s.doc.refs.find((r) => r.id === id));
  const live = useLiveEdit();
  const phone = useIsPhone();
  if (!ref) return null;
  const lock = (): void => commit(updateRef(getDoc(), id, { locked: !ref.locked }));
  const top = (): void => commit(updateRef(getDoc(), id, { above: !ref.above }));
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Photo">
      <div className="flex items-center gap-2 pl-3 pr-1" style={{ width: phone ? 210 : 220 }}>
        <span className="text-[12px] font-semibold text-muted">Fade</span>
        <Slider label="Photo opacity" min={5} max={100} value={Math.round(ref.opacity * 100)} onChange={(v) => live.change((doc) => updateRef(doc, id, { opacity: v / 100 }))} onCommit={live.commit} />
      </div>
      <span className="sep" />
      {phone ? (
        <Menu name="More for this photo" icon={<Ellipsis />} label="More" width={236}>
          <Row icon={ref.locked ? <LockOpen /> : <Lock />} label={ref.locked ? 'Unlock' : 'Lock in place'} onClick={lock} />
          <Row icon={<Layers2 />} label="Show over colors" active={!!ref.above} onClick={top} />
          <Row icon={<Replace />} label="Replace photo" onClick={pickPhoto} />
          <div className="menu-sep" />
          <Row icon={<Trash2 />} label="Remove photo" tone="danger" onClick={deleteSelection} />
        </Menu>
      ) : (
        <>
          <Chip tip={ref.locked ? 'Unlock to move or resize the photo' : 'Lock the photo in place'} label={ref.locked ? 'Adjust' : 'Lock'} icon={ref.locked ? <LockOpen /> : <Lock />} onClick={lock} />
          <Chip tip={ref.above ? 'Put photo back underneath' : 'Show photo over colors to keep tracing'} label="On top" icon={<Layers2 />} active={!!ref.above} onClick={top} />
          <Chip tip="Replace photo" label="Replace" icon={<Replace />} onClick={pickPhoto} />
          <Chip tip="Remove photo" icon={<Trash2 />} tone="danger" onClick={deleteSelection} />
        </>
      )}
    </div>
  );
}

/** A tool's bar: its hint (desktop; phones show it at the top), then its controls. */
function ToolBar({ name, hint, children }: { name: string; hint: string | null; children?: ReactNode }) {
  const phone = useIsPhone();
  return (
    <div className="glass bar rise" role="toolbar" aria-label={name}>
      {!phone && hint && (
        <>
          <Hint>{hint}</Hint>
          <span className="sep" />
        </>
      )}
      {children}
    </div>
  );
}

function ColorBar({ hint }: { hint: string | null }) {
  return (
    <ToolBar name="Color" hint={hint}>
      <Done />
    </ToolBar>
  );
}

function PenBar({ hint }: { hint: string | null }) {
  const count = usePen((s) => s.count);
  const touch = useIsTouch();
  return (
    <ToolBar name="Pen" hint={hint}>
      {count > 0 && (
        <>
          <Chip tip="Remove last point" keys={touch ? undefined : 'Backspace'} label="Back" icon={<Undo2 />} onClick={undoPenPoint} />
          <Chip tip="Close shape" label="Close" icon={<CircleDot />} disabled={count < 3} onClick={() => finishPen(true)} />
        </>
      )}
      <Chip
        tip="Finish the path"
        keys={touch ? undefined : 'Enter'}
        label="Done"
        icon={<Check />}
        onClick={() => {
          finishPen(false);
          doneTool();
        }}
      />
    </ToolBar>
  );
}

function BrushBar() {
  const width = useUi((s) => s.brushWidth);
  const phone = useIsPhone();
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Brush">
      <div className="flex items-center gap-2 pl-3 pr-1" style={{ width: phone ? 230 : 250 }}>
        <span className="text-[12px] font-semibold text-muted">Size</span>
        <Slider label="Brush size" min={1} max={60} typeMax={400} value={Math.round(width)} onChange={(v) => useUi.setState({ brushWidth: v })} />
      </div>
      <span className="sep" />
      <Done />
    </div>
  );
}

function CutBar({ hint }: { hint: string | null }) {
  const showCuts = useUi((s) => s.showCuts);
  const any = useDoc((s) => !!s.doc.trimmed?.length || s.doc.guides.some((g) => g.type === 'line' && g.cut));
  return (
    <ToolBar name="Cut" hint={hint}>
      {any && (
        <Chip
          tip={showCuts ? 'Hide what was cut' : 'Show what was cut, to bring pieces back'}
          label="Cut lines"
          icon={showCuts ? <Eye /> : <EyeOff />}
          active={showCuts}
          onClick={() => useUi.setState({ showCuts: !showCuts })}
        />
      )}
      <Done />
    </ToolBar>
  );
}

function NumBox({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const apply = (): void => {
    if (text === null) return;
    const v = parseFloat(text.replace(',', '.'));
    setText(null);
    if (Number.isFinite(v) && v !== value) onCommit(v);
  };
  return (
    <label className="flex h-[34px] items-center gap-1 rounded-[10px] bg-sunken px-2 text-[13px]">
      <span className="font-semibold text-muted">{label}</span>
      <input
        className="w-[5ch] bg-transparent outline-none"
        style={{ fontVariantNumeric: 'tabular-nums' }}
        inputMode="decimal"
        aria-label={label}
        value={text ?? String(Math.round(value))}
        onFocus={() => setText(String(Math.round(value)))}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

function FrameBar() {
  const art = useDoc((s) => s.doc.artboard);
  const b = board({ artboard: art });
  const hasArt = useDoc((s) => s.doc.shapes.length > 0);
  const phone = useIsPhone();
  const size = (
    <>
      <NumBox label="W" value={b.w} onCommit={(v) => setBoard({ ...b, w: v })} />
      <NumBox label="H" value={b.h} onCommit={(v) => setBoard({ ...b, h: v })} />
    </>
  );
  if (phone) {
    return (
      <div className="glass bar rise" role="toolbar" aria-label="Frame size">
        <Menu name="Frame size and shape" icon={<Crop />} label="Size" width={236}>
          <div className="bar-menu-pad flex items-center gap-2">{size}</div>
          <div className="menu-sep" />
          <Row icon={<Square />} label="Square" keep onClick={() => setBoardRatio(1, 1)} />
          <Row icon={<Crop />} label="Wide 4 : 3" keep onClick={() => setBoardRatio(4, 3)} />
          <Row icon={<Crop />} label="Wide 16 : 9" keep onClick={() => setBoardRatio(16, 9)} />
          <Row icon={<Crop />} label="Tall 3 : 4" keep onClick={() => setBoardRatio(3, 4)} />
          <Row icon={<Scaling />} label="Fit to artwork" keep disabled={!hasArt} onClick={fitBoardToArtwork} />
        </Menu>
        <span className="sep" />
        <Done onClick={() => editFrame(false)} />
      </div>
    );
  }
  return (
    <div className="glass bar rise scroll-x" role="toolbar" aria-label="Frame size">
      <span className="whitespace-nowrap pl-3 pr-1 text-[13px] font-medium text-muted">Frame size</span>
      {size}
      <span className="sep" />
      <Chip tip="Square" label="1:1" onClick={() => setBoardRatio(1, 1)} />
      <Chip tip="Wide 4 : 3" label="4:3" onClick={() => setBoardRatio(4, 3)} />
      <Chip tip="Wide 16 : 9" label="16:9" onClick={() => setBoardRatio(16, 9)} />
      <Chip tip="Fit frame to artwork" label="Fit artwork" disabled={!hasArt} onClick={fitBoardToArtwork} />
      <span className="sep" />
      <Done onClick={() => editFrame(false)} />
    </div>
  );
}

// --- The bar ------------------------------------------------------------------------

export function ContextBar() {
  const phone = useIsPhone();
  const touch = useIsTouch();
  const key = useKeys();
  const hint = useHint();
  const tool = useUi((s) => s.tool);
  const selection = useUi((s) => s.selection);
  const multi = useUi((s) => s.multi);
  const frameEdit = useUi((s) => s.frameEdit);
  const corner = useUi((s) => s.corner);
  const selectMode = useUi((s) => s.selectMode);
  const pattern = useUi((s) => !!s.pattern);
  const fillet = useUi((s) => !!s.fillet);
  const doc = useDoc((s) => s.doc);
  // re-render when Repeat becomes available
  useUi((s) => s.lastDup);

  if (frameEdit) return <FrameBar />;
  if (pattern) return <PatternBar />;
  if (fillet) return <FilletBar />;
  if (tool === 'color') return <ColorBar hint={hint} />;
  if (tool === 'pen') return <PenBar hint={hint} />;
  if (tool === 'brush') return <BrushBar />;
  if (tool === 'cut') return <CutBar hint={hint} />;
  if (tool === 'draw') {
    return (
      <ToolBar name="Draw" hint={hint}>
        <Done />
      </ToolBar>
    );
  }
  if (tool === 'mirror') {
    return (
      <ToolBar name="Mirror copy" hint={hint}>
        <Done />
      </ToolBar>
    );
  }
  if (selection.length === 0) {
    if (selectMode === 'move') return null;
    return (
      <ToolBar name="Select mode" hint={hint}>
        <Done onClick={() => useUi.setState({ selectMode: 'move' })} />
      </ToolBar>
    );
  }

  const guides = doc.guides.filter((g) => selection.includes(g.id));
  const shapes = doc.shapes.filter((s) => selection.includes(s.id));
  const refs = doc.refs.filter((r) => selection.includes(r.id));
  if (refs.length === 1 && selection.length === 1) return <PhotoBar id={refs[0]!.id} />;

  const onlyOutlines = guides.length > 0 && shapes.length === 0;
  const one = guides.length === 1 && shapes.length === 0 ? guides[0]! : null;
  const cornered = one && (one.type === 'poly' || one.type === 'rect') ? one : null;
  if (corner && cornered && cornered.id === corner.id) return <CornerBar guide={cornered} index={corner.index} />;

  const group = shapes.length && shapes.every((s) => s.group && s.group === shapes[0]!.group) ? doc.groups[shapes[0]!.group!] : undefined;
  const wholeWord = group && doc.shapes.filter((s) => s.group === group.id).length === shapes.length;
  const editable = !!(wholeWord && group?.text?.pristine);
  const grouped = selectionGroups().length > 0;
  const editText = (): void => void (group && useUi.setState({ sheet: 'text', textTarget: group.id }));
  const toggleMulti = (): void => useUi.setState({ multi: !multi });
  const hold = touch ? 'press and hold' : 'right-click';

  if (phone) {
    // One or two buttons; the rest is one tap away under Options.
    return (
      <div className="glass bar rise" role="toolbar" aria-label="Selection">
        <Menu name="Options" icon={<SlidersHorizontal />} label="Options" width={272}>
          {onlyOutlines && (
            <>
              <ThicknessControls guides={guides} />
              <div className="menu-sep" />
            </>
          )}
          {shapes.length > 0 && (
            <>
              <BorderControls shapes={shapes} />
              <div className="menu-sep" />
            </>
          )}
          {cornered && <Row icon={<SquareRoundCorner />} label="Round corners" onClick={() => roundCorner(cornered, -1)} />}
          {editable && <Row icon={<CopyPlus />} label="Duplicate" onClick={duplicateSelection} />}
          <Row icon={<Repeat2 />} label="Repeat, same spacing" disabled={!canRepeat()} onClick={repeatDuplicate} />
          <Row icon={<Grid2x2 />} label="Pattern" onClick={() => startPattern()} />
          <Row icon={<FlipVertical2 />} label="Flip sideways" onClick={() => flipSelection('h')} />
          <Row icon={<FlipHorizontal2 />} label="Flip upside down" onClick={() => flipSelection('v')} />
          <Row icon={<FlipHorizontal />} label="Mirror copy" onClick={startMirror} />
          {selection.length > 1 && !grouped && <Row icon={<GroupIcon />} label="Group" onClick={groupSelection} />}
          {grouped && !group?.text && <Row icon={<Ungroup />} label="Ungroup" onClick={ungroupSelection} />}
          {selectMode === 'single' ? (
            <Row icon={<SquareDashed />} label="Select none" onClick={() => useUi.setState({ selection: [] })} />
          ) : (
            <Row icon={<SquareDashedMousePointer />} label="Select more" active={multi} onClick={toggleMulti} />
          )}
        </Menu>
        {editable ? <Chip tip="Edit text" label="Edit" icon={<Pencil />} onClick={editText} /> : <Chip tip="Duplicate" label="Duplicate" icon={<CopyPlus />} onClick={duplicateSelection} />}
        <span className="sep" />
        <Chip tip="Delete" icon={<Trash2 />} tone="danger" onClick={deleteSelection} />
      </div>
    );
  }

  return (
    <div className="glass bar rise scroll-x" role="toolbar" aria-label="Selection">
      {editable && <Chip tip={`Edit text (or ${touch ? 'double-tap' : 'double-click'})`} label="Edit" icon={<Pencil />} onClick={editText} />}
      {onlyOutlines && (
        <Menu name="Thickness" icon={<SlidersHorizontal />} label="Thickness" width={280}>
          <ThicknessControls guides={guides} />
        </Menu>
      )}
      {cornered && <Chip tip={`Round all the corners (${hold} a corner for just that one)`} label="Corners" icon={<SquareRoundCorner />} onClick={() => roundCorner(cornered, -1)} />}
      {touch && selectMode !== 'single' && (
        <Chip tip="Add to selection with each tap" label={multi ? 'Selecting' : 'Select more'} icon={<SquareDashedMousePointer />} active={multi} onClick={toggleMulti} />
      )}
      <Chip tip="Duplicate" keys={key('duplicate')} label="Duplicate" icon={<CopyPlus />} onClick={duplicateSelection} />
      <Menu name="Repeat" icon={<Repeat2 />} label="Repeat" width={236} hover={!touch}>
        <Row icon={<Repeat2 />} label="Repeat, same spacing" disabled={!canRepeat()} onClick={repeatDuplicate} />
        <Row icon={<Grid2x2 />} label="Pattern: row, circle, grid" onClick={() => startPattern()} />
      </Menu>
      {shapes.length > 0 && (
        <Menu name="Border" icon={<SquareSquare />} label="Border" width={268}>
          <BorderControls shapes={shapes} />
        </Menu>
      )}
      <Menu name="Flip" icon={<FlipVertical2 />} label="Flip" width={236} hover={!touch}>
        <Row icon={<FlipVertical2 />} label="Flip sideways" onClick={() => flipSelection('h')} />
        <Row icon={<FlipHorizontal2 />} label="Flip upside down" onClick={() => flipSelection('v')} />
        <Row icon={<FlipHorizontal />} label="Mirror copy" onClick={startMirror} />
      </Menu>
      {selection.length > 1 && !grouped && <Chip tip="Group: move as one" keys={key('group')} label="Group" icon={<GroupIcon />} onClick={groupSelection} />}
      {grouped && !group?.text && <Chip tip="Ungroup" keys={key('ungroup')} label="Ungroup" icon={<Ungroup />} onClick={ungroupSelection} />}
      <span className="sep" />
      <Chip tip="Delete" keys={key('delete')} icon={<Trash2 />} tone="danger" onClick={deleteSelection} />
    </div>
  );
}
