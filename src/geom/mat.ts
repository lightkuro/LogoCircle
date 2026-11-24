import type { Mat, Pt } from './types';

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** Compose: the result applies `b` first, then `a`. */
export function mul(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function translate(tx: number, ty: number): Mat {
  return [1, 0, 0, 1, tx, ty];
}

export function rotate(angle: number, cx = 0, cy = 0): Mat {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

export function scale(sx: number, sy: number = sx, cx = 0, cy = 0): Mat {
  return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-14) return IDENTITY;
  const ia = m[3] / det;
  const ib = -m[1] / det;
  const ic = -m[2] / det;
  const id = m[0] / det;
  return [ia, ib, ic, id, -(ia * m[4] + ic * m[5]), -(ib * m[4] + id * m[5])];
}

export function apply(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Apply only the linear part (no translation) — for vectors. */
export function applyVec(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y };
}

export function det(m: Mat): number {
  return m[0] * m[3] - m[1] * m[2];
}

export function isIdentity(m: Mat): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

export function toCss(m: Mat): string {
  return `matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]})`;
}
