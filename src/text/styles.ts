/** The style of a word beyond its font: weight, slant and OpenType features. */

export interface TextStyle {
  /** 100 to 900; absent = the font's own default. */
  weight?: number;
  italic?: boolean;
  /** OpenType features switched on, by tag. */
  features?: string[];
}

export const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
};

/** The table of style files, loaded the first time it is needed. */
export const styleTable = (): Promise<typeof import('./styleTable')> => import('./styleTable');
