/** Bundled fonts (all SIL Open Font License, via @fontsource). Files load on demand. */
import f0a from '@fontsource/poppins/files/poppins-latin-700-normal.woff?url';
import f0b from '@fontsource/poppins/files/poppins-latin-ext-700-normal.woff?url';
import f1a from '@fontsource/montserrat/files/montserrat-latin-800-normal.woff?url';
import f1b from '@fontsource/montserrat/files/montserrat-latin-ext-800-normal.woff?url';
import f2a from '@fontsource/inter/files/inter-latin-800-normal.woff?url';
import f2b from '@fontsource/inter/files/inter-latin-ext-800-normal.woff?url';
import f3a from '@fontsource/outfit/files/outfit-latin-700-normal.woff?url';
import f3b from '@fontsource/outfit/files/outfit-latin-ext-700-normal.woff?url';
import f4a from '@fontsource/josefin-sans/files/josefin-sans-latin-700-normal.woff?url';
import f4b from '@fontsource/josefin-sans/files/josefin-sans-latin-ext-700-normal.woff?url';
import f5a from '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff?url';
import f5b from '@fontsource/space-grotesk/files/space-grotesk-latin-ext-700-normal.woff?url';
import f6a from '@fontsource/rubik/files/rubik-latin-800-normal.woff?url';
import f6b from '@fontsource/rubik/files/rubik-latin-ext-800-normal.woff?url';
import f7a from '@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff?url';
import f7b from '@fontsource/archivo-black/files/archivo-black-latin-ext-400-normal.woff?url';
import f8a from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url';
import f8b from '@fontsource/bebas-neue/files/bebas-neue-latin-ext-400-normal.woff?url';
import f9a from '@fontsource/anton/files/anton-latin-400-normal.woff?url';
import f9b from '@fontsource/anton/files/anton-latin-ext-400-normal.woff?url';
import f10a from '@fontsource/oswald/files/oswald-latin-700-normal.woff?url';
import f10b from '@fontsource/oswald/files/oswald-latin-ext-700-normal.woff?url';
import f11a from '@fontsource/righteous/files/righteous-latin-400-normal.woff?url';
import f11b from '@fontsource/righteous/files/righteous-latin-ext-400-normal.woff?url';
import f12a from '@fontsource/fredoka/files/fredoka-latin-700-normal.woff?url';
import f12b from '@fontsource/fredoka/files/fredoka-latin-ext-700-normal.woff?url';
import f13a from '@fontsource/nunito/files/nunito-latin-900-normal.woff?url';
import f13b from '@fontsource/nunito/files/nunito-latin-ext-900-normal.woff?url';
import f14a from '@fontsource/playfair-display/files/playfair-display-latin-800-normal.woff?url';
import f14b from '@fontsource/playfair-display/files/playfair-display-latin-ext-800-normal.woff?url';
import f15a from '@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff?url';
import f15b from '@fontsource/dm-serif-display/files/dm-serif-display-latin-ext-400-normal.woff?url';
import f16a from '@fontsource/abril-fatface/files/abril-fatface-latin-400-normal.woff?url';
import f16b from '@fontsource/abril-fatface/files/abril-fatface-latin-ext-400-normal.woff?url';
import f17a from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff?url';
import f17b from '@fontsource/pacifico/files/pacifico-latin-ext-400-normal.woff?url';

export interface FontDef {
  id: string;
  name: string;
  kind: 'sans' | 'display' | 'round' | 'serif' | 'script' | 'custom';
  /** Font files, tried in order for each character (Latin, then extended Latin). */
  urls: string[];
}

export const FONTS: FontDef[] = [
  { id: 'poppins', name: 'Poppins', kind: 'sans', urls: [f0a, f0b] },
  { id: 'montserrat', name: 'Montserrat', kind: 'sans', urls: [f1a, f1b] },
  { id: 'inter', name: 'Inter', kind: 'sans', urls: [f2a, f2b] },
  { id: 'outfit', name: 'Outfit', kind: 'sans', urls: [f3a, f3b] },
  { id: 'josefin-sans', name: 'Josefin Sans', kind: 'sans', urls: [f4a, f4b] },
  { id: 'space-grotesk', name: 'Space Grotesk', kind: 'sans', urls: [f5a, f5b] },
  { id: 'rubik', name: 'Rubik', kind: 'sans', urls: [f6a, f6b] },
  { id: 'archivo-black', name: 'Archivo Black', kind: 'display', urls: [f7a, f7b] },
  { id: 'bebas-neue', name: 'Bebas Neue', kind: 'display', urls: [f8a, f8b] },
  { id: 'anton', name: 'Anton', kind: 'display', urls: [f9a, f9b] },
  { id: 'oswald', name: 'Oswald', kind: 'display', urls: [f10a, f10b] },
  { id: 'righteous', name: 'Righteous', kind: 'display', urls: [f11a, f11b] },
  { id: 'fredoka', name: 'Fredoka', kind: 'round', urls: [f12a, f12b] },
  { id: 'nunito', name: 'Nunito', kind: 'round', urls: [f13a, f13b] },
  { id: 'playfair-display', name: 'Playfair Display', kind: 'serif', urls: [f14a, f14b] },
  { id: 'dm-serif-display', name: 'DM Serif Display', kind: 'serif', urls: [f15a, f15b] },
  { id: 'abril-fatface', name: 'Abril Fatface', kind: 'serif', urls: [f16a, f16b] },
  { id: 'pacifico', name: 'Pacifico', kind: 'script', urls: [f17a, f17b] },
];

export const DEFAULT_FONT = 'poppins';
