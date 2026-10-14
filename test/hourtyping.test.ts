import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import {
  HOURS,
  activityHeatmapData,
  activityHeatmapInputFor,
} from '@/lib/charts/activityHeatmap';

/**
 * Guards the failure that produced a heatmap with every cell out of its band and every
 * axis label a dash: a bare `'09'` makes the engine infer the column as numeric from its
 * first cell, and a discrete scale with a string domain then matches nothing.
 */
describe('hour column typing', () => {
  it('keeps every hour label non-numeric', () => {
    for (const hour of HOURS) {
      expect(Number.isNaN(Number(hour))).toBe(true);
    }
  });

  it('resolves the hour column as categorical, so bands match their cells', () => {
    const rows = HOURS.map((hour) => ({ day: 'Fri', hour, tokens: 1 }));
    const result = createCompiler().compile({
      spec: activityHeatmapInputFor(rows),
      data: activityHeatmapData(rows),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const meta = (result.scene.layers[0]?.data as unknown as {
      variableMetadata?: Record<string, { type?: string }>;
    })?.variableMetadata;

    expect(meta?.hour?.type).toBe('categorical');
    expect(result.scene.scales.x?.domain).toEqual(HOURS);
  });
});

describe('sub-hour granularity', () => {
  it('bands ten-minute columns rather than emptying the domain', () => {
    const rows = [
      { day: 'Fri', hour: '09:40', tokens: 3 },
      { day: 'Fri', hour: '09:50', tokens: 7 },
      { day: 'Fri', hour: '10:00', tokens: 1 },
    ];
    const result = createCompiler().compile({
      spec: activityHeatmapInputFor(rows),
      data: activityHeatmapData(rows),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.scales.x?.domain).toEqual(['09:40', '09:50', '10:00']);
    expect(result.scene.scales.y?.domain).toEqual(['Fri']);
  });
});
