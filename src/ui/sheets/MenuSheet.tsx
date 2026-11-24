import { FilePlus2, FolderOpen, Keyboard, LayoutGrid, Sparkles, Upload, Save } from 'lucide-react';
import { useUi } from '@/store/ui';
import { useDoc } from '@/store/doc';
import { createNewDoc, setMode } from '@/actions';
import { Segmented, Sheet, useIsPhone } from '../primitives';
import { importSvgFile, openProjectFile, saveProjectFile } from '@/advanced/files';

function Row({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" className="row-btn" onClick={onClick}>
      {icon}
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="block text-[12.5px] text-muted">{hint}</span>}
      </span>
    </button>
  );
}

export function MenuSheet() {
  const open = useUi((s) => s.sheet === 'menu');
  const mode = useUi((s) => s.mode);
  const name = useDoc((s) => s.doc.name);
  const phone = useIsPhone();
  const go = (sheet: 'gallery' | 'help'): void => useUi.setState({ sheet, galleryTab: 'mine' });
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
          <p className="mb-0 mt-2 text-[12.5px] leading-snug text-muted">
            {mode === 'classic' ? 'Classic keeps it to three colors and the essentials.' : 'Advanced adds layers, more colors, a pen, strokes and precise controls.'}
          </p>
        </div>
      )}
      <Row
        icon={<FilePlus2 />}
        label="New logo"
        hint="Your current one stays in My logos"
        onClick={() => {
          createNewDoc();
          close();
        }}
      />
      <Row icon={<LayoutGrid />} label="My logos" onClick={() => go('gallery')} />
      <Row icon={<Sparkles />} label="Examples" hint="Open one and take it apart" onClick={() => useUi.setState({ sheet: 'gallery', galleryTab: 'examples' })} />
      {mode === 'advanced' && (
        <>
          <Row icon={<Upload />} label="Import SVG" hint="Bring in an existing logo to edit" onClick={() => void importSvgFile().then(close)} />
          <Row icon={<Save />} label="Save project file" hint="Everything, including outlines and photos" onClick={() => void saveProjectFile().then(close)} />
          <Row icon={<FolderOpen />} label="Open project file" onClick={() => void openProjectFile().then(close)} />
        </>
      )}
      <Row icon={<Keyboard />} label="How it works" onClick={() => go('help')} />
      <p className="mb-0 mt-3 px-2 text-[12px] leading-snug text-muted">
        Everything stays on this device. Nothing is uploaded.
      </p>
    </Sheet>
  );
}
