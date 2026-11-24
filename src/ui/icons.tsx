/** A few glyphs that say "outline" better than the stock icon set does. */
import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  ...p,
});

export const LineIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 19 19 5" />
    <circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const CurveIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 18C6 6 13 20 20 6" />
    <circle cx="4" cy="18" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="20" cy="6" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const EraseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19" />
    <path d="M22 21H7M5 11l9 9" />
  </svg>
);

export const LogoMark = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" {...p}>
    <circle cx="9" cy="12" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".4" />
    <circle cx="15" cy="12" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".4" />
    <path d="M12 6.58a6.2 6.2 0 0 1 0 10.84a6.2 6.2 0 0 1 0-10.84Z" fill="var(--accent)" />
  </svg>
);
