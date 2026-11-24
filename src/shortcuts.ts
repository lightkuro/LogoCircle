import { useEffect } from 'react';
import { useDoc } from '@/store/doc';
import { ui, useUi } from '@/store/ui';
import {
  addOutline,
  copySelection,
  deleteSelection,
  doneTool,
  finishFillet,
  finishPattern,
  groupSelection,
  ungroupSelection,
  duplicateSelection,
  fitToScreen,
  nudge,
  openPhoto,
  pasteClipboard,
  pickEraser,
  pickInk,
  repeatDuplicate,
  selectAll,
  setTool,
  startMirror,
  zoomBy,
} from '@/actions';
import { isTyping } from '@/canvas/useGestures';
import { comboOf, commandFor } from '@/keys';

/**
 * What each command in the key table (`keys.ts`) does. A handler returns
 * `false` when it did nothing, so the key keeps its normal meaning.
 */
type Handler = (e: KeyboardEvent) => boolean | void;

const color =
  (i: number): Handler =>
  () => {
    if (i >= useDoc.getState().doc.palette.length) return false;
    pickInk(i);
  };

const HANDLERS: Record<string, Handler> = {
  move: () => {
    useUi.setState({ selectMode: 'move' });
    doneTool();
  },
  text: () => useUi.setState({ sheet: 'text', textTarget: null }),
  circle: () => addOutline('circle'),
  square: () => addOutline('rect'),
  line: () => addOutline('line'),
  curve: () => addOutline('curve'),
  draw: () => setTool('draw'),
  brush: () => setTool('brush'),
  pen: () => {
    if (ui().mode !== 'advanced') return false;
    setTool('pen');
  },
  cut: () => setTool('cut'),
  mirror: startMirror,
  photo: () => openPhoto(),

  color1: color(0),
  color2: color(1),
  color3: color(2),
  color4: color(3),
  erase: () => pickEraser(),

  undo: () => useDoc.getState().undo(),
  redo: () => useDoc.getState().redo(),
  duplicate: () => duplicateSelection(),
  repeat: () => repeatDuplicate(),
  // With nothing of ours selected, the system copy goes ahead.
  copy: () => copySelection(),
  cutSelection: () => {
    if (!copySelection()) return false;
    deleteSelection();
  },
  paste: () => pasteClipboard(),
  selectAll: () => selectAll(),
  group: () => groupSelection(),
  ungroup: () => ungroupSelection(),
  delete: () => deleteSelection(),

  outlines: () => useUi.setState({ showGuides: !ui().showGuides, selection: [] }),
  fit: () => fitToScreen(),
  zoomIn: () => zoomBy(1.25),
  zoomOut: () => zoomBy(0.8),
  export: () => useUi.setState({ sheet: 'export' }),
  help: () => useUi.setState({ sheet: 'help' }),
};

/**
 * Commands that must leave the browser's own handling alone: an image on the
 * system clipboard arrives through the `paste` event, which preventDefault
 * would suppress.
 */
const PASS_THROUGH = new Set(['paste']);
/** Commands that always swallow their key, modifier or not. */
const ALWAYS_SWALLOW = new Set(['text', 'delete']);

/** Keyboard shortcuts. None of these animate anything: keys should feel instant. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return;
      const s = ui();
      if (s.sheet) return;
      const mod = e.metaKey || e.ctrlKey;

      // Fixed keys: these are not in the table and cannot be rebound.
      if (!mod) {
        const step = (e.shiftKey ? 10 : 1) / Math.max(1, s.view.k);
        switch (e.key) {
          case 'Escape':
            if (s.menu) useUi.setState({ menu: null });
            else if (s.colorPanel !== null) useUi.setState({ colorPanel: null });
            else if (s.pattern) finishPattern(false);
            else if (s.fillet) finishFillet(false);
            else if (s.frameEdit) useUi.setState({ frameEdit: false });
            else if (s.tool !== 'arrange') doneTool();
            else if (s.selection.length) useUi.setState({ selection: [] });
            else if (s.selectMode !== 'move') useUi.setState({ selectMode: 'move' });
            return;
          case 'ArrowLeft':
            e.preventDefault();
            nudge(-step, 0);
            return;
          case 'ArrowRight':
            e.preventDefault();
            nudge(step, 0);
            return;
          case 'ArrowUp':
            e.preventDefault();
            nudge(0, -step);
            return;
          case 'ArrowDown':
            e.preventDefault();
            nudge(0, step);
            return;
          default:
        }
      }

      const combo = comboOf(e);
      if (!combo) return;
      const id = commandFor(combo);
      const run = id ? HANDLERS[id] : undefined;
      if (!id || !run) return;
      const handled = run(e) !== false;
      if (!handled || PASS_THROUGH.has(id)) return;
      // A combination with Ctrl or ⌘ would otherwise also reach the browser (save page, bookmark, zoom…).
      if (mod || ALWAYS_SWALLOW.has(id)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
