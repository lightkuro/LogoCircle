import { useState } from 'react';
import {
  Check,
  CircleDot,
  CopyPlus,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Group as GroupIcon,
  Layers2,
  Lock,
  LockOpen,
  MousePointerClick,
  Pencil,
  Repeat2,
  Replace,
  SlidersHorizontal,
  SquareDashedMousePointer,
  SquareRoundCorner,
  Trash2,
  Undo2,
  Ungroup,
} from 'lucide-react';
import { Popover } from '@base-ui/react/popover';
import { useDoc, getDoc, commit } from '@/store/doc';
import { useUi } from '@/store/ui';
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

function Chip({ label, icon, onClick, disabled, tone, tip, keys, active }: { label?: string; icon?: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'danger'; tip: string; keys?: string; active?: boolean }) {
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

const Hint = ({ children }: { children: React.ReactNode }) => (
  <span className="flex items-center gap-2 whitespace-nowrap pl-3 pr-2 text-[13px] font-medium text-muted">
    <MousePointerClick style={{ width: 16, height: 16, flexShrink: 0 }} />
    {children}
  </span>
);

const Done = () => <Chip tip="Finish and go back to moving things" keys="Esc" label="Done" icon={<Check />} onClick={doneTool} />;

/** Thickness for outlines. Kept first in the bar and the bar kept the same around it, so it never shifts while dragging. */
function Thickness({ guides }: { guides: Guide[] }) {
  const live = useLiveEdit();
  const width = Math.round(guideWidth(guides[0]!));
  const ids = new Set(guides.map((g) => g.id));
  const closed = guides.every(isClosedOutline);
  const band = guideBand(guides[0]!);
  return (
    <Popover.Root>
      <Popover.Trigger className="chip" aria-label="Thickness">
        <SlidersHorizontal />
        Thickness
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={12} style={{ zIndex: 30 }}>
          <Popover.Popup className="pop" style={{ width: 280, padding: '10px 14px 12px' }}>
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
            <p className="m-0 text-[12px] leading-snug text-muted">A thick outline is a band. With it selected, tap a color to color it.</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CornerSlider({ guide, index }: { guide: Guide; index: number }) {
  const live = useLiveEdit();
  const max = Math.max(
    1,
    Math.round(index < 0 && guide.type === 'poly' ? Math.min(...guide.pts.map((_, i) => maxCornerRadius(guide, i))) : maxCornerRadius(guide, Math.max(0, index))),
  );
  const value = Math.round(index < 0 && guide.type === 'poly' ? Math.max(0, ...(guide.radii ?? [0])) : cornerRadius(guide, Math.max(0, index)));
  return (
    <div className="flex items-center gap-2 pl-3 pr-1" style={{ width: 250 }}>
      <span className="whitespace-nowrap text-[12px] font-semibold text-muted">{index < 0 || guide.type === 'rect' ? 'Corners' : 'Corner'}</span>
      <Slider
        label="Corner rounding"
        min={0}
        max={max}
        value={Math.min(value, max)}
        onChange={(v) => live.change((doc) => ({ ...doc, guides: doc.guides.map((g) => (g.id === guide.id ? setCornerRadius(g, index, v) : g)) }))}
        onCommit={live.commit}
      />
    </div>
  );
}

function PhotoBar({ id }: { id: string }) {
  const ref = useDoc((s) => s.doc.refs.find((r) => r.id === id));
  const live = useLiveEdit();
  if (!ref) return null;
  return (
    <div className="glass bar rise scroll-x" role="toolbar" aria-label="Photo">
      <div className="flex items-center gap-2 pl-3 pr-1" style={{ width: 220 }}>
        <span className="text-[12px] font-semibold text-muted">Fade</span>
        <Slider
          label="Photo opacity"
          min={5}
          max={100}
          value={Math.round(ref.opacity * 100)}
          onChange={(v) => live.change((doc) => updateRef(doc, id, { opacity: v / 100 }))}
          onCommit={live.commit}
        />
      </div>
      <span className="sep" />
      <Chip
        tip={ref.locked ? 'Unlock to move or resize the photo' : 'Lock the photo in place'}
        label={ref.locked ? 'Adjust' : 'Lock'}
        icon={ref.locked ? <LockOpen /> : <Lock />}
        onClick={() => commit(updateRef(getDoc(), id, { locked: !ref.locked }))}
      />
      <Chip
        tip={ref.above ? 'Put the photo back underneath' : 'Show the photo over the colors, to keep tracing'}
        label="On top"
        icon={<Layers2 />}
        active={!!ref.above}
        onClick={() => commit(updateRef(getDoc(), id, { above: !ref.above }))}
      />
      <Chip tip="Choose another photo" label="Replace" icon={<Replace />} onClick={pickPhoto} />
      <Chip tip="Remove photo" icon={<Trash2 />} tone="danger" onClick={deleteSelection} />
    </div>
  );
}

function ColorBar() {
  const paper = useDoc((s) => s.doc.paper);
  const erasing = useUi((s) => s.erasing);
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Color">
      <Hint>{erasing ? 'Tap areas to clear' : 'Tap areas to color'}</Hint>
      <span className="sep" />
      <Tip label="Paper color">
        <button type="button" className="chip" data-swatch onClick={() => useUi.setState((s) => ({ colorPanel: s.colorPanel === 'paper' ? null : 'paper' }))}>
          <span className={`swatch-sm ${paper ? '' : 'swatch-clear'}`} style={paper ? { background: paper } : undefined} />
          Paper
        </button>
      </Tip>
      <Done />
    </div>
  );
}

function PenBar() {
  const count = usePen((s) => s.count);
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Pen">
      <Hint>{count === 0 ? 'Tap to place points. Drag to bend.' : `${count} point${count === 1 ? '' : 's'}`}</Hint>
      <span className="sep" />
      {count > 0 && (
        <>
          <Chip tip="Remove the last point" keys="⌫" label="Back" icon={<Undo2 />} onClick={undoPenPoint} />
          <Chip tip="Join the end to the start" label="Close" icon={<CircleDot />} disabled={count < 3} onClick={() => finishPen(true)} />
        </>
      )}
      <Chip
        tip="Finish the path"
        keys="↵"
        label="Done"
        icon={<Check />}
        onClick={() => {
          finishPen(false);
          doneTool();
        }}
      />
    </div>
  );
}

function BrushBar() {
  const width = useUi((s) => s.brushWidth);
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Brush">
      <div className="flex items-center gap-2 pl-3 pr-1" style={{ width: 250 }}>
        <span className="text-[12px] font-semibold text-muted">Size</span>
        <Slider label="Brush size" min={1} max={60} typeMax={400} value={Math.round(width)} onChange={(v) => useUi.setState({ brushWidth: v })} />
      </div>
      <span className="sep" />
      <Done />
    </div>
  );
}

function CutBar() {
  const showCuts = useUi((s) => s.showCuts);
  const any = useDoc((s) => s.doc.guides.some((g) => g.type === 'line' && g.cut));
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Cut">
      <Hint>Drag a line across what you want to cut</Hint>
      <span className="sep" />
      <Chip
        tip={showCuts ? 'Hide the dashed cut lines' : 'Show where things were cut'}
        label="Cut lines"
        icon={showCuts ? <Eye /> : <EyeOff />}
        active={showCuts && any}
        disabled={!any}
        onClick={() => useUi.setState({ showCuts: !showCuts })}
      />
      <Done />
    </div>
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
  return (
    <div className="glass bar rise scroll-x" role="toolbar" aria-label="Export frame">
      <span className="whitespace-nowrap pl-3 pr-1 text-[13px] font-medium text-muted">Export frame</span>
      <NumBox label="W" value={b.w} onCommit={(v) => setBoard({ ...b, w: v })} />
      <NumBox label="H" value={b.h} onCommit={(v) => setBoard({ ...b, h: v })} />
      <span className="sep" />
      <Chip tip="Square" label="1:1" onClick={() => setBoardRatio(1, 1)} />
      <Chip tip="Wide 4 : 3" label="4:3" onClick={() => setBoardRatio(4, 3)} />
      <Chip tip="Wide 16 : 9" label="16:9" onClick={() => setBoardRatio(16, 9)} />
      <Chip tip="Wrap the frame around the artwork" label="Fit artwork" disabled={!hasArt} onClick={fitBoardToArtwork} />
      <span className="sep" />
      <Chip tip="Finish" keys="Esc" label="Done" icon={<Check />} onClick={() => editFrame(false)} />
    </div>
  );
}

const MODE_HINT: Record<string, string> = {
  pan: 'Pan: drag to move around',
  box: 'Box select: drag a box around things',
  lasso: 'Lasso: draw around things to select them',
  single: 'One at a time: taps pick single pieces, even inside a group',
};

export function ContextBar() {
  const tool = useUi((s) => s.tool);
  const selection = useUi((s) => s.selection);
  const multi = useUi((s) => s.multi);
  const frameEdit = useUi((s) => s.frameEdit);
  const corner = useUi((s) => s.corner);
  const selectMode = useUi((s) => s.selectMode);
  const doc = useDoc((s) => s.doc);
  // re-render when Repeat becomes available
  useUi((s) => s.lastDup);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  if (frameEdit) return <FrameBar />;
  if (tool === 'color') return <ColorBar />;
  if (tool === 'pen') return <PenBar />;
  if (tool === 'brush') return <BrushBar />;
  if (tool === 'cut') return <CutBar />;
  if (tool === 'draw') {
    return (
      <div className="glass bar rise" role="toolbar" aria-label="Draw">
        <Hint>Draw a line. It comes out as a smooth curve.</Hint>
        <span className="sep" />
        <Done />
      </div>
    );
  }
  if (selection.length === 0) {
    if (selectMode === 'move') return null;
    return (
      <div className="glass bar rise" role="toolbar" aria-label="Select mode">
        <Hint>{MODE_HINT[selectMode]}</Hint>
        <span className="sep" />
        <Chip tip="Back to moving things" label="Done" icon={<Check />} onClick={() => useUi.setState({ selectMode: 'move' })} />
      </div>
    );
  }

  const guides = doc.guides.filter((g) => selection.includes(g.id));
  const shapes = doc.shapes.filter((s) => selection.includes(s.id));
  const refs = doc.refs.filter((r) => selection.includes(r.id));
  if (refs.length === 1 && selection.length === 1) return <PhotoBar id={refs[0]!.id} />;

  const onlyOutlines = guides.length > 0 && shapes.length === 0;
  const one = guides.length === 1 && shapes.length === 0 ? guides[0]! : null;
  const cornerGuide = corner && one && one.id === corner.id && (one.type === 'poly' || one.type === 'rect') ? one : null;
  const group = shapes.length && shapes.every((s) => s.group && s.group === shapes[0]!.group) ? doc.groups[shapes[0]!.group!] : undefined;
  const wholeWord = group && doc.shapes.filter((s) => s.group === group.id).length === shapes.length;
  const grouped = selectionGroups().length > 0;

  return (
    <div className="glass bar rise scroll-x" role="toolbar" aria-label="Selection">
      {wholeWord && group?.text?.pristine && (
        <Chip tip="Edit the text (or double-click it)" label="Edit" icon={<Pencil />} onClick={() => useUi.setState({ sheet: 'text', textTarget: group.id })} />
      )}
      {onlyOutlines && <Thickness guides={guides} />}
      {cornerGuide ? (
        <CornerSlider guide={cornerGuide} index={corner!.index} />
      ) : (
        one && (one.type === 'poly' || one.type === 'rect') && <Chip tip="Round the corners (right-click a corner for just that one)" label="Corners" icon={<SquareRoundCorner />} onClick={() => roundCorner(one, -1)} />
      )}
      {coarse && (
        <Chip
          tip="Keep adding to the selection with each tap"
          label={multi ? 'Selecting' : 'Select more'}
          icon={<SquareDashedMousePointer />}
          active={multi}
          onClick={() => useUi.setState({ multi: !multi })}
        />
      )}
      <Chip tip="Duplicate" keys="Ctrl D" label="Duplicate" icon={<CopyPlus />} onClick={duplicateSelection} />
      <Chip tip="Repeat: copy again with the same spacing" keys="Ctrl Shift D" label="Repeat" icon={<Repeat2 />} disabled={!canRepeat()} onClick={repeatDuplicate} />
      <Chip tip="Flip left ↔ right" icon={<FlipHorizontal2 />} onClick={() => flipSelection('h')} />
      <Chip tip="Flip up ↕ down" icon={<FlipVertical2 />} onClick={() => flipSelection('v')} />
      {selection.length > 1 && !grouped && <Chip tip="Group: select and move these as one" keys="Ctrl G" label="Group" icon={<GroupIcon />} onClick={groupSelection} />}
      {grouped && !group?.text && <Chip tip="Ungroup" keys="Ctrl Shift G" label="Ungroup" icon={<Ungroup />} onClick={ungroupSelection} />}
      <span className="sep" />
      <Chip tip="Delete" keys="Del" icon={<Trash2 />} tone="danger" onClick={deleteSelection} />
    </div>
  );
}
