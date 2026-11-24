import { useUi } from '@/store/ui';
import { useIsTouch, useSettings } from '@/store/settings';
import { COMMANDS, GROUPS, combosFor, formatCombo } from '@/keys';
import { Sheet } from '../primitives';
import { HowItWorksAnimation } from '../HowItWorks';

type Rows = [string, string][];

const steps = (tap: string, hold: string): Rows => [
  ['Outlines', 'Add circles, shapes, lines, curves. They are guides only: move, resize, overlap freely. Trace over photo if wanted.'],
  ['Color', `${tap} color, then ${tap.toLowerCase()} or drag across areas. Same-color neighbours join into one shape. Or select outline and ${tap.toLowerCase()} color to fill it.`],
  ['Trim', `Cut: ${tap.toLowerCase()} segment to remove, drag to slice shape. Erase clears areas. Cut lines shows removed segments to restore. Fills follow their outlines. Words work the same.`],
  ['Export', 'Hide outlines to see result. Adjust frame size if needed. Export SVG or PNG. Everything stays on this device.'],
  ['More', `${hold} anything for options: round one corner, edit word, reorder, group.`],
];

const TOUCH: Rows = [
  ['Move item', 'Drag'],
  ['Move view', 'Drag empty space or use two fingers'],
  ['Zoom', 'Pinch'],
  ['Menu for anything', 'Press and hold, then release'],
  ['Box select', 'Press and hold, then drag'],
  ['Select several', 'Select › One at a time, tap each'],
  ['Mirror copy', 'Select, then More › Mirror copy, tap line'],
  ['Edit word', 'Double-tap'],
  ['Round one corner', 'Press and hold corner'],
  ['Color selection', 'Tap color'],
];

const mouse = (leftPans: boolean): Rows => [
  ['Move item', 'Drag'],
  ['Move view', leftPans ? 'Drag empty space' : 'Right-drag'],
  ['Box select', leftPans ? 'Right-drag or Shift-drag' : 'Drag empty space'],
  ['Move view from anywhere', 'Space-drag or middle-drag'],
  ['Zoom', 'Scroll wheel'],
  ['Menu for anything', 'Right-click'],
  ['Select', 'Click. Click again for item underneath.'],
  ['Select several', 'Shift-click'],
  ['Mirror copy', 'Select, press M, click line'],
  ['Edit word', 'Double-click'],
  ['Round one corner', 'Right-click corner'],
  ['Color selection', 'Click color'],
  ['Remove point', 'Double-click point'],
  ['Expand bar', 'Click or drag tab at end of bar'],
  ['Pin tool to bar', 'Right-click tool'],
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
  rows.push(['Nudge selection', 'Arrow keys (Shift: bigger steps)'], ['Leave tool or selection', 'Esc'], ['Move view', 'Hold Space and drag']);
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
            <p className="mb-0 mt-2 text-[12.5px] leading-snug text-muted">Change keys and mouse buttons in Settings (LogoCircle menu).</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
