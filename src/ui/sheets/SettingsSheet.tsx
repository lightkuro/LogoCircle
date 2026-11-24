import { useEffect, useState, type ReactNode } from 'react';
import { Hand, RotateCcw, SquareDashed, X } from 'lucide-react';
import { useUi } from '@/store/ui';
import { settings, useIsTouch, useSettings, type DragEmpty, type Layout, type Theme } from '@/store/settings';
import { COMMANDS, GROUPS, bind, combosFor, comboOf, commandFor, formatCombo, isCustom, unbind, type Command } from '@/keys';
import { InfoTip, Segmented, Sheet } from '../primitives';
import '@/styles/settings.css';

const LAYOUT_NOTE = 'Auto picks the phone or desktop layout by screen size.';
const THEME_NOTE = 'Auto follows this device.';

/** A setting's name with its (i). */
function Title({ children, info }: { children: string; info: string }) {
  return (
    <span className="set-title">
      {children} <InfoTip about={children} text={info} />
    </span>
  );
}

function Switch({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="set-row">
      <Title info={hint}>{label}</Title>
      <button type="button" role="switch" className="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)}>
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

function Choice({ checked, onSelect, icon, children }: { checked: boolean; onSelect: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" role="radio" className="choice" aria-checked={checked} onClick={onSelect}>
      <span className="choice-dot" />
      <span className="min-w-0 flex-1">{children}</span>
      {icon}
    </button>
  );
}

const labelOf = (id: string): string => COMMANDS.find((c) => c.id === id)?.label ?? id;

/** Back to the default keys, taking them back from any command that had been given one of them. */
function restore(custom: Record<string, string>, id: string): Record<string, string> {
  const next = unbind(custom, id);
  for (const combo of combosFor(id, next)) {
    for (const c of COMMANDS) {
      if (c.id === id) continue;
      const theirs = combosFor(c.id, next);
      if (theirs.includes(combo)) next[c.id] = theirs.find((k) => k !== combo) ?? '';
    }
  }
  return next;
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

function Shortcuts() {
  const custom = useSettings((s) => s.keys);
  const advanced = useUi((s) => s.mode === 'advanced');
  const [capturing, setCapturing] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    if (!capturing) return;
    // Capture phase, on the window: the key must reach nothing else — above all not the sheet, which Esc would close.
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') return setCapturing(null);
      if (MODIFIERS.has(e.key)) return; // still holding Ctrl or Shift: wait for the key itself
      const combo = comboOf(e);
      if (!combo) return setNote({ id: capturing, text: 'That key is kept for something else. Try another.' });
      const before = settings().keys;
      const other = commandFor(combo, before);
      settings().set({ keys: bind(before, capturing, combo) });
      setNote(other && other !== capturing ? { id: capturing, text: `Taken from ${labelOf(other)}` } : null);
      setCapturing(null);
    };
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-capturing]')) setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [capturing]);

  const row = (c: Command): ReactNode => {
    const combos = combosFor(c.id, custom);
    const shown = combos.map(formatCombo).join(' or ');
    const active = capturing === c.id;
    const changed = isCustom(c.id, custom);
    return (
      <div key={c.id} className="key-row">
        <span className="min-w-0">{c.label}</span>
        <button
          type="button"
          className="key-btn"
          data-capturing={active || undefined}
          data-empty={!shown || undefined}
          aria-label={`Shortcut for ${c.label}: ${active ? 'press a key' : shown || 'none'}`}
          onClick={() => {
            setNote(null);
            setCapturing(active ? null : c.id);
          }}
        >
          {active ? 'Press a key' : shown || 'None'}
        </button>
        <button
          type="button"
          className="key-icon"
          aria-label={`Remove the shortcut for ${c.label}`}
          disabled={!shown}
          onClick={() => {
            setNote(null);
            settings().set({ keys: bind(custom, c.id, '') });
          }}
        >
          <X />
        </button>
        <button
          type="button"
          className="key-icon"
          aria-label={`Restore the default shortcut for ${c.label}`}
          style={changed ? undefined : { visibility: 'hidden' }}
          onClick={() => {
            setNote(null);
            settings().set({ keys: restore(custom, c.id) });
          }}
        >
          <RotateCcw />
        </button>
        {note?.id === c.id && (
          <span className="key-note" role="status">
            {note.text}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="label set-label">
        Keyboard shortcuts
        <InfoTip
          about="keyboard shortcuts"
          text="Pick a key, then press the new one. Esc leaves it as it was. Arrow keys nudge the selection, Esc steps back and Space moves the view; those stay as they are."
        />
      </div>
      {GROUPS.map((group) => {
        const list = COMMANDS.filter((c) => c.group === group && (advanced || !c.advanced));
        if (!list.length) return null;
        return (
          <div key={group} role="group" aria-label={`${group} shortcuts`}>
            <div className="key-group">{group}</div>
            {list.map(row)}
          </div>
        );
      })}
      <button
        type="button"
        className="btn mt-2"
        disabled={Object.keys(custom).length === 0}
        onClick={() => {
          setNote(null);
          setCapturing(null);
          settings().set({ keys: {} });
        }}
      >
        <RotateCcw />
        Reset all shortcuts
      </button>
    </>
  );
}

export function SettingsSheet() {
  const open = useUi((s) => s.sheet === 'settings');
  const snap = useUi((s) => s.snap);
  const layout = useSettings((s) => s.layout);
  const theme = useSettings((s) => s.theme);
  const dragEmpty = useSettings((s) => s.dragEmpty);
  const haptics = useSettings((s) => s.haptics);
  const toolLabels = useSettings((s) => s.toolLabels);
  const slidePick = useSettings((s) => s.slidePick);
  const touch = useIsTouch();
  const set = settings().set;
  const drag = (v: DragEmpty) => (): void => set({ dragEmpty: v });

  return (
    <Sheet open={open} onClose={() => useUi.setState({ sheet: null })} title="Settings" place="top-left">
      <div className="label" style={{ marginTop: 2 }}>
        Interface
      </div>
      <div className="set-row">
        <Title info={LAYOUT_NOTE}>Layout</Title>
        <Segmented<Layout>
          label="Layout"
          value={layout}
          onChange={(v) => set({ layout: v })}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'desktop', label: 'Desktop' },
            { value: 'mobile', label: 'Mobile' },
          ]}
        />
      </div>
      <div className="set-row">
        <Title info={THEME_NOTE}>Appearance</Title>
        <Segmented<Theme>
          label="Appearance"
          value={theme}
          onChange={(v) => set({ theme: v })}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>

      {!touch && (
        <>
          <div className="label set-label">
            Mouse
            <InfoTip about="the mouse" text="What dragging on empty canvas does. Either way, Shift and drag selects a box, and Space or the middle button moves the view." />
          </div>
          <div role="radiogroup" aria-label="Dragging on empty canvas" className="grid gap-1.5">
            <Choice checked={dragEmpty === 'pan'} onSelect={drag('pan')} icon={<Hand />}>
              Left drag moves the view, right drag selects a box
            </Choice>
            <Choice checked={dragEmpty === 'select'} onSelect={drag('select')} icon={<SquareDashed />}>
              Left drag selects a box, right drag moves the view
            </Choice>
          </div>
        </>
      )}

      <Switch label="Tool names" hint="Words under the icons in the bar of tools. Off leaves just the icons." checked={toolLabels} onChange={(v) => set({ toolLabels: v })} />
      <Switch
        label="Hold and drag to pick"
        hint={`${touch ? 'Press' : 'Press down on'} a tool button that has a list, slide onto a choice and let go to pick it, in one move.`}
        checked={slidePick}
        onChange={(v) => set({ slidePick: v })}
      />

      <div className="label">Helpers</div>
      <Switch label="Snapping" hint="Things line up with nearby outlines, edges and centres as you drag them." checked={snap} onChange={(v) => useUi.setState({ snap: v })} />
      {touch && <Switch label="Vibration" hint="A short tick when a color lands or a hold menu opens, where the device has one." checked={haptics} onChange={(v) => set({ haptics: v })} />}

      {!touch && <Shortcuts />}

      <div className="set-foot">
        <button
          type="button"
          className="btn"
          onClick={() => {
            settings().reset();
            useUi.setState({ snap: true });
          }}
        >
          <RotateCcw />
          Reset all settings
        </button>
      </div>
    </Sheet>
  );
}
