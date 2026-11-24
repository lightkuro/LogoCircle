import { create } from 'zustand';
import type { Doc } from '@/model/types';
import { newDoc } from '@/model/doc';

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
}

export const useDoc = create<DocState>((set, get) => ({
  doc: newDoc(),
  past: [],
  future: [],
  rev: 0,
  commit: (next) => {
    const { doc, past, rev } = get();
    if (next === doc) return;
    const p = past.length >= LIMIT ? past.slice(past.length - LIMIT + 1) : past.slice();
    p.push(doc);
    set({ doc: next, past: p, future: [], rev: rev + 1 });
  },
  patch: (next) => set((s) => ({ doc: next, rev: s.rev + 1 })),
  load: (doc) => set((s) => ({ doc, past: [], future: [], rev: s.rev + 1 })),
  undo: () => {
    const { doc, past, future, rev } = get();
    if (!past.length) return;
    const prev = past[past.length - 1]!;
    set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], rev: rev + 1 });
  },
  redo: () => {
    const { doc, past, future, rev } = get();
    if (!future.length) return;
    const next = future[0]!;
    set({ doc: next, past: [...past, doc], future: future.slice(1), rev: rev + 1 });
  },
}));

export const getDoc = (): Doc => useDoc.getState().doc;
export const commit = (next: Doc): void => useDoc.getState().commit(next);
