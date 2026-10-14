import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import {
  COST_KINDS,
  costByKindBarsInput,
  costByKindData,
  costByKindInputFor,
  costKindViewsFor,
  type CostByKindRow,
} from '@/lib/charts/costByKind';
import { TIME_VIEWS, seriesData } from '@/lib/charts/seriesViews';

const ROWS: CostByKindRow[] = ['2026-09-01', '2026-09-02'].flatMap((day) =>
  COST_KINDS.map((kind, index) => ({ day, kind, cost: index + 1 })),
);

describe('costByKind spec', () => {
  for (const view of TIME_VIEWS) {
    it(`compiles the ${view} view with one band per kind`, () => {
      const result = createCompiler().compile({
        spec: costByKindInputFor(view),
        data: seriesData(view, costByKindData(ROWS), {
          bucket: (row) => row.day,
          series: (row) => row.kind,
          value: (row) => row.cost,
        }),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.warnings).toEqual([]);
      expect(result.scene.layers.map((layer) => layer.geom)).toEqual(['area', 'line']);
      expect(result.scene.scales.x?.spec.scaleType).toBe('datetime');
      expect(new Set(result.scene.layers[0]?.data.getValues('kind'))).toEqual(new Set(COST_KINDS));
    });
  }

  it('compiles the bars view with an edge layer per kind', () => {
    const result = createCompiler().compile({
      spec: costByKindBarsInput(COST_KINDS),
      data: seriesData('stacked', costByKindData(ROWS), {
        bucket: (row) => row.day,
        series: (row) => row.kind,
        value: (row) => row.cost,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.warnings).toEqual([]);
    expect(result.scene.layers).toHaveLength(1 + COST_KINDS.length);
  });

  it('offers bars only where a bucket leaves room for them', () => {
    expect(costKindViewsFor('day')).toContain('bars');
    expect(costKindViewsFor('hour')).not.toContain('bars');
  });

  it('shapes data with the declared columns', () => {
    expect(costByKindData(ROWS)).toEqual({
      columns: [{ key: 'day' }, { key: 'kind' }, { key: 'cost' }],
      rows: ROWS,
    });
  });
});
