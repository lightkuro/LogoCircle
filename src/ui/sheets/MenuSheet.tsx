import type { ReactNode } from 'react';
import { FilePlus2, FolderOpen, LayoutGrid, Save, Settings } from 'lucide-react';
import { useUi } from '@/store/ui';
import { useDoc } from '@/store/doc';
import { useIsPhone } from '@/store/settings';
import { createNewDoc, setMode } from '@/actions';
import { Segmented, Sheet, Tip } from '../primitives';
import { openProjectFile, saveProjectFile } from '@/advanced/files';

/** A menu row. Its `hint` shows on hover with a mouse; on a phone the label says enough. */
function Row({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint?: string; onClick: () => void }) {
  const row = (
    <button type="button" className="row-btn" onClick={onClick}>
      {icon}
      <span className="min-w-0">{label}</span>
    </button>
  );
  return hint ? (
    <Tip label={hint} side="right">
      {row}
    </Tip>
  ) : (
    row
  );
}

/** The LogoCircle menu: logos and settings. Help and examples live behind the question mark. */
export function MenuSheet() {
  const open = useUi((s) => s.sheet === 'menu');
  const mode = useUi((s) => s.mode);
  const name = useDoc((s) => s.doc.name);
  const phone = useIsPhone();
  const close = (): void => useUi.setState({ sheet: null });
  return (
    <Sheet open={open} onClose={close} title="LogoCircle" place="top-left">
      <input
        className="field mb-3"
        value={name}
        aria-label="Logo name"
        placeholder="Name this logo"
        spellCheck={false}
        enterKeyHint="done"
        onChange={(e) => {
          const st = useDoc.getState();
          st.patch({ ...st.doc, name: e.target.value, updatedAt: Date.now() });
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {phone && (
        <div className="pb-3">
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
      <Row
        icon={<FilePlus2 />}
        label="New logo"
        hint="Current logo stays in My logos"
        onClick={() => {
          createNewDoc();
          close();
        }}
      />
      <Row icon={<LayoutGrid />} label="My logos" onClick={() => useUi.setState({ sheet: 'gallery', galleryTab: 'mine' })} />
      {mode === 'advanced' && (
        <>
          <Row icon={<Save />} label="Save project file" hint="Everything, with outlines and photos" onClick={() => void saveProjectFile().then(close)} />
          <Row icon={<FolderOpen />} label="Open project file" onClick={() => void openProjectFile().then(close)} />
        </>
      )}
      <Row icon={<Settings />} label="Settings" hint="Layout, appearance, mouse and keyboard" onClick={() => useUi.setState({ sheet: 'settings' })} />
      <div className="menu-foot">
        <a href="/privacy" target="_blank" rel="noopener">
          Privacy &amp; terms
        </a>
      </div>
    </Sheet>
  );
}
