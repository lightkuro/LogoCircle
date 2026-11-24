import { Minus, Plus, Maximize } from 'lucide-react';
import { useUi } from '@/store/ui';
import { fitToScreen, zoomBy } from '@/actions';
import { IconButton } from './primitives';

/** Desktop only: phones pinch. */
export function ZoomControl() {
  const k = useUi((s) => s.view.k);
  return (
    <div className="glass bar zoom-control" style={{ position: 'absolute', right: 10, bottom: 12, zIndex: 9 }}>
      <IconButton label="Zoom out" tipSide="top" onClick={() => zoomBy(0.8)}>
        <Minus />
      </IconButton>
      <button type="button" className="chip" style={{ minWidth: 56, justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }} onClick={() => fitToScreen()} aria-label="Fit to screen">
        {Math.round(k * 100)}%
      </button>
      <IconButton label="Zoom in" tipSide="top" onClick={() => zoomBy(1.25)}>
        <Plus />
      </IconButton>
      <IconButton label="Fit to screen" tipSide="top" onClick={() => fitToScreen()}>
        <Maximize />
      </IconButton>
    </div>
  );
}
