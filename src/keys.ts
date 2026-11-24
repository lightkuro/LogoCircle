/**
 * Keyboard commands: what can be bound to a key, the default keys, and how a
 * key combination is written and shown. What each command does lives in
 * `shortcuts.ts`; this file is data only, so anything may import it.
 *
 * A combo is written like `v`, `mod+z`, `mod+shift+d`, `Delete`, `?`.
 * `mod` is ⌘ on Apple devices and Ctrl elsewhere.
 */
import { useIsTouch, useSettings, settings } from '@/store/settings';

export type CommandGroup = 'Tools' | 'Colors' | 'Edit' | 'View';

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  /** Default combos; the first is the one shown in tooltips. */
  keys: string[];
  /** Only offered in Advanced. */
  advanced?: boolean;
}

export const COMMANDS: Command[] = [
  { id: 'move', label: 'Move things (leave a tool)', group: 'Tools', keys: ['v'] },
  { id: 'text', label: 'Text', group: 'Tools', keys: ['t'] },
  { id: 'circle', label: 'Circle', group: 'Tools', keys: ['o'] },
  { id: 'square', label: 'Square', group: 'Tools', keys: ['r'] },
  { id: 'line', label: 'Line', group: 'Tools', keys: ['l'] },
  { id: 'curve', label: 'Curve', group: 'Tools', keys: ['u'] },
  { id: 'draw', label: 'Draw', group: 'Tools', keys: ['d'] },
  { id: 'brush', label: 'Brush', group: 'Tools', keys: ['b'] },
  { id: 'pen', label: 'Pen', group: 'Tools', keys: ['n'], advanced: true },
  { id: 'cut', label: 'Cut', group: 'Tools', keys: ['x'] },
  { id: 'photo', label: 'Photo', group: 'Tools', keys: ['p'] },

  { id: 'color1', label: 'Color 1', group: 'Colors', keys: ['1'] },
  { id: 'color2', label: 'Color 2', group: 'Colors', keys: ['2'] },
  { id: 'color3', label: 'Color 3', group: 'Colors', keys: ['3'] },
  { id: 'color4', label: 'Color 4', group: 'Colors', keys: ['4'] },
  { id: 'erase', label: 'Erase', group: 'Colors', keys: ['e'] },

  { id: 'undo', label: 'Undo', group: 'Edit', keys: ['mod+z'] },
  { id: 'redo', label: 'Redo', group: 'Edit', keys: ['mod+shift+z', 'mod+y'] },
  { id: 'duplicate', label: 'Duplicate', group: 'Edit', keys: ['mod+d'] },
  { id: 'repeat', label: 'Repeat with the same spacing', group: 'Edit', keys: ['mod+shift+d'] },
  { id: 'copy', label: 'Copy', group: 'Edit', keys: ['mod+c'] },
  { id: 'cutSelection', label: 'Cut to the clipboard', group: 'Edit', keys: ['mod+x'] },
  { id: 'paste', label: 'Paste', group: 'Edit', keys: ['mod+v'] },
  { id: 'selectAll', label: 'Select all', group: 'Edit', keys: ['mod+a'] },
  { id: 'group', label: 'Group', group: 'Edit', keys: ['mod+g'] },
  { id: 'ungroup', label: 'Ungroup', group: 'Edit', keys: ['mod+shift+g'] },
  { id: 'delete', label: 'Delete', group: 'Edit', keys: ['Delete', 'Backspace'] },

  { id: 'outlines', label: 'Show or hide outlines', group: 'View', keys: ['h'] },
  { id: 'fit', label: 'Zoom to fit', group: 'View', keys: ['mod+0'] },
  { id: 'zoomIn', label: 'Zoom in', group: 'View', keys: ['mod+=', 'mod++'] },
  { id: 'zoomOut', label: 'Zoom out', group: 'View', keys: ['mod+-'] },
  { id: 'export', label: 'Export', group: 'View', keys: ['mod+e'] },
  { id: 'help', label: 'How it works', group: 'View', keys: ['?'] },
];

export const GROUPS: CommandGroup[] = ['Tools', 'Colors', 'Edit', 'View'];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Keys that never make a binding on their own, or that belong to the browser or to fixed behaviour. */
const RESERVED = new Set(['Escape', 'Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'ContextMenu', 'Dead', 'Process', 'Unidentified']);

/** The combo a key press makes, or null when it is only a modifier or a reserved key. */
export function comboOf(e: KeyboardEvent): string | null {
  if (RESERVED.has(e.key)) return null;
  const single = e.key.length === 1;
  const key = single ? e.key.toLowerCase() : e.key;
  const plain = single && /[a-z0-9]/.test(key);
  let out = '';
  if (e.metaKey || e.ctrlKey) out += 'mod+';
  // Shift is already part of a symbol such as "?"; it only counts with letters, digits and named keys.
  if (e.shiftKey && (plain || !single)) out += 'shift+';
  if (e.altKey) out += 'alt+';
  return out + key;
}

const NAMES: Record<string, string> = { Delete: 'Del', Backspace: 'Backspace', ' ': 'Space', '=': '+' };

/** How a combo reads to a person: `⇧⌘D` on Apple devices, `Ctrl+Shift+D` elsewhere. */
export function formatCombo(combo: string): string {
  if (!combo) return '';
  const parts = combo.split('+');
  // a trailing "+" key splits into two empty strings
  let key = combo.endsWith('++') || combo === '+' ? '+' : parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, -1).filter(Boolean));
  key = NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (isApple) return `${mods.has('alt') ? '⌥' : ''}${mods.has('shift') ? '⇧' : ''}${mods.has('mod') ? '⌘' : ''}${key}`;
  return `${mods.has('mod') ? 'Ctrl+' : ''}${mods.has('shift') ? 'Shift+' : ''}${mods.has('alt') ? 'Alt+' : ''}${key}`;
}

/** The combos a command answers to right now. */
export function combosFor(id: string, custom: Record<string, string> = settings().keys): string[] {
  const c = BY_ID.get(id);
  if (!c) return [];
  if (id in custom) return custom[id] ? [custom[id]!] : [];
  return c.keys;
}

/** Which command a combo runs, if any. */
export function commandFor(combo: string, custom: Record<string, string> = settings().keys): string | null {
  for (const c of COMMANDS) if (combosFor(c.id, custom).includes(combo)) return c.id;
  return null;
}

export function isCustom(id: string, custom: Record<string, string> = settings().keys): boolean {
  return id in custom;
}

/** Bind a command to a combo, taking the combo away from whatever had it. Returns the new table. */
export function bind(custom: Record<string, string>, id: string, combo: string): Record<string, string> {
  const next = { ...custom };
  if (combo) {
    for (const c of COMMANDS) {
      if (c.id !== id && combosFor(c.id, custom).includes(combo)) {
        // keep the other command's remaining default keys, if it has any
        const rest = combosFor(c.id, custom).filter((k) => k !== combo);
        next[c.id] = rest[0] ?? '';
      }
    }
  }
  const def = BY_ID.get(id)?.keys ?? [];
  if (def.length === 1 && def[0] === combo) delete next[id];
  else next[id] = combo;
  return next;
}

export function unbind(custom: Record<string, string>, id: string): Record<string, string> {
  const next = { ...custom };
  delete next[id];
  return next;
}

/** The key to show beside a command, e.g. in a tooltip. Nothing on touch devices, which have no keyboard to speak of. */
export function useKey(id: string): string | undefined {
  const custom = useSettings((s) => s.keys);
  const touch = useIsTouch();
  if (touch) return undefined;
  const first = combosFor(id, custom)[0];
  return first ? formatCombo(first) : undefined;
}

/** All shown keys at once, for components that list several commands. */
export function useKeys(): (id: string) => string | undefined {
  const custom = useSettings((s) => s.keys);
  const touch = useIsTouch();
  return (id) => {
    if (touch) return undefined;
    const first = combosFor(id, custom)[0];
    return first ? formatCombo(first) : undefined;
  };
}

export const keyLabel = (id: string): string | undefined => {
  const first = combosFor(id)[0];
  return first ? formatCombo(first) : undefined;
};
