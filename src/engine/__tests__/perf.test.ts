import { describe, expect, it } from 'vitest';
import { ellipseChain } from '@/geom';
import { buildArrangement, faceAt } from '../index';
import type { Source } from '../index';
import { circle, lcg, seg } from './helpers';

describe('performance guard', () => {
  it('60 mixed guides build quickly and point location is fast', () => {
    const rnd = lcg(42);
    const sources: Source[] = [];
    for (let i = 0; i < 40; i++) {
      const x = 150 + rnd() * 724;
      const y = 150 + rnd() * 724;
      const r = 40 + rnd() * 220;
      sources.push({
        id: `c${i}`,
        fill: false,
        chains: [i % 2 === 0 ? circle(x, y, r) : ellipseChain(x, y, r, r * (0.4 + rnd() * 0.5), rnd() * Math.PI)],
      });
    }
    for (let i = 0; i < 20; i++) {
      const a = rnd() * Math.PI;
      const cx = 200 + rnd() * 624;
      const cy = 200 + rnd() * 624;
      sources.push({
        id: `l${i}`,
        fill: false,
        chains: [seg(cx - 900 * Math.cos(a), cy - 900 * Math.sin(a), cx + 900 * Math.cos(a), cy + 900 * Math.sin(a))],
      });
    }
    const bounds = { x: -1024, y: -1024, w: 3072, h: 3072 };
    buildArrangement(sources, { bounds }); // warm up the JIT
    const times: number[] = [];
    let arr = buildArrangement(sources, { bounds });
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      arr = buildArrangement(sources, { bounds });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const build = times[Math.floor(times.length / 2)]!;

    const pts = Array.from({ length: 10000 }, () => ({ x: rnd() * 1024, y: rnd() * 1024 }));
    const t1 = performance.now();
    let hits = 0;
    for (const p of pts) if (faceAt(arr, p) >= 0) hits++;
    const locate = performance.now() - t1;

    console.log(
      `[engine perf] 60 guides → ${arr.faces.length} faces (${arr.faces.filter((f) => f.follow >= 0).length} slivers), build ${build.toFixed(1)} ms (median of 5), 10k faceAt ${locate.toFixed(1)} ms`,
    );
    expect(arr.faces.length).toBeGreaterThan(500);
    expect(hits).toBeGreaterThan(5000);
    expect(build).toBeLessThan(400);
    expect(locate).toBeLessThan(100);
  });
});
