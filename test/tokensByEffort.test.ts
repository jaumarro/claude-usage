import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import { tokensByEffortData, tokensByEffortInput } from '@/lib/charts/tokensByEffort';
import { seriesData } from '@/lib/charts/seriesViews';

const ROWS = [
  { day: '2026-09-01', effort: 'high', tokens: 100 },
  { day: '2026-09-02', effort: 'high', tokens: 140 },
  { day: '2026-09-01', effort: 'max', tokens: 60 },
  { day: '2026-09-02', effort: 'unset', tokens: 20 },
];

describe('tokensByEffort spec', () => {
  it('compiles a stacked area layer with its edges', () => {
    const result = createCompiler().compile({
      spec: tokensByEffortInput,
      data: seriesData('stacked', tokensByEffortData(ROWS), {
        bucket: (row) => row.day,
        series: (row) => row.effort,
        value: (row) => row.tokens,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.layers.map((layer) => layer.geom)).toEqual(['area', 'line']);
    expect(result.scene.layers[0].position).toBe('stack');
  });

  it('declares the columns the query fills', () => {
    expect(tokensByEffortData(ROWS).columns).toEqual([
      { key: 'day' },
      { key: 'effort' },
      { key: 'tokens' },
    ]);
  });
});
