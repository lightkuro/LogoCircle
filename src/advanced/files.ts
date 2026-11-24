import { toast } from 'sonner';
import { getDoc } from '@/store/doc';
import { getImageBlob, putImage } from '@/store/persist';
import type { Doc } from '@/model/types';
import { uid } from '@/model/ids';
import { openDoc } from '@/actions';
import { download, fileBase } from '@/export/files';

interface ProjectFile {
  app: 'logocircle';
  version: 1;
  doc: Doc;
  images: Record<string, string>;
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

/** Save everything — outlines, shapes, photos — as one file that can be reopened later. */
export async function saveProjectFile(): Promise<void> {
  const doc = getDoc();
  const images: Record<string, string> = {};
  for (const r of doc.refs) {
    const blob = await getImageBlob(r.blob);
    if (blob) images[r.blob] = await toDataUrl(blob);
  }
  const file: ProjectFile = { app: 'logocircle', version: 1, doc, images };
  download(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${fileBase(doc)}.logocircle.json`);
}

export async function openProjectFile(): Promise<void> {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  try {
    const data = JSON.parse(await f.text()) as ProjectFile;
    if (data.app !== 'logocircle' || data.doc?.v !== 1) throw new Error('not a project');
    for (const [id, url] of Object.entries(data.images ?? {})) {
      await putImage(id, await (await fetch(url)).blob());
    }
    // A fresh id so opening a file never overwrites a logo already in the gallery.
    openDoc({ ...data.doc, id: uid('d'), updatedAt: Date.now() });
    toast('Project opened');
  } catch {
    toast.error('That file is not a LogoCircle project.');
  }
}

export async function importSvgFile(): Promise<void> {
  const f = await pickFile('.svg,image/svg+xml');
  if (!f) return;
  try {
    const { importSvg } = await import('./importSvg');
    const count = importSvg(await f.text());
    if (count === 0) toast('Nothing to import', { description: 'No filled shapes were found in that file.' });
    else toast(`Imported ${count} shape${count === 1 ? '' : 's'}`);
  } catch {
    toast.error('That SVG could not be read.');
  }
}
