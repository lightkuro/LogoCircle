/**
 * What changed for the people using LogoCircle, newest first. Only what can
 * be seen or used: no fixes to the build, tests or code behind it. The first
 * entry is the current version, shown in the LogoCircle menu.
 */
export interface Release {
  version: string;
  date: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '1.13',
    date: '24 Nov 2026',
    changes: [
      'Borders around text: width, color, or hollow letters; also for anything selected',
      'Paper Mono starts in Semibold',
      'Flip, Flip upside down and Mirror copy share one list in the bar',
      'Lists in the bar show with a short animation again; the last one goes at once',
      'The LogoCircle menu stays compact on big screens',
    ],
  },
  {
    version: '1.12',
    date: '24 Nov 2026',
    changes: [
      'Move points: corners and points come before resizing, so covered corners can be dragged',
      'Right-click a corner: Move corner',
      'Select: hover Move for Normal or Move points; clicking Move or Selection picks the usual one',
      'Setting to hide the dots that add a point',
    ],
  },
  {
    version: '1.11',
    date: '24 Nov 2026',
    changes: [
      'Side panels are wider on big screens',
      'The text panel shows a preview again, as well as the word on the canvas',
      'The help popover lists the steps, with a picture beside them',
      'Version number and this list of changes, in the LogoCircle menu',
    ],
  },
  {
    version: '1.10',
    date: '24 Nov 2026',
    changes: [
      'Phones: text shows on the canvas while you type',
      'Polygons and triangles: small dots on each side to add a point',
      'Select: Box, Lasso and One at a time under Selection',
      'Paper Mono in Light to Extra bold',
      'The press-and-hold menu always fits the screen',
    ],
  },
  {
    version: '1.09',
    date: '24 Nov 2026',
    changes: [
      'Repeat: same spacing, or a pattern in a row, around a circle or in a grid',
      'Round off where two lines cross or meet',
      'Lines can be turned with a knob, and thick lines can end flat',
      'Move, in the right-click menu: just move and turn small things',
      'Right-click menus group related choices',
      'A new starting design',
    ],
  },
  {
    version: '1.08',
    date: '24 Nov 2026',
    changes: [
      'Desktop: open the bar out with the tab at its end, and pin the tools you use',
      'Desktop: text shows on the canvas while you type',
      'Font settings: weights, italics and font features such as ligatures',
      'Side panels can be dragged wider',
      'A short animation in the Guide, and plainer wording throughout',
    ],
  },
  {
    version: '1.07',
    date: '24 Nov 2026',
    changes: ['Mirror copy: copy across a line', 'One at a time adds to the selection with each tap', 'Setting: hold and drag to pick from a list'],
  },
  {
    version: '1.06',
    date: '24 Nov 2026',
    changes: ['Paper Mono font', 'A new color picker', 'Stretch polygons by their sides', 'Sticky points', 'Import SVG', 'Privacy and terms page'],
  },
  {
    version: '1.05',
    date: '24 Nov 2026',
    changes: ['Photo settings show when a photo is added', 'Frame size', 'Color sets', 'Guide and Examples from the question mark'],
  },
  {
    version: '1.04',
    date: '24 Nov 2026',
    changes: ['A layout for phones on their side', 'Background color under More'],
  },
  {
    version: '1.03',
    date: '24 Nov 2026',
    changes: ['Cut menu, and removed pieces can be brought back', 'Text panel on phones in pages: Font, Color, Size'],
  },
  {
    version: '1.02',
    date: '24 Nov 2026',
    changes: ['Settings: layout, appearance, mouse buttons and keyboard shortcuts', 'Phone layout with the colors down the side', 'Cut by tapping a segment', 'Round one corner at a time'],
  },
  {
    version: '1.01',
    date: '24 Nov 2026',
    changes: ['Tools grouped in the bar', 'Cut, Draw and Brush', 'Rounded corners and thick outlines', 'Right-click menus'],
  },
  {
    version: '1.00',
    date: '24 Nov 2026',
    changes: [
      'Draw outlines, then color the areas between them',
      'Words in bundled fonts',
      'Trace over a photo',
      'Classic and Advanced modes',
      'My logos and examples',
      'Export SVG and PNG; works offline',
    ],
  },
];

export const VERSION = CHANGELOG[0]!.version;
