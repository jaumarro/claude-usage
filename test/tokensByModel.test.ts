import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import {
  tokensByModelData,
  tokensByModelInput,
  tokensByModelInputWithMarkers,
} from '@/lib/charts/tokensByModel';
import { TIME_VIEWS, seriesData, type TimeView } from '@/lib/charts/seriesViews';

const ROWS = [
  { day: '2026-09-01', model: 'claude-opus-5', tokens: 100 },
  { day: '2026-09-02', model: 'claude-opus-5', tokens: 140 },
  { day: '2026-09-01', model: 'claude-fable-5-1', tokens: 60 },
];

function dataFor(view: TimeView) {
  return seriesData(view, tokensByModelData(ROWS), {
    bucket: (row) => row.day,
    series: (row) => row.model,
    value: (row) => row.tokens,
  });
}

describe('tokensByModel spec', () => {
  it('compiles a stacked area layer with its edges', () => {
    const result = createCompiler().compile({
      spec: tokensByModelInput,
      data: dataFor('stacked'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.layers.map((layer) => layer.geom)).toEqual(['area', 'line']);
    expect(result.scene.layers[0].position).toBe('stack');
  });

  it('draws each series view as its own geom and position', () => {
    const expected: Record<TimeView, { geom: string; position: string }> = {
      stacked: { geom: 'area', position: 'stack' },
      share: { geom: 'area', position: 'fill' },
    };

    for (const view of TIME_VIEWS) {
      const result = createCompiler().compile({
        spec: tokensByModelInputWithMarkers([], view),
        data: dataFor(view),
      });

      expect(result.ok, view).toBe(true);
      if (!result.ok) {
        continue;
      }
      expect(result.warnings, view).toEqual([]);
      expect(result.scene.layers[0].geom, view).toBe(expected[view].geom);
      expect(result.scene.layers[0].position, view).toBe(expected[view].position);
    }
  });
});
