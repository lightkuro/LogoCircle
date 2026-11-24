import { useDrag } from './drag';
import { useUi } from '@/store/ui';

const SIZE = 116;
const ZOOM = 2.4;

/**
 * A magnifier above the finger while coloring on a touch screen, so the area
 * being filled is never hidden under the fingertip.
 */
export function Loupe() {
  const at = useDrag((s) => s.loupe);
  const view = useUi((s) => s.view);
  const stage = useUi((s) => s.stage);
  if (!at) return null;
  const half = SIZE / 2;
  let left = at.x - half;
  let top = at.y - SIZE - 44;
  if (top < 8) top = at.y + 56;
  left = Math.max(8, Math.min(stage.w - SIZE - 8, left));
  // Show the scene scaled up, with the touched point in the middle of the lens.
  const k = view.k * ZOOM;
  const tx = half - ((at.x - view.x) / view.k) * k;
  const ty = half - ((at.y - view.y) / view.k) * k;
  return (
    <div className="loupe" style={{ left, top, width: SIZE, height: SIZE }} aria-hidden>
      <svg width={SIZE} height={SIZE}>
        <g transform={`translate(${tx} ${ty}) scale(${k})`}>
          <use href="#lc-scene-inner" />
        </g>
        <circle cx={half} cy={half} r={3} className="loupe-dot" />
      </svg>
    </div>
  );
}
