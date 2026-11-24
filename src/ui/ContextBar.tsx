import { useState, type ReactNode } from 'react';
import {
  Check,
  CircleDot,
  CopyPlus,
  Crop,
  Ellipsis,
  Eye,
  EyeOff,
  FlipVertical2,
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
  SquareDashedMousePointer,
  SquareRoundCorner,
  Trash2,
  Undo2,
  Ungroup,
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
  flipSelection,
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
import { updateRef } from '@/model/ops';
import type { Band, Guide } from '@/model/types';
import { finishPen, undoPenPoint, usePen } from '@/tools';
import { roundCorner } from './menus';
import { Segmented, Slider, Tip } from './primitives';
import { useLiveEdit } from './live';

// --- Pieces -------------------------------------------------------------------

function Chip({ label, icon, onClick, disabled, tone, tip, keys, active }: { label?: string; icon?: ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'danger'; tip: string; keys?: string; active?: boolean }) {
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
function Menu({ label, icon, name, children, width = 248 }: { label?: string; icon: ReactNode; name: string; children: ReactNode; width?: number }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="chip" aria-label={name}>
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
  return <Chip tip="Finish and go back to moving things" keys={touch ? undefined : 'Esc'} label={label} icon={<Check />} onClick={onClick} />;
}

// --- What to say about the tool in hand ------------------------------------------

const MODE_HINT = (tap: string): Record<string, string> => ({
  pan: 'Pan: drag to move around',
  box: 'Box select: drag a box around things',
  lasso: 'Lasso: draw around things to select them',
  single: `One at a time: ${tap.toLowerCase()} single pieces, even inside a group`,
});

/** One line about what the current tool or mode expects. Null when nothing needs saying. */
function useHint(): string | null {
  const touch = useIsTouch();
  const tool = useUi((s) => s.tool);
  const erasing = useUi((s) => s.erasing);
  const frameEdit = useUi((s) => s.frameEdit);
  const selectMode = useUi((s) => s.selectMode);
  const none = useUi((s) => s.selection.length === 0);
  const multi = useUi((s) => s.multi);
  const corner = useUi((s) => s.corner);
  const count = usePen((s) => s.count);
  const tap = touch ? 'Tap' : 'Click';
  if (frameEdit) return 'Drag the frame or its handles to set what gets exported';
  if (tool === 'color') return erasing ? `${tap} areas to clear them` : `${tap} areas to color them`;
  if (tool === 'pen') return count === 0 ? `${tap} to place points. Drag to bend.` : `${count} point${count === 1 ? '' : 's'}`;
  if (tool === 'brush') return 'Paint with the color you picked';
  if (tool === 'cut') return `${tap} a piece of an outline to remove it. Drag across a shape to slice it.`;
  if (tool === 'draw') return 'Draw a line. It comes out as a smooth curve.';
  if (corner) return corner.index < 0 ? 'Rounding all the corners' : 'Rounding this corner';
  if (multi) return `${tap} things to add them to the selection`;
  if (none && selectMode !== 'move') return MODE_HINT(tap)[selectMode] ?? null;
  return null;
}

/** Phones: the hint sits under the top bar, leaving the bottom for the controls. */
export function TopHint() {
  const text = useHint();
  if (!text) return null;
  return (
    <div className="hint-area" aria-live="polite">
      <div className="glass hint-pill rise-down" key={text}>
        <Info />
        <span>{text}</span>
      </div>
    </div>
  );
}

// --- Thickness and corners ------------------------------------------------------

function ThicknessControls({ guides }: { guides: Guide[] }) {
  const live = useLiveEdit();
  const touch = useIsTouch();
  const width = Math.round(guideWidth(guides[0]!));
  const ids = new Set(guides.map((g) => g.id));
  const closed = guides.every(isClosedOutline);
  const band = guideBand(guides[0]!);
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
      <p className="m-0 text-[12px] leading-snug text-muted">A thick outline is a band. With it selected, {touch ? 'tap' : 'click'} a color to color it.</p>
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
          tip="Make it sharp again"
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
          <Row icon={ref.locked ? <LockOpen /> : <Lock />} label={ref.locked ? 'Move or resize it' : 'Lock it in place'} onClick={lock} />
          <Row icon={<Layers2 />} label="Show over the colors" active={!!ref.above} onClick={top} />
          <Row icon={<Replace />} label="Choose another photo" onClick={pickPhoto} />
          <div className="menu-sep" />
          <Row icon={<Trash2 />} label="Remove photo" tone="danger" onClick={deleteSelection} />
        </Menu>
      ) : (
        <>
          <Chip tip={ref.locked ? 'Unlock to move or resize the photo' : 'Lock the photo in place'} label={ref.locked ? 'Adjust' : 'Lock'} icon={ref.locked ? <LockOpen /> : <Lock />} onClick={lock} />
          <Chip tip={ref.above ? 'Put the photo back underneath' : 'Show the photo over the colors, to keep tracing'} label="On top" icon={<Layers2 />} active={!!ref.above} onClick={top} />
          <Chip tip="Choose another photo" label="Replace" icon={<Replace />} onClick={pickPhoto} />
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
  const paper = useDoc((s) => s.doc.paper);
  return (
    <ToolBar name="Color" hint={hint}>
      <Tip label="Paper color">
        <button type="button" className="chip" data-swatch onClick={() => useUi.setState((s) => ({ colorPanel: s.colorPanel === 'paper' ? null : 'paper' }))}>
          <span className={`swatch-sm ${paper ? '' : 'swatch-clear'}`} style={paper ? { background: paper } : undefined} />
          Paper
        </button>
      </Tip>
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
          <Chip tip="Remove the last point" keys={touch ? undefined : 'Backspace'} label="Back" icon={<Undo2 />} onClick={undoPenPoint} />
          <Chip tip="Join the end to the start" label="Close" icon={<CircleDot />} disabled={count < 3} onClick={() => finishPen(true)} />
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
  const any = useDoc((s) => s.doc.guides.some((g) => g.type === 'line' && g.cut));
  return (
    <ToolBar name="Cut" hint={hint}>
      {any && (
        <Chip
          tip={showCuts ? 'Hide the dashed lines left by slicing' : 'Show where things were sliced'}
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
      <div className="glass bar rise" role="toolbar" aria-label="Export frame">
        <Menu name="Frame size and shape" icon={<Crop />} label="Size" width={236}>
          <div className="bar-menu-pad flex items-center gap-2">{size}</div>
          <div className="menu-sep" />
          <Row icon={<Square />} label="Square" keep onClick={() => setBoardRatio(1, 1)} />
          <Row icon={<Crop />} label="Wide 4 : 3" keep onClick={() => setBoardRatio(4, 3)} />
          <Row icon={<Crop />} label="Wide 16 : 9" keep onClick={() => setBoardRatio(16, 9)} />
          <Row icon={<Crop />} label="Tall 3 : 4" keep onClick={() => setBoardRatio(3, 4)} />
          <Row icon={<Scaling />} label="Fit to the artwork" keep disabled={!hasArt} onClick={fitBoardToArtwork} />
        </Menu>
        <span className="sep" />
        <Done onClick={() => editFrame(false)} />
      </div>
    );
  }
  return (
    <div className="glass bar rise scroll-x" role="toolbar" aria-label="Export frame">
      <span className="whitespace-nowrap pl-3 pr-1 text-[13px] font-medium text-muted">Export frame</span>
      {size}
      <span className="sep" />
      <Chip tip="Square" label="1:1" onClick={() => setBoardRatio(1, 1)} />
      <Chip tip="Wide 4 : 3" label="4:3" onClick={() => setBoardRatio(4, 3)} />
      <Chip tip="Wide 16 : 9" label="16:9" onClick={() => setBoardRatio(16, 9)} />
      <Chip tip="Wrap the frame around the artwork" label="Fit artwork" disabled={!hasArt} onClick={fitBoardToArtwork} />
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
  const doc = useDoc((s) => s.doc);
  // re-render when Repeat becomes available
  useUi((s) => s.lastDup);

  if (frameEdit) return <FrameBar />;
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
          {cornered && <Row icon={<SquareRoundCorner />} label="Round the corners" onClick={() => roundCorner(cornered, -1)} />}
          {editable && <Row icon={<CopyPlus />} label="Duplicate" onClick={duplicateSelection} />}
          <Row icon={<Repeat2 />} label="Repeat with the same spacing" disabled={!canRepeat()} onClick={repeatDuplicate} />
          <Row icon={<FlipVertical2 />} label="Flip sideways" onClick={() => flipSelection('h')} />
          <Row icon={<FlipHorizontal2 />} label="Flip upside down" onClick={() => flipSelection('v')} />
          {selection.length > 1 && !grouped && <Row icon={<GroupIcon />} label="Group" onClick={groupSelection} />}
          {grouped && !group?.text && <Row icon={<Ungroup />} label="Ungroup" onClick={ungroupSelection} />}
          <Row icon={<SquareDashedMousePointer />} label="Select more" active={multi} onClick={toggleMulti} />
          {cornered && <p className="bar-menu-note">Press and hold a corner to round just that one.</p>}
        </Menu>
        {editable ? <Chip tip="Edit the text" label="Edit" icon={<Pencil />} onClick={editText} /> : <Chip tip="Duplicate" label="Duplicate" icon={<CopyPlus />} onClick={duplicateSelection} />}
        <span className="sep" />
        <Chip tip="Delete" icon={<Trash2 />} tone="danger" onClick={deleteSelection} />
      </div>
    );
  }

  return (
    <div className="glass bar rise scroll-x" role="toolbar" aria-label="Selection">
      {editable && <Chip tip={`Edit the text (or ${touch ? 'double-tap' : 'double-click'} it)`} label="Edit" icon={<Pencil />} onClick={editText} />}
      {onlyOutlines && (
        <Menu name="Thickness" icon={<SlidersHorizontal />} label="Thickness" width={280}>
          <ThicknessControls guides={guides} />
        </Menu>
      )}
      {cornered && <Chip tip={`Round all the corners (${hold} a corner for just that one)`} label="Corners" icon={<SquareRoundCorner />} onClick={() => roundCorner(cornered, -1)} />}
      {touch && <Chip tip="Keep adding to the selection with each tap" label={multi ? 'Selecting' : 'Select more'} icon={<SquareDashedMousePointer />} active={multi} onClick={toggleMulti} />}
      <Chip tip="Duplicate" keys={key('duplicate')} label="Duplicate" icon={<CopyPlus />} onClick={duplicateSelection} />
      <Chip tip="Repeat: copy again with the same spacing" keys={key('repeat')} label="Repeat" icon={<Repeat2 />} disabled={!canRepeat()} onClick={repeatDuplicate} />
      <Chip tip="Flip sideways" icon={<FlipVertical2 />} onClick={() => flipSelection('h')} />
      <Chip tip="Flip upside down" icon={<FlipHorizontal2 />} onClick={() => flipSelection('v')} />
      {selection.length > 1 && !grouped && <Chip tip="Group: select and move these as one" keys={key('group')} label="Group" icon={<GroupIcon />} onClick={groupSelection} />}
      {grouped && !group?.text && <Chip tip="Ungroup" keys={key('ungroup')} label="Ungroup" icon={<Ungroup />} onClick={ungroupSelection} />}
      <span className="sep" />
      <Chip tip="Delete" keys={key('delete')} icon={<Trash2 />} tone="danger" onClick={deleteSelection} />
    </div>
  );
}
