import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import {
  OTHER,
  donutData,
  donutInput,
  donutSlices,
  seriesOrderOf,
  shareColorOverrides,
  totalsBy,
} from '@/lib/charts/categoryShare';
import { PALETTE_ID, SERIES_IDS, chartTheme } from '@/lib/charts/theme';

const NAMED = SERIES_IDS.length - 1;

/** One category more than the palette has hues, the last two small enough to fold. */
function tooManyTotals() {
  return [
    ...Array.from({ length: NAMED }, (_unused, index) => ({ category: `big${index}`, value: 100 - index * 5 })),
    { category: 'small1', value: 10 },
    { category: 'small2', value: 5 },
  ];
}

describe('totalsBy and seriesOrderOf', () => {
  const rows = [
    { day: '2026-09-01', model: 'opus', tokens: 5 },
    { day: '2026-09-01', model: 'fable', tokens: 1 },
    { day: '2026-09-02', model: 'opus', tokens: 7 },
  ];

  it('sums each category over the whole period', () => {
    expect(totalsBy(rows, (row) => row.model, (row) => row.tokens)).toEqual([
      { category: 'opus', value: 12 },
      { category: 'fable', value: 1 },
    ]);
  });

  it('lists categories in the order the series views meet them', () => {
    expect(seriesOrderOf(rows, (row) => row.model)).toEqual(['opus', 'fable']);
  });
});

describe('shareColorOverrides', () => {
  it('gives each category the hue it has in the series views', () => {
    expect(shareColorOverrides(['opus', 'fable'], ['fable', 'opus'], '#777777')).toEqual({
      1: { id: SERIES_IDS[1] },
      2: { id: SERIES_IDS[0] },
    });
  });

  it('paints a fold the series never drew with the neutral it is given', () => {
    const totals = tooManyTotals();
    const categories = donutSlices(totals).map((slice) => slice.category);

    const overrides = shareColorOverrides(categories, totals.map((total) => total.category), '#777777');
    expect(overrides[NAMED + 1]).toEqual({ hex: '#777777' });
  });
});

describe('donutSlices', () => {
  it('puts every category on one ring, largest first, and drops the empty ones', () => {
    expect(
      donutSlices([
        { category: 'fable', value: 30 },
        { category: 'idle', value: 0 },
        { category: 'opus', value: 70 },
      ]),
    ).toEqual([
      { ring: 'total', category: 'opus', value: 70, end: 0.7 },
      { ring: 'total', category: 'fable', value: 30, end: 1 },
    ]);
  });

  it('folds the smallest into other once there are more categories than hues', () => {
    const totals = tooManyTotals();

    expect(donutSlices(totals).map((slice) => slice.category)).toEqual([
      ...totals.slice(0, NAMED).map((total) => total.category),
      OTHER,
    ]);
  });
});

describe('donutInput', () => {
  const slices = donutSlices([
    { category: 'opus', value: 60 },
    { category: 'fable', value: 30 },
    { category: 'haiku', value: 10 },
  ]);
  const compile = () =>
    createCompiler().compile({
      spec: donutInput(slices, ['fable', 'opus'], '#777777'),
      data: donutData(slices),
      customPalettes: chartTheme('dark').palettes,
    });

  it('compiles one ring of bars, then an edge per slice, on a polar coord with a hole', () => {
    const result = compile();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.warnings).toEqual([]);
    expect(result.scene.layers.map((layer) => `${layer.geom}/${layer.position}`)).toEqual([
      'bar/fill',
      'bar/identity',
      'bar/identity',
      'bar/identity',
    ]);
    expect(result.scene.coordSystem.type).toBe('polar');
  });

  it('sweeps the slices end to end round one full turn', () => {
    const result = compile();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const data = result.scene.layers[0]?.data;
    const ends = data?.getValues(data.getVariableNames().find((name) => name.endsWith('_xMax')) ?? '');
    expect(ends?.at(-1)).toBeCloseTo(2 * Math.PI);
  });

  it('paints each slice in its series hue and a category the series lack in the neutral', () => {
    const result = compile();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const data = result.scene.layers[0]?.data;
    const colors = data?.getValues(data.getVariableNames().find((name) => name.endsWith('_color')) ?? '');
    const hues = chartTheme('dark').palettes?.[PALETTE_ID] ?? [];
    expect(colors).toEqual([hues[1]?.hex, hues[0]?.hex, '#777777']);
  });
});
