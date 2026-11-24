import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { Stage } from '@/canvas/Stage';
import { useDoc } from '@/store/doc';
import { loadCurrent, startAutosave } from '@/store/persist';
import { openDoc, addPhoto } from '@/actions';
import { useShortcuts } from '@/shortcuts';
import { TopBar } from '@/ui/TopBar';
import { Dock } from '@/ui/Dock';
import { ContextBar } from '@/ui/ContextBar';
import { TipProvider, useIsPhone } from '@/ui/primitives';
import { Sheets } from '@/ui/Sheets';
import { Welcome } from '@/ui/Welcome';
import { ZoomControl } from '@/ui/ZoomControl';
import { AdvancedPanel } from '@/ui/advanced/Panel';
import { thumbnail } from '@/export/svg';
import { isTyping } from '@/canvas/useGestures';

export function App() {
  const [ready, setReady] = useState(false);
  const phone = useIsPhone();
  useShortcuts();

  useEffect(() => {
    let stop: (() => void) | undefined;
    void loadCurrent()
      .catch(() => undefined)
      .then((doc) => {
        if (doc && doc.v === 1) useDoc.getState().load(doc);
        setReady(true);
        stop = startAutosave(thumbnail);
        if (doc) requestAnimationFrame(() => openDoc(useDoc.getState().doc));
      });
    return () => stop?.();
  }, []);

  // Photos can be pasted or dropped anywhere.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (isTyping(e.target)) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        void addPhoto(file);
      }
    };
    const onDrop = (e: DragEvent): void => {
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        void addPhoto(file);
      }
    };
    const onDragOver = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, []);

  return (
    <TipProvider delay={500} closeDelay={0} timeout={400}>
      <div className="app">
        <Stage />
        {ready && <Welcome />}
        <TopBar />
        <div className="chrome-bottom">
          <ContextBar />
          <Dock />
        </div>
        {!phone && <ZoomControl />}
        <AdvancedPanel />
        <Sheets />
        <Toaster position="top-center" offset={phone ? 76 : 72} mobileOffset={76} toastOptions={{ style: { borderRadius: 14 } }} />
      </div>
    </TipProvider>
  );
}
