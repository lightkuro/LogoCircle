import { createStore, del, get, keys, set } from 'idb-keyval';
import type { Doc } from '@/model/types';
import { useDoc } from './doc';

const db = createStore('logocircle', 'kv');

export interface DocMeta {
  id: string;
  name: string;
  updatedAt: number;
  /** Small SVG preview. */
  thumb: string;
}

const INDEX = 'index';
const CURRENT = 'current';
const docKey = (id: string) => `doc:${id}`;
const imgKey = (id: string) => `img:${id}`;

export async function listDocs(): Promise<DocMeta[]> {
  const list = ((await get(INDEX, db)) as DocMeta[] | undefined) ?? [];
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveDoc(doc: Doc, thumb: string): Promise<void> {
  await set(docKey(doc.id), doc, db);
  const list = ((await get(INDEX, db)) as DocMeta[] | undefined) ?? [];
  const meta: DocMeta = { id: doc.id, name: doc.name, updatedAt: doc.updatedAt, thumb };
  const i = list.findIndex((m) => m.id === doc.id);
  if (i >= 0) list[i] = meta;
  else list.push(meta);
  await set(INDEX, list, db);
  await set(CURRENT, doc.id, db);
}

export async function loadDoc(id: string): Promise<Doc | undefined> {
  return (await get(docKey(id), db)) as Doc | undefined;
}

export async function loadCurrent(): Promise<Doc | undefined> {
  const id = (await get(CURRENT, db)) as string | undefined;
  return id ? loadDoc(id) : undefined;
}

export async function deleteDoc(id: string): Promise<void> {
  const doc = await loadDoc(id);
  await del(docKey(id), db);
  const list = ((await get(INDEX, db)) as DocMeta[] | undefined) ?? [];
  await set(INDEX, list.filter((m) => m.id !== id), db);
  // Images are only referenced by their own document.
  for (const r of doc?.refs ?? []) await del(imgKey(r.blob), db);
}

// --- images -----------------------------------------------------------------

const urls = new Map<string, string>();

export async function putImage(id: string, blob: Blob): Promise<string> {
  await set(imgKey(id), blob, db);
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

/** Object URL for a stored image (cached for the session). */
export async function imageUrl(id: string): Promise<string | undefined> {
  const hit = urls.get(id);
  if (hit) return hit;
  const blob = (await get(imgKey(id), db)) as Blob | undefined;
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export async function getImageBlob(id: string): Promise<Blob | undefined> {
  return (await get(imgKey(id), db)) as Blob | undefined;
}

export async function allKeys(): Promise<string[]> {
  return (await keys(db)) as string[];
}

// --- autosave ---------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined;
let thumbOf: ((doc: Doc) => string) | undefined;

/** Save the current document shortly after every change. */
export function startAutosave(makeThumb: (doc: Doc) => string): () => void {
  thumbOf = makeThumb;
  const flush = (): void => {
    const doc = useDoc.getState().doc;
    void saveDoc(doc, thumbOf ? thumbOf(doc) : '').catch(() => {
      /* storage full or unavailable: keep working in memory */
    });
  };
  const unsub = useDoc.subscribe((s, prev) => {
    if (s.doc === prev.doc) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 400);
  });
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer);
      flush();
    }
  };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    unsub();
    document.removeEventListener('visibilitychange', onHide);
  };
}
