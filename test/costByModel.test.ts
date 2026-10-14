import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import { costByModelData, costByModelInput } from '@/lib/charts/costByModel';
import { seriesData } from '@/lib/charts/seriesViews';

const ROWS = [
  { day: '2026-09-01', model: 'claude-opus-5', cost: 12.5 },
  { day: '2026-09-02', model: 'claude-opus-5', cost: 18.25 },
  { day: '2026-09-01', model: 'claude-fable-5-1', cost: 4.75 },
];

describe('costByModel spec', () => {
  it('compiles a stacked area layer with its edges', () => {
    const result = createCompiler().compile({
      spec: costByModelInput,
      data: seriesData('stacked', costByModelData(ROWS), {
        bucket: (row) => row.day,
        series: (row) => row.model,
        value: (row) => row.cost,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.layers.map((layer) => layer.geom)).toEqual(['area', 'line']);
    expect(result.scene.layers[0].position).toBe('stack');
  });

  it('exposes the columns by key, in the order the rows carry them', () => {
    expect(costByModelData(ROWS)).toEqual({
      columns: [{ key: 'day' }, { key: 'model' }, { key: 'cost' }],
      rows: ROWS,
    });
  });
});
