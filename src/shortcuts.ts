import { useEffect } from 'react';
import { useDoc } from '@/store/doc';
import { ui, useUi } from '@/store/ui';
import {
  addOutline,
  copySelection,
  deleteSelection,
  doneTool,
  groupSelection,
  ungroupSelection,
  duplicateSelection,
  fitToScreen,
  nudge,
  pasteClipboard,
  pickEraser,
  pickInk,
  repeatDuplicate,
  selectAll,
  setTool,
  zoomBy,
} from '@/actions';
import { isTyping } from '@/canvas/useGestures';
import { openPhoto } from '@/ui/Dock';

/** Keyboard shortcuts. None of these animate anything: keys should feel instant. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return;
      const s = ui();
      if (s.sheet) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (mod) {
        switch (key) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) useDoc.getState().redo();
            else useDoc.getState().undo();
            return;
          case 'y':
            e.preventDefault();
            useDoc.getState().redo();
            return;
          case 'd':
            e.preventDefault();
            if (e.shiftKey) repeatDuplicate();
            else duplicateSelection();
            return;
          case 'a':
            e.preventDefault();
            selectAll();
            return;
          case 'g':
            e.preventDefault();
            if (e.shiftKey) ungroupSelection();
            else groupSelection();
            return;
          case 'c':
            if (copySelection()) e.preventDefault();
            return;
          case 'x':
            if (copySelection()) {
              e.preventDefault();
              deleteSelection();
            }
            return;
          case 'v':
            // An image on the system clipboard is handled by the paste listener instead.
            pasteClipboard();
            return;
          case 'e':
            e.preventDefault();
            useUi.setState({ sheet: 'export' });
            return;
          case '0':
            e.preventDefault();
            fitToScreen();
            return;
          case '=':
          case '+':
            e.preventDefault();
            zoomBy(1.25);
            return;
          case '-':
            e.preventDefault();
            zoomBy(0.8);
            return;
          default:
            return;
        }
      }

      const step = (e.shiftKey ? 10 : 1) / Math.max(1, s.view.k);
      switch (key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelection();
          return;
        case 'Escape':
          if (s.menu) useUi.setState({ menu: null });
          else if (s.colorPanel !== null) useUi.setState({ colorPanel: null });
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
        case 'v':
          useUi.setState({ selectMode: 'move' });
          doneTool();
          return;
        case 'o':
          addOutline('circle');
          return;
        case 'l':
          addOutline('line');
          return;
        case 'r':
          addOutline('rect');
          return;
        case 'u':
          addOutline('curve');
          return;
        case 't':
          e.preventDefault();
          useUi.setState({ sheet: 'text', textTarget: null });
          return;
        case 'p':
          openPhoto();
          return;
        case 'd':
          setTool('draw');
          return;
        case 'b':
          setTool('brush');
          return;
        case 'x':
          setTool('cut');
          return;
        case 'e':
          pickEraser();
          return;
        case 'h':
          useUi.setState({ showGuides: !s.showGuides, selection: [] });
          return;
        case '1':
        case '2':
        case '3':
        case '4': {
          const i = Number(key) - 1;
          if (i < useDoc.getState().doc.palette.length) pickInk(i);
          return;
        }
        case 'n':
          if (s.mode === 'advanced') setTool('pen');
          return;
        case '?':
          useUi.setState({ sheet: 'help' });
          return;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
