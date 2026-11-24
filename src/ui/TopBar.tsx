import { Eye, EyeOff, Layers, Redo2, Share, Undo2 } from 'lucide-react';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { setMode } from '@/actions';
import { IconButton, Segmented, useIsPhone } from './primitives';
import { LogoMark } from './icons';

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = mac ? '⌘' : 'Ctrl+';

export function TopBar() {
  const phone = useIsPhone();
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const name = useDoc((s) => s.doc.name);
  const showGuides = useUi((s) => s.showGuides);
  const mode = useUi((s) => s.mode);
  const set = useUi((s) => s.set);

  return (
    <div className="chrome-top">
      <div className="glass bar">
        <IconButton label="Menu" onClick={() => set({ sheet: 'menu' })}>
          <LogoMark style={{ width: 24, height: 24 }} />
        </IconButton>
        {!phone && (
          <input
            className="h-10 w-44 rounded-xl bg-transparent px-2 text-[14px] font-semibold outline-none focus:bg-sunken"
            value={name}
            aria-label="Logo name"
            spellCheck={false}
            onChange={(e) => {
              const st = useDoc.getState();
              st.patch({ ...st.doc, name: e.target.value, updatedAt: Date.now() });
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        )}
      </div>

      {!phone && (
        <div className="glass bar">
          <Segmented
            label="Mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'classic', label: 'Classic' },
              { value: 'advanced', label: 'Advanced' },
            ]}
          />
        </div>
      )}

      <div className="glass bar">
        <IconButton label="Undo" keys={`${MOD}Z`} disabled={!canUndo} onClick={() => useDoc.getState().undo()}>
          <Undo2 />
        </IconButton>
        <IconButton label="Redo" keys={mac ? '⇧⌘Z' : 'Ctrl+Y'} disabled={!canRedo} onClick={() => useDoc.getState().redo()}>
          <Redo2 />
        </IconButton>
        <span className="sep" />
        <IconButton
          label={showGuides ? 'Hide outlines' : 'Show outlines'}
          keys="H"
          active={!showGuides}
          onClick={() => set({ showGuides: !showGuides, selection: [] })}
        >
          {showGuides ? <Eye /> : <EyeOff />}
        </IconButton>
        {phone && mode === 'advanced' && (
          <IconButton label="Design and layers" onClick={() => set({ panelOpen: true })}>
            <Layers />
          </IconButton>
        )}
        <button type="button" className="btn ml-1" data-variant="primary" onClick={() => set({ sheet: 'export' })}>
          <Share />
          {!phone && 'Export'}
        </button>
      </div>
    </div>
  );
}
