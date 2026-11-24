import { distToPolyline, polygonArea, windingOfPolygon, type Pt } from '@/geom';
import type { Doc, Guide } from '@/model/types';
import { guidePoints, isClosedGuide } from '@/model/guides';
import { refCorners, shapePolygons } from '@/model/ops';

function inPolys(p: Pt, polys: Pt[][]): boolean {
  let w = 0;
  for (const poly of polys) w += windingOfPolygon(p, poly);
  return w !== 0;
}

/**
 * Everything under a point, best candidate first:
 *   1. outlines (of the given, visible ones) passing within `tol` (closest first),
 *   2. shapes containing the point (topmost first),
 *   3. the smallest closed guide containing the point,
 *   4. unlocked photos containing the point.
 */
export function hitItems(doc: Doc, p: Pt, tol: number, guides: Guide[]): string[] {
  const out: string[] = [];
  const showGuides = guides.length > 0;

  if (showGuides) {
    const near: { id: string; d: number }[] = [];
    for (const g of guides) {
      if (g.hidden || g.locked) continue;
      let best = Infinity;
      const polys = guidePoints(g);
      guideEach: for (const pts of polys) {
        const d = distToPolyline(p, pts, false);
        if (d < best) best = d;
        if (pts.length > 2) {
          // closing segment
          const d2 = distToPolyline(p, [pts[pts.length - 1]!, pts[0]!], false);
          if (isClosedGuide(g) && d2 < best) best = d2;
        }
        if (best === 0) break guideEach;
      }
      if (best <= tol) near.push({ id: g.id, d: best });
    }
    near.sort((a, b) => a.d - b.d);
    for (const n of near) out.push(n.id);
  }

  for (let i = doc.shapes.length - 1; i >= 0; i--) {
    const s = doc.shapes[i]!;
    if (s.hidden || s.locked) continue;
    if (inPolys(p, shapePolygons(s))) out.push(s.id);
  }

  if (showGuides) {
    const inside: { id: string; area: number }[] = [];
    for (const g of guides) {
      if (g.hidden || g.locked || out.includes(g.id) || !isClosedGuide(g)) continue;
      const polys = guidePoints(g);
      if (inPolys(p, polys)) inside.push({ id: g.id, area: Math.abs(polys.reduce((a, q) => a + polygonArea(q), 0)) });
    }
    inside.sort((a, b) => a.area - b.area);
    for (const n of inside) out.push(n.id);
  }

  for (let i = doc.refs.length - 1; i >= 0; i--) {
    const r = doc.refs[i]!;
    if (r.hidden || r.locked) continue;
    if (windingOfPolygon(p, refCorners(r)) !== 0) out.push(r.id);
  }
  return out;
}
