/**
 * The idea of the app in pictures, no words needed: outlines, a piece trimmed
 * away, the areas colored. A still diagram for the help popover, and a short
 * looping animation of the same steps for the Guide.
 */
import '@/styles/help.css';

const TEAL = '#16877f';
const ORANGE = '#f29e4c';

type P = { x: number; y: number };

/**
 * A circle crossed by a line: the line's ends stick out (to be trimmed) and
 * the chord splits the circle into two areas (to be colored).
 */
function scene(cx: number, cy: number, r: number) {
  const at = (deg: number): P => ({ x: cx + r * Math.cos((deg * Math.PI) / 180), y: cy + r * Math.sin((deg * Math.PI) / 180) });
  const a = at(150);
  const b = at(-15);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ext = 0.28;
  const s = { x: a.x - dx * ext, y: a.y - dy * ext };
  const e = { x: b.x + dx * ext, y: b.y + dy * ext };
  const f = (n: number): string => n.toFixed(2);
  const seg = (p: P, q: P): string => `M${f(p.x)} ${f(p.y)}L${f(q.x)} ${f(q.y)}`;
  return {
    a,
    b,
    s,
    e,
    full: seg(s, e),
    chord: seg(a, b),
    outA: seg(s, a),
    outB: seg(b, e),
    // the larger area, over the top, and the smaller one under the chord
    top: `M${f(b.x)} ${f(b.y)}A${r} ${r} 0 1 0 ${f(a.x)} ${f(a.y)}Z`,
    bottom: `M${f(a.x)} ${f(a.y)}A${r} ${r} 0 0 0 ${f(b.x)} ${f(b.y)}Z`,
  };
}

const mini = scene(50, 50, 30);

/** All three steps in one picture: the outlines, their ends trimmed away (dotted), the areas colored. */
export function HowItWorksPicture() {
  return (
    <svg className="hiw-picture" viewBox="0 0 100 100" role="img" aria-label="Add shapes, trim, color areas">
      <rect x={0.5} y={0.5} width={99} height={99} rx={14} className="hiw-paper" />
      <path d={mini.top} fill={TEAL} />
      <path d={mini.bottom} fill={ORANGE} />
      <path d={mini.outA} className="hiw-trimmed" />
      <path d={mini.outB} className="hiw-trimmed" />
      <circle cx={50} cy={50} r={30} className="hiw-line" />
      <path d={mini.chord} className="hiw-line" />
    </svg>
  );
}

const big = scene(160, 84, 52);
/** Inside each area, where the pointer taps to color it. */
const TOP_TAP = { x: 160, y: 62 };
const BOTTOM_TAP = { x: 170, y: 114 };
const mid = (p: P, q: P): P => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

/**
 * The whole sequence in a few seconds, on a loop: a circle and a line appear,
 * the ends of the line are trimmed, the two areas are colored, the outlines
 * hide and the logo is left. Still (the finished logo) with reduced motion.
 */
export function HowItWorksAnimation() {
  const m1 = mid(big.s, big.a);
  const m2 = mid(big.b, big.e);
  // The pointer's stops, fed to the stylesheet's keyframes.
  const stops: Record<string, string> = {
    '--s': `translate(${big.s.x}px, ${big.s.y}px)`,
    '--e': `translate(${big.e.x}px, ${big.e.y}px)`,
    '--m1': `translate(${m1.x}px, ${m1.y}px)`,
    '--m2': `translate(${m2.x}px, ${m2.y}px)`,
    '--t': `translate(${TOP_TAP.x}px, ${TOP_TAP.y}px)`,
    '--b': `translate(${BOTTOM_TAP.x}px, ${BOTTOM_TAP.y}px)`,
  };
  return (
    <figure className="hiw-anim-wrap">
      <svg className="hiw-anim" viewBox="0 0 320 168" role="img" aria-label="Animation: add shapes, trim, color areas, hide outlines" style={stops as React.CSSProperties}>
        <rect x={0.5} y={0.5} width={319} height={167} rx={16} className="hiw-paper" />
        <g className="hiw-logo">
          <path d={big.top} fill={TEAL} className="hiw-fill hiw-fill-top" />
          <path d={big.bottom} fill={ORANGE} className="hiw-fill hiw-fill-bottom" />
        </g>
        <circle cx={160} cy={84} r={52} pathLength={1} className="hiw-line hiw-a-circle" />
        <path d={big.outA} pathLength={1} className="hiw-line hiw-a-outA" />
        <path d={big.chord} pathLength={1} className="hiw-line hiw-a-chord" />
        <path d={big.outB} pathLength={1} className="hiw-line hiw-a-outB" />
        <g className="hiw-pointer">
          <circle r={14} className="hiw-ripple" />
          <circle r={6.5} className="hiw-dot" />
        </g>
      </svg>
      <figcaption className="hiw-steps" aria-hidden>
        <span>Add shapes</span>
        <span>Trim</span>
        <span>Color areas</span>
        <span>Hide outlines</span>
      </figcaption>
    </figure>
  );
}
