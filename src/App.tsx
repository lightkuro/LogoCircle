import { useEffect, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import { Stage } from '@/canvas/Stage';
import { useDoc } from '@/store/doc';
import { loadCurrent, startAutosave } from '@/store/persist';
import { openDoc, addPhoto, fitToScreen, pasteFromSystem } from '@/actions';
import { remember } from '@/store/ui';
import { useDocumentAttributes, useIsDark, useLayoutKind } from '@/store/settings';
import { useShortcuts } from '@/shortcuts';
import { TopBar } from '@/ui/TopBar';
import { ColorStrip, Dock, SideControls } from '@/ui/Dock';
import { ContextBar, TopHint } from '@/ui/ContextBar';
import { TipProvider, useIsPhone } from '@/ui/primitives';
import { Sheets } from '@/ui/Sheets';
import { ContextMenu } from '@/ui/ContextMenu';
import { ZoomControl } from '@/ui/ZoomControl';
import { AdvancedPanel } from '@/ui/advanced/Panel';
import { thumbnail } from '@/export/svg';
import { isTyping } from '@/canvas/useGestures';
import { startBackdropNudge } from '@/ui/backdrop';

const seenBefore = (): boolean => {
  try {
    return localStorage.getItem('lc.seen') === '1';
  } catch {
    return false;
  }
};

export function App() {
  const [, setReady] = useState(false);
  const phone = useIsPhone();
  const kind = useLayoutKind();
  const side = kind === 'side';
  const dark = useIsDark();
  useDocumentAttributes();
  useShortcuts();

  useEffect(() => {
    let stop: (() => void) | undefined;
    void loadCurrent()
      .catch(() => undefined)
      .then(async (doc) => {
        let first = doc && doc.v === 1 ? doc : undefined;
        if (!first && !seenBefore()) {
          // A first visit starts with a small example to take apart instead of a blank page.
          first = await import('@/examples/starter').then((m) => m.buildStarter()).catch(() => undefined);
          remember('lc.seen', '1');
        }
        if (first) useDoc.getState().load(first);
        setReady(true);
        stop = startAutosave(thumbnail);
        if (first) requestAnimationFrame(() => openDoc(useDoc.getState().doc));
      });
    return () => stop?.();
  }, []);

  useEffect(() => startBackdropNudge(), []);

  // Turning the phone moves the controls around: fit the canvas to the room it now has.
  const firstKind = useRef(true);
  useEffect(() => {
    if (firstKind.current) return void (firstKind.current = false);
    const id = requestAnimationFrame(() => fitToScreen());
    return () => cancelAnimationFrame(id);
  }, [kind]);

  // Photos can be pasted or dropped anywhere.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (isTyping(e.target)) return;
      // our own copy or an image from elsewhere: whichever was copied last, never both
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (pasteFromSystem(file ?? null)) e.preventDefault();
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
        <TopBar />
        {phone && <TopHint />}
        {phone && !side && <ColorStrip />}
        <div className="chrome-bottom">
          <ContextBar />
          {!side && <Dock />}
        </div>
        {side && (
          <>
            <div className="side-left">
              <Dock />
              <ColorStrip />
            </div>
            <div className="side-right">
              <SideControls />
            </div>
          </>
        )}
        {!phone && <ZoomControl />}
        <AdvancedPanel />
        <Sheets />
        <ContextMenu />
        <Toaster theme={dark ? 'dark' : 'light'} position="top-center" offset={phone ? 76 : 72} mobileOffset={76} toastOptions={{ style: { borderRadius: 14 } }} />
      </div>
    </TipProvider>
  );
}
