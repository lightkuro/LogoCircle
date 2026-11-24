import { useRef } from 'react';
import type { Doc } from '@/model/types';
import { useDoc } from '@/store/doc';

/**
 * For sliders: show every intermediate value on the canvas, but record just
 * one undo step when the drag ends.
 */
export function useLiveEdit(): { change: (make: (doc: Doc) => Doc) => void; commit: () => void } {
  const base = useRef<Doc | null>(null);
  return {
    change: (make) => {
      const st = useDoc.getState();
      if (!base.current) base.current = st.doc;
      st.patch(make(st.doc));
    },
    commit: () => {
      const st = useDoc.getState();
      const from = base.current;
      base.current = null;
      if (!from || from === st.doc) return;
      const next = st.doc;
      st.patch(from);
      st.commit(next);
    },
  };
}
