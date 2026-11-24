import { create } from 'zustand';
import type { Doc } from '@/model/types';
import { newDoc } from '@/model/doc';
import { syncLinks } from '@/model/link';

const LIMIT = 200;

interface DocState {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  /** Bumped on every change; cheap cache key for derived data. */
  rev: number;
  /** Replace the document and record an undo step. A no-op if `next` is the same object. */
  commit: (next: Doc) => void;
  /** Change the document without an undo step (e.g. renaming). */
  patch: (next: Doc) => void;
  /** Swap in another document entirely (open / new). Clears history. */
  load: (doc: Doc) => void;
  undo: () => void;
  redo: () => void;
  /**
   * A preview being tried out (a pattern being set up): the document as it was
   * before. While held, `patch` shows each version; `release` keeps the last
   * one as one undo step or puts the document back. Any other change first
   * keeps the preview, and undo puts it back, so history never skips a step.
   */
  held: Doc | null;
  hold: () => void;
  release: (keep: boolean) => void;
}

export const useDoc = create<DocState>((set, get) => ({
  doc: newDoc(),
  past: [],
  future: [],
  rev: 0,
  held: null,
  commit: (change) => {
    const { doc, past, rev, held } = get();
    if (change === doc) return;
    const next = syncLinks(doc, change);
    const p = past.length >= LIMIT ? past.slice(past.length - LIMIT + 1) : past.slice();
    // A preview still open is kept, as a step of its own, before this change.
    if (held && held !== doc) p.push(held);
    p.push(doc);
    set({ doc: next, past: p, future: [], rev: rev + 1, held: null });
  },
  hold: () => set((s) => ({ held: s.held ?? s.doc })),
  release: (keep) => {
    const { doc, past, held, rev } = get();
    if (!held) return;
    if (!keep || held === doc) return set({ doc: held, held: null, rev: rev + 1 });
    set({ past: [...past, held], future: [], held: null });
  },
  patch: (next) => set((s) => ({ doc: syncLinks(s.doc, next), rev: s.rev + 1 })),
  load: (doc) => set((s) => ({ doc, past: [], future: [], rev: s.rev + 1, held: null })),
  undo: () => {
    const { doc, past, future, rev, held } = get();
    // Undo while trying out a preview: just put things back.
    if (held) return set({ doc: held, held: null, rev: rev + 1 });
    if (!past.length) return;
    const prev = past[past.length - 1]!;
    set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], rev: rev + 1 });
  },
  redo: () => {
    const { doc, past, future, rev, held } = get();
    if (!future.length || held) return;
    const next = future[0]!;
    set({ doc: next, past: [...past, doc], future: future.slice(1), rev: rev + 1 });
  },
}));

export const getDoc = (): Doc => useDoc.getState().doc;
export const commit = (next: Doc): void => useDoc.getState().commit(next);
