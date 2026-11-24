import { Check, CircleDot, CopyPlus, Layers2, FlipHorizontal2, FlipVertical2, Lock, LockOpen, PaintBucket, Palette, Pencil, Repeat2, Replace, SlidersHorizontal, SquareDashedMousePointer, Trash2, MousePointerClick, Undo2 } from 'lucide-react';
import { Popover } from '@base-ui/react/popover';
import { useDoc, getDoc, commit } from '@/store/doc';
import { useUi } from '@/store/ui';
import { canRepeat, deleteSelection, duplicateSelection, fillSelectedOutlines, flipSelection, pickPhoto, repeatDuplicate } from '@/actions';
import { guideWidth, isClosedGuide } from '@/model/guides';
import { updateRef } from '@/model/ops';
import { resolveFill } from '@/model/doc';
import type { Guide } from '@/model/types';
import { Slider, Tip } from './primitives';
import { useLiveEdit } from './live';
import { finishPen, undoPenPoint, usePen } from '@/advanced/tools';

function Chip({ label, icon, onClick, disabled, tone, tip, keys, active }: { label?: string; icon: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'danger'; tip: string; keys?: string; active?: boolean }) {
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

function Thickness({ guides }: { guides: Guide[] }) {
  const live = useLiveEdit();
  const width = Math.round(guideWidth(guides[0]!));
  const ids = new Set(guides.map((g) => g.id));
  return (
    <Popover.Root>
      <Popover.Trigger className="chip" aria-label="Thickness">
        <SlidersHorizontal />
        Thickness
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={12} style={{ zIndex: 30 }}>
          <Popover.Popup className="pop" style={{ width: 260, padding: '10px 16px' }}>
            <div className="text-[12px] font-semibold text-muted">Thickness</div>
            <Slider
              label="Thickness"
              min={0}
              max={160}
              value={width}
              format={(v) => (v === 0 ? 'Thin' : String(v))}
              onChange={(v) =>
                live.change((doc) => ({
                  ...doc,
                  guides: doc.guides.map((g) => (ids.has(g.id) && (g.type === 'line' || g.type === 'curve' || g.type === 'path') ? { ...g, width: v } : g)),
                }))
              }
              onCommit={live.commit}
            />
            <p className="m-0 pb-1 text-[12px] leading-snug text-muted">A thick line is a band you can color in.</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PhotoBar({ id }: { id: string }) {
  const ref = useDoc((s) => s.doc.refs.find((r) => r.id === id));
  const live = useLiveEdit();
  if (!ref) return null;
  return (
    <div className="glass bar rise scroll-x" role="toolbar" aria-label="Photo">
      <div className="flex items-center gap-2 pl-3 pr-1" style={{ width: 210 }}>
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
  const set = useUi((s) => s.set);
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Color">
      <span className="flex items-center gap-2 pl-3 pr-2 text-[13px] font-medium text-muted">
        <MousePointerClick style={{ width: 16, height: 16 }} />
        {erasing ? 'Tap areas to clear' : 'Tap areas to color'}
      </span>
      <span className="sep" />
      <Tip label="Paper color">
        <button type="button" className="chip" aria-label="Paper color" onClick={() => set({ editing: 'paper', sheet: 'colors' })}>
          <span className={`swatch-sm ${paper ? '' : 'swatch-clear'}`} style={paper ? { background: paper } : undefined} />
          Paper
        </button>
      </Tip>
      <Chip tip="Palettes" icon={<Palette />} onClick={() => set({ editing: null, sheet: 'colors' })} />
    </div>
  );
}

function PenBar() {
  const count = usePen((s) => s.count);
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Pen">
      <span className="flex items-center gap-2 pl-3 pr-2 text-[13px] font-medium text-muted">
        <MousePointerClick style={{ width: 16, height: 16 }} />
        {count === 0 ? 'Tap to place points. Drag while placing to bend.' : `${count} point${count === 1 ? '' : 's'}`}
      </span>
      {count > 0 && (
        <>
          <span className="sep" />
          <Chip tip="Remove the last point" keys="⌫" label="Back" icon={<Undo2 />} onClick={undoPenPoint} />
          <Chip tip="Join the end to the start" label="Close" icon={<CircleDot />} disabled={count < 3} onClick={() => finishPen(true)} />
          <Chip tip="Finish the path" keys="↵" label="Done" icon={<Check />} disabled={count < 2} onClick={() => finishPen(false)} />
        </>
      )}
    </div>
  );
}

function BrushBar() {
  const width = useUi((s) => s.brushWidth);
  return (
    <div className="glass bar rise" role="toolbar" aria-label="Brush">
      <div className="flex items-center gap-2 pl-3 pr-2" style={{ width: 250 }}>
        <span className="text-[12px] font-semibold text-muted">Size</span>
        <Slider label="Brush size" min={2} max={160} value={Math.round(width)} format={(v) => String(v)} onChange={(v) => useUi.setState({ brushWidth: v })} />
      </div>
    </div>
  );
}

export function ContextBar() {
  const tool = useUi((s) => s.tool);
  const selection = useUi((s) => s.selection);
  const ink = useUi((s) => s.ink);
  const multi = useUi((s) => s.multi);
  const doc = useDoc((s) => s.doc);
  // re-render when Repeat becomes available
  useUi((s) => s.lastDup);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  if (tool === 'color') return <ColorBar />;
  if (tool === 'pen') return <PenBar />;
  if (tool === 'brush') return <BrushBar />;
  if (tool !== 'arrange' || selection.length === 0) return null;

  const guides = doc.guides.filter((g) => selection.includes(g.id));
  const shapes = doc.shapes.filter((s) => selection.includes(s.id));
  const refs = doc.refs.filter((r) => selection.includes(r.id));
  if (refs.length === 1 && selection.length === 1) return <PhotoBar id={refs[0]!.id} />;

  const closed = guides.filter(isClosedGuide);
  const thick = guides.filter((g) => g.type === 'line' || g.type === 'curve' || g.type === 'path');
  const group = shapes.length && shapes.every((s) => s.group && s.group === shapes[0]!.group) ? doc.groups[shapes[0]!.group!] : undefined;
  const wholeWord = group && doc.shapes.filter((s) => s.group === group.id).length === shapes.length;

  return (
    <div className="glass bar rise scroll-x" role="toolbar" aria-label="Selection">
      {wholeWord && group?.text?.pristine && (
        <>
          <Chip tip="Edit the text" label="Edit" icon={<Pencil />} onClick={() => useUi.setState({ sheet: 'text', textTarget: group.id })} />
          <span className="sep" />
        </>
      )}
      {closed.length > 0 && shapes.length === 0 && (
        <Tip label="Color this outline in">
          <button type="button" className="chip" onClick={fillSelectedOutlines}>
            <PaintBucket />
            Fill
            <span className="swatch-sm" style={{ background: resolveFill(doc, ink), width: 16, height: 16 }} />
          </button>
        </Tip>
      )}
      {thick.length > 0 && thick.length === guides.length && shapes.length === 0 && <Thickness guides={thick} />}
      {coarse && (
        <Chip
          tip="Keep adding to the selection with each tap"
          label={multi ? 'Selecting' : 'Select more'}
          icon={<SquareDashedMousePointer />}
          active={multi}
          onClick={() => useUi.setState({ multi: !multi })}
        />
      )}
      <Chip tip="Duplicate" keys="⌘D" label="Duplicate" icon={<CopyPlus />} onClick={duplicateSelection} />
      <Chip tip="Repeat: copy again with the same spacing" keys="⌘⇧D" label="Repeat" icon={<Repeat2 />} disabled={!canRepeat()} onClick={repeatDuplicate} />
      <Chip tip="Flip left ↔ right" icon={<FlipHorizontal2 />} onClick={() => flipSelection('h')} />
      <Chip tip="Flip up ↕ down" icon={<FlipVertical2 />} onClick={() => flipSelection('v')} />
      <span className="sep" />
      <Chip tip="Delete" keys="⌫" icon={<Trash2 />} tone="danger" onClick={deleteSelection} />
    </div>
  );
}
