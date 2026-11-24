import { useUi } from '@/store/ui';
import { Sheet } from '../primitives';
import { MOD } from '../TopBar';

const KEYS: [string, string][] = [
  ['Move tool', 'V'],
  ['Circle · Line · Square · Curve', 'O · L · R · U'],
  ['Text · Photo', 'T · P'],
  ['Color 1 · 2 · 3', '1 · 2 · 3'],
  ['Eraser', 'E'],
  ['Show or hide outlines', 'H'],
  ['Copy · Paste', `${MOD}C · ${MOD}V`],
  ['Duplicate', `${MOD}D`],
  ['Repeat', `${MOD}⇧D`],
  ['Undo · Redo', `${MOD}Z · ${MOD}⇧Z`],
  ['Nudge (×10 with Shift)', '← ↑ → ↓'],
  ['Pan', 'Space + drag'],
  ['Zoom', `${MOD}scroll · pinch`],
  ['Fit to screen', `${MOD}0`],
  ['Export', `${MOD}E`],
];

const STEPS: [string, string][] = [
  ['Outlines', 'Add circles, lines and curves. They are only guides: move, resize and overlap them freely. Trace over a photo if you like.'],
  ['Color', 'Tap a color, then tap or drag across the areas the outlines make. Neighbouring areas of the same color join into one shape.'],
  ['Refine', 'Erase areas you do not want. Words work the same way: put an outline over a letter and erase or recolor what it cuts.'],
  ['Export', 'Hide the outlines to see the result, then export a clean SVG or PNG.'],
];

export function HelpSheet() {
  const open = useUi((s) => s.sheet === 'help');
  return (
    <Sheet open={open} onClose={() => useUi.setState({ sheet: null })} title="How it works">
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
      <p className="mb-0 mt-1 text-[13px] leading-snug text-muted">
        On a phone: one finger moves things or colors, two fingers pan and zoom. Tap the same spot again to reach what is underneath.
      </p>
      <div className="label">Keyboard</div>
      <div className="grid gap-px overflow-hidden rounded-xl" style={{ background: 'var(--border)' }}>
        {KEYS.map(([what, key]) => (
          <div key={what} className="flex items-center justify-between gap-3 bg-surface px-3 py-2 text-[13.5px]">
            <span>{what}</span>
            <span className="whitespace-nowrap font-semibold text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {key}
            </span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
