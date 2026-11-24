import { useUi } from '@/store/ui';
import { Sheet } from '../primitives';
import { MOD } from '../TopBar';

const MOUSE: [string, string][] = [
  ['Move something', 'Drag it'],
  ['Pan the canvas', 'Drag empty space'],
  ['Zoom', 'Scroll wheel'],
  ['Menu for anything', 'Right-click'],
  ['Select', 'Click · click again for what is underneath'],
  ['Select several', 'Shift + click · Shift + drag a box'],
  ['Edit a word', 'Double-click it'],
  ['Color the selection', 'Click a color'],
  ['Remove a point', 'Double-click the point'],
  ['Pan from anywhere', 'Space or middle button + drag'],
];

const TOUCH: [string, string][] = [
  ['Move something', 'Drag it'],
  ['Pan and zoom', 'Two fingers (or drag empty space)'],
  ['Menu for anything', 'Press and hold, then let go'],
  ['Select a box of things', 'Press and hold, then drag'],
  ['Edit a word', 'Double-tap it'],
];

const KEYS: [string, string][] = [
  ['Colors', '1 · 2 · 3 · 4'],
  ['Eraser', 'E'],
  ['Text · Photo', 'T · P'],
  ['Circle · Square · Line · Curve', 'O · R · L · U'],
  ['Draw · Brush · Cut', 'D · B · X'],
  ['Back to moving things', 'V or Esc'],
  ['Show or hide outlines', 'H'],
  ['Copy · Paste', `${MOD}C · ${MOD}V`],
  ['Duplicate · Repeat', `${MOD}D · ${MOD}⇧D`],
  ['Group · Ungroup', `${MOD}G · ${MOD}⇧G`],
  ['Undo · Redo', `${MOD}Z · ${MOD}⇧Z`],
  ['Nudge (×10 with Shift)', '← ↑ → ↓'],
  ['Delete', 'Del'],
  ['Zoom to fit', `${MOD}0`],
  ['Export', `${MOD}E`],
];

const STEPS: [string, string][] = [
  ['Outlines', 'Add circles, shapes, lines and curves. They are only guides: move, resize and overlap them freely. Trace over a photo if you like.'],
  ['Color', 'Tap a color, then tap or drag across the areas the outlines make. Neighbouring areas of the same color join into one shape. Or select an outline and tap a color to color it directly.'],
  ['Refine', 'Erase areas you do not want, or Cut straight through shapes to split them. A fill follows its outlines when you move them. Words work the same way.'],
  ['Export', 'Hide the outlines to see the result, adjust the export frame if you need to, then export a clean SVG or PNG.'],
];

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl" style={{ background: 'var(--border)' }}>
      {rows.map(([what, key]) => (
        <div key={what} className="flex items-center justify-between gap-3 bg-surface px-3 py-2 text-[13.5px]">
          <span>{what}</span>
          <span className="text-right font-semibold text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {key}
          </span>
        </div>
      ))}
    </div>
  );
}

export function HelpSheet() {
  const open = useUi((s) => s.sheet === 'help');
  return (
    <Sheet open={open} onClose={() => useUi.setState({ sheet: null })} title="How it works" place="top-left">
      <ol className="m-0 list-none p-0">
        {STEPS.map(([t, d], i) => (
          <li key={t} className="flex gap-3 py-2">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              {i + 1}
            </span>
            <span>
              <span className="block text-[15px] font-semibold">{t}</span>
              <span className="block text-[13.5px] leading-snug text-muted">{d}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="label">Mouse</div>
      <Table rows={MOUSE} />
      <div className="label">Touch</div>
      <Table rows={TOUCH} />
      <div className="label">Keyboard</div>
      <Table rows={KEYS} />
    </Sheet>
  );
}
