import type { ReactNode } from 'react';
import { CircleHelp, Ellipsis, Eye, EyeOff, Layers, Redo2, RotateCcw, Save, Share, Undo2 } from 'lucide-react';
import { Popover } from '@base-ui/react/popover';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { useIsPhone } from '@/store/settings';
import { useKeys } from '@/keys';
import { resetToStarter, saveToDevice, setMode } from '@/actions';
import { IconButton, Segmented } from './primitives';
import { LogoMark } from './icons';

/** A one-glance explanation, with the way to more. */
function HelpButton() {
  return (
    <Popover.Root>
      <Popover.Trigger className="ib" aria-label="Help">
        <CircleHelp />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={12} collisionPadding={8} style={{ zIndex: 30 }}>
          <Popover.Popup className="pop" style={{ width: 220, padding: '14px 16px 12px' }}>
            <div className="text-[15px] font-semibold tracking-[-0.01em]">Simply:</div>
            <ol className="m-0 mt-1.5 list-decimal space-y-0.5 pl-5 text-[14px] leading-snug">
              <li>Add shapes</li>
              <li>Trim</li>
              <li>Color areas</li>
            </ol>
            <div className="mt-3 flex flex-wrap gap-1">
              <Popover.Close className="chip" style={{ background: 'var(--sunken)' }} onClick={() => useUi.setState({ sheet: 'help' })}>
                Guide
              </Popover.Close>
              <Popover.Close className="chip" style={{ background: 'var(--sunken)' }} onClick={() => useUi.setState({ sheet: 'gallery', galleryTab: 'examples' })}>
                Examples
              </Popover.Close>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Item({ icon, label, keys, onClick, disabled, tone }: { icon: ReactNode; label: string; keys?: string; onClick: () => void; disabled?: boolean; tone?: 'danger' }) {
  return (
    <Popover.Close className="menu-item" data-tone={tone} disabled={disabled} onClick={onClick}>
      {icon}
      {label}
      {keys && <kbd>{keys}</kbd>}
    </Popover.Close>
  );
}

/** The three dots: what is not needed at every moment. On phones that includes Redo and Export. */
function MoreButton({ phone, canRedo }: { phone: boolean; canRedo: boolean }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="ib" aria-label="More options">
        <Ellipsis />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={12} collisionPadding={8} style={{ zIndex: 30 }}>
          <Popover.Popup className="pop bar-menu" style={{ width: 252 }}>
            {phone && <Item icon={<Redo2 />} label="Redo" disabled={!canRedo} onClick={() => useDoc.getState().redo()} />}
            <Item icon={<Save />} label="Save" onClick={() => void saveToDevice()} />
            {phone && <Item icon={<Share />} label="Export" onClick={() => useUi.setState({ sheet: 'export' })} />}
            <div className="menu-sep" />
            <Item icon={<RotateCcw />} label="Reset to default" onClick={() => void resetToStarter()} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TopBar() {
  const phone = useIsPhone();
  const key = useKeys();
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
        <HelpButton />
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
              { value: 'classic', label: 'Classic', tip: 'Up to four colors and the essentials' },
              { value: 'advanced', label: 'Advanced', tip: 'Layers, more colors, a pen, strokes and precise controls' },
            ]}
          />
        </div>
      )}

      <div className="glass bar">
        <IconButton label="Undo" keys={key('undo')} disabled={!canUndo} onClick={() => useDoc.getState().undo()}>
          <Undo2 />
        </IconButton>
        {!phone && (
          <IconButton label="Redo" keys={key('redo')} disabled={!canRedo} onClick={() => useDoc.getState().redo()}>
            <Redo2 />
          </IconButton>
        )}
        <span className="sep" />
        <IconButton label={showGuides ? 'Hide outlines' : 'Show outlines'} keys={key('outlines')} active={!showGuides} onClick={() => set({ showGuides: !showGuides, selection: [] })}>
          {showGuides ? <Eye /> : <EyeOff />}
        </IconButton>
        {phone && mode === 'advanced' && (
          <IconButton label="Design and layers" onClick={() => set({ panelOpen: true })}>
            <Layers />
          </IconButton>
        )}
        {!phone && (
          <button type="button" className="btn ml-1" data-variant="primary" onClick={() => set({ sheet: 'export' })}>
            <Share />
            Export
          </button>
        )}
        <MoreButton phone={phone} canRedo={canRedo} />
      </div>
    </div>
  );
}
