import { Circle, Image as ImageIcon, Sparkles, Type } from 'lucide-react';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { isEmptyDoc } from '@/model/doc';
import { addOutline, pickPhoto } from '@/actions';

/** Empty canvas: say how it works in one breath and offer the first step. */
export function Welcome() {
  const empty = useDoc((s) => isEmptyDoc(s.doc));
  const sheet = useUi((s) => s.sheet);
  const tool = useUi((s) => s.tool);
  // Only while nothing has been started: a drawing tool in use must never be blocked by this card.
  if (!empty || sheet || tool !== 'arrange') return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center px-6" style={{ paddingBottom: 96 }}>
      <div className="pointer-events-auto w-full max-w-[380px] text-center">
        <h1 className="m-0 text-[26px] font-semibold leading-[1.1] tracking-[-0.02em]">Draw outlines, then color in.</h1>
        <p className="mx-auto mb-5 mt-2.5 max-w-[320px] text-[15px] leading-snug text-muted">
          Lay circles and lines over each other. Tap a color, then tap the areas you want. That is your logo.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" className="btn" data-variant="primary" data-size="lg" onClick={() => addOutline('circle')}>
            <Circle />
            Add a circle
          </button>
          <button type="button" className="btn" data-size="lg" onClick={pickPhoto}>
            <ImageIcon />
            Trace a photo
          </button>
          <button type="button" className="btn" data-size="lg" onClick={() => useUi.setState({ sheet: 'text', textTarget: null })}>
            <Type />
            Start with a word
          </button>
        </div>
        <button type="button" className="chip mx-auto mt-3" onClick={() => useUi.setState({ sheet: 'gallery', galleryTab: 'examples' })}>
          <Sparkles />
          See examples
        </button>
      </div>
    </div>
  );
}
