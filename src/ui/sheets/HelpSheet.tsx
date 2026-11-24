import { useUi } from '@/store/ui';
import { useIsTouch, useSettings } from '@/store/settings';
import { COMMANDS, GROUPS, combosFor, formatCombo } from '@/keys';
import { Sheet } from '../primitives';
import { HowItWorksAnimation } from '../HowItWorks';

type Rows = [string, string][];

const steps = (tap: string, hold: string): Rows => [
  ['Outlines', 'Add circles, shapes, lines and curves. They are only guides: move, resize and overlap them freely. Trace over a photo if you like.'],
  [
    'Color',
    `${tap} a color, then ${tap.toLowerCase()} or drag across the areas the outlines make. Neighbouring areas of the same color join into one shape. Or select an outline and ${tap.toLowerCase()} a color to color it directly.`,
  ],
  [
    'Refine',
    `Under Cut: Cut removes the piece of an outline you ${tap.toLowerCase()}, between two crossings, or slices shapes along a line you drag; Erase clears areas. Show cut lines brings removed pieces back. A fill follows its outlines when you move them. Words work the same way.`,
  ],
  ['Export', 'Hide the outlines to see the result, adjust the frame size if you need to, then export a clean SVG or PNG. Everything stays on this device; nothing is uploaded.'],
  ['More', `${hold} anything for what can be done with it: round one corner, edit a word, change the order, group, and more.`],
];

const TOUCH: Rows = [
  ['Move something', 'Drag it'],
  ['Move the view', 'Drag empty space, or use two fingers'],
  ['Zoom', 'Pinch with two fingers'],
  ['Menu for anything', 'Press and hold, then let go'],
  ['Select a box of things', 'Press and hold, then drag'],
  ['Select several one by one', 'Select, then One at a time, and tap each'],
  ['Mirror a copy', 'Select it, then More, Mirror copy, and tap a line'],
  ['Edit a word', 'Double-tap it'],
  ['Round one corner', 'Press and hold the corner'],
  ['Color the selection', 'Tap a color'],
];

const mouse = (leftPans: boolean): Rows => [
  ['Move something', 'Drag it'],
  ['Move the view', leftPans ? 'Drag empty space' : 'Drag with the right button'],
  ['Select a box of things', leftPans ? 'Drag with the right button, or Shift and drag' : 'Drag empty space'],
  ['Move the view from anywhere', 'Hold Space, or use the middle button, and drag'],
  ['Zoom', 'Scroll wheel'],
  ['Menu for anything', 'Right-click'],
  ['Select', 'Click. Click again for what is underneath.'],
  ['Select several one by one', 'Shift and click'],
  ['Mirror a copy', 'Select it, press M, and click a line'],
  ['Edit a word', 'Double-click it'],
  ['Round one corner', 'Right-click the corner'],
  ['Color the selection', 'Click a color'],
  ['Remove a point', 'Double-click the point'],
];

function Table({ rows }: { rows: Rows }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl" style={{ background: 'var(--border)' }}>
      {rows.map(([what, how]) => (
        <div key={what} className="flex items-center justify-between gap-3 bg-surface px-3 py-2 text-[13.5px]">
          <span>{what}</span>
          <span className="text-right font-semibold text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {how}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The keyboard table is read from the same bindings Settings edits, so the two never disagree. */
function useKeyRows(): Rows {
  const custom = useSettings((s) => s.keys);
  const advanced = useUi((s) => s.mode === 'advanced');
  const rows: Rows = [];
  for (const group of GROUPS) {
    for (const c of COMMANDS) {
      if (c.group !== group || (c.advanced && !advanced)) continue;
      const combos = combosFor(c.id, custom);
      if (combos.length) rows.push([c.label, combos.map(formatCombo).join(' or ')]);
    }
  }
  rows.push(['Nudge the selection', 'Arrow keys (Shift for bigger steps)'], ['Step back out of a tool or a selection', 'Esc'], ['Move the view', 'Hold Space and drag']);
  return rows;
}

export function HelpSheet() {
  const open = useUi((s) => s.sheet === 'help');
  const touch = useIsTouch();
  const leftPans = useSettings((s) => s.dragEmpty === 'pan');
  const keys = useKeyRows();
  const list = steps(touch ? 'Tap' : 'Click', touch ? 'Press and hold' : 'Right-click');
  return (
    <Sheet open={open} onClose={() => useUi.setState({ sheet: null })} title="Guide" place="top-left">
      <div className="guide-sheet">
        <HowItWorksAnimation />
        <ol className="guide-steps m-0 list-none p-0">
          {list.map(([t, d], i) => (
            <li key={t} className="flex gap-3 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                {i + 1}
              </span>
              <span>
                <span className="block text-[15px] font-semibold">{t}</span>
                <span className="block text-[13.5px] leading-snug text-muted">{d}</span>
              </span>
            </li>
          ))}
        </ol>
        {touch ? (
          <>
            <div className="label">Touch</div>
            <Table rows={TOUCH} />
          </>
        ) : (
          <>
            <div className="guide-tables">
              <div>
                <div className="label">Mouse</div>
                <Table rows={mouse(leftPans)} />
              </div>
              <div>
                <div className="label">Keyboard</div>
                <Table rows={keys} />
              </div>
            </div>
            <p className="mb-0 mt-2 text-[12.5px] leading-snug text-muted">Keys and the mouse buttons can be changed in Settings, in the LogoCircle menu.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
