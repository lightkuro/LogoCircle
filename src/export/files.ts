import type { Doc } from '@/model/types';
import { docToSvg, type SvgOptions } from './svg';

export function fileBase(doc: Doc): string {
  const s = doc.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'logo';
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function svgBlob(doc: Doc, options: Partial<SvgOptions>): Blob {
  return new Blob([docToSvg(doc, options)], { type: 'image/svg+xml' });
}

/** Rasterize the logo. `size` is the pixel width. */
export async function rasterBlob(doc: Doc, options: Partial<SvgOptions>, size: number, type = 'image/png', quality = 0.92): Promise<Blob> {
  const opts = { ...options };
  // JPEG has no transparency: always paint a background.
  if (type === 'image/jpeg') opts.background = true;
  const svg = docToSvg(doc, { ...opts, size });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Could not render the logo'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = Math.max(1, Math.round((size * img.naturalHeight) / Math.max(1, img.naturalWidth)));
    const ctx = canvas.getContext('2d')!;
    if (type === 'image/jpeg' && !doc.paper) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
    if (!blob) throw new Error('Could not encode the image');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Use the system share sheet when the device has one; otherwise download. */
export async function shareOrDownload(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return 'cancelled';
    }
  }
  download(blob, name);
  return 'downloaded';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
