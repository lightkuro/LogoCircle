import { create } from 'zustand';
import type { Fill } from '@/model/types';

/**
 * The word being typed in the text panel, drawn on the canvas as it will land
 * (desktop). Nothing is in the document until the panel is closed.
 */
interface TextPreview {
  /** The letters, as path data in document space. */
  d: string | null;
  fill: Fill;
  /** The word being retyped, hidden while its new version is shown. */
  hide: string | null;
}

export const useTextPreview = create<TextPreview>(() => ({ d: null, fill: 0, hide: null }));

export const clearTextPreview = (): void => useTextPreview.setState({ d: null, hide: null });
