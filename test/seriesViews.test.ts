import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import {
  BARS_LAYER,
  TIME_VIEWS,
  barEdgeLayer,
  barsFit,
  barsInput,
  seriesData,
  type TimeView,
} from '@/lib/charts/seriesViews';
import { BUCKETS } from '@/lib/queries/aggregate';
import { costByModelData, costByModelInputFor } from '@/lib/charts/costByModel';
import { tokensByEffortData, tokensByEffortInputFor } from '@/lib/charts/tokensByEffort';
import { quotaOverTimeData, quotaOverTimeInputWithResets } from '@/lib/charts/quotaOverTime';
import {
  tokensByModelData,
  tokensByModelInputWithMarkers,
  type TokensByModelRow,
} from '@/lib/charts/tokensByModel';

const EXPECTED: Record<TimeView, { geoms: string[]; position: string }> = {
  stacked: { geoms: ['area', 'line'], position: 'stack' },
  share: { geoms: ['area', 'line'], position: 'fill' },
};

const CHARTS = [
  {
    name: 'cost',
    compile: (view: TimeView) =>
      createCompiler().compile({
        spec: costByModelInputFor(view),
        data: seriesData(
          view,
          costByModelData([
            { day: '2026-09-01', model: 'claude-opus-5', cost: 12.5 },
            { day: '2026-09-02', model: 'claude-opus-5', cost: 18.25 },
            { day: '2026-09-01', model: 'claude-fable-5-1', cost: 4.75 },
            { day: '2026-09-02', model: 'claude-fable-5-1', cost: 0 },
          ]),
          { bucket: (row) => row.day, series: (row) => row.model, value: (row) => row.cost },
        ),
      }),
  },
  {
    name: 'effort',
    compile: (view: TimeView) =>
      createCompiler().compile({
        spec: tokensByEffortInputFor(view),
        data: seriesData(
          view,
          tokensByEffortData([
            { day: '2026-09-01', effort: 'high', tokens: 100 },
            { day: '2026-09-02', effort: 'high', tokens: 140 },
            { day: '2026-09-01', effort: 'max', tokens: 60 },
            { day: '2026-09-02', effort: 'max', tokens: 0 },
          ]),
          { bucket: (row) => row.day, series: (row) => row.effort, value: (row) => row.tokens },
        ),
      }),
  },
];

describe('series views', () => {
  for (const chart of CHARTS) {
    for (const view of TIME_VIEWS) {
      it(`draws ${chart.name} as ${view}`, () => {
        const result = chart.compile(view);

        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        expect(result.warnings).toEqual([]);
        expect(result.scene.layers.map((layer) => layer.geom)).toEqual(EXPECTED[view].geoms);
        expect(result.scene.layers[0]?.position).toBe(EXPECTED[view].position);
        expect(result.scene.scales.x?.spec.scaleType).toBe('datetime');
      });
    }
  }
});

const MODEL_OF = {
  bucket: (row: TokensByModelRow) => row.day,
  series: (row: TokensByModelRow) => row.model,
  value: (row: TokensByModelRow) => row.tokens,
};

describe('spanScale', () => {
  const span = { start: Date.parse('2026-09-01T00:00:00Z'), end: Date.parse('2026-10-01T15:00:00Z') };

  it('pins a series chart and the quota chart to the same span', () => {
    const series = createCompiler().compile({
      spec: costByModelInputFor('stacked', span),
      data: seriesData('stacked', costByModelData([{ day: '2026-09-10', model: 'opus', cost: 1 }]), {
        bucket: (row) => row.day,
        series: (row) => row.model,
        value: (row) => row.cost,
      }),
    });
    const quota = createCompiler().compile({
      spec: quotaOverTimeInputWithResets([], span),
      data: quotaOverTimeData([{ t: '2026-09-10T12:00:00.000Z', window: 'seven_day', pct: 40 }]),
    });

    expect(series.ok && quota.ok).toBe(true);
    if (!series.ok || !quota.ok) {
      return;
    }
    expect(series.scene.scales.x?.spec).toMatchObject({ domainMin: span.start, domainMax: span.end });
    expect(quota.scene.scales.x?.spec).toMatchObject({ domainMin: span.start, domainMax: span.end });
  });
});

describe('barsInput', () => {
  const rows = [
    { day: '2026-09-04', model: 'opus', tokens: 10 },
    { day: '2026-09-04', model: 'fable', tokens: 5 },
    { day: '2026-09-05', model: 'opus', tokens: 4 },
    { day: '2026-09-05', model: 'fable', tokens: 2 },
  ];
  const compile = () =>
    createCompiler().compile({
      spec: barsInput({ x: 'day', y: 'tokens', color: 'model' }, ['opus', 'fable']),
      data: seriesData('stacked', tokensByModelData(rows), MODEL_OF),
    });

  it('stacks the bars on a band axis under one edge layer per series, the top series first', () => {
    const result = compile();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.warnings).toEqual([]);
    expect(result.scene.scales.x?.spec.scaleType).toBe('discrete');
    expect(result.scene.layers.map((layer) => `${layer.id} ${layer.geom}/${layer.position}`)).toEqual([
      `${BARS_LAYER} bar/stack`,
      `${barEdgeLayer('fable')} bar/identity`,
      `${barEdgeLayer('opus')} bar/identity`,
    ]);
  });

  it('runs each edge layer from the baseline to the top of its own segments', () => {
    const result = compile();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const fable = result.scene.layers[1];
    expect(fable?.interactive).toBe(false);
    expect(fable?.mapping.y).toBe('top');
    expect(fable?.data.getValues('model')).toEqual(['fable', 'fable']);
    expect(fable?.data.getValues('top')).toEqual([15, 6]);
  });

  it('fits bars at day and week buckets only', () => {
    expect(BUCKETS.filter(barsFit)).toEqual(['day', 'week']);
  });
});

describe('seriesData', () => {
  const rows = [
    { day: '2026-09-04', model: 'opus', tokens: 10 },
    { day: '2026-09-04', model: 'fable', tokens: 5 },
    { day: '2026-09-05', model: 'opus', tokens: 0 },
    { day: '2026-09-05', model: 'fable', tokens: 0 },
    { day: '2026-09-07', model: 'opus', tokens: 3 },
    { day: '2026-09-07', model: 'fable', tokens: 0 },
  ];
  const daysIn = (view: TimeView) => [
    ...new Set(seriesData(view, tokensByModelData(rows), MODEL_OF).rows.map((row) => row.day)),
  ];

  it('leaves an idle bucket out of the share view, so it draws no empty band', () => {
    expect(daysIn('share')).toEqual(['2026-09-04', '2026-09-07']);
  });

  it('keeps the idle bucket as zeros in the stacked view', () => {
    expect(daysIn('stacked')).toEqual(['2026-09-04', '2026-09-05', '2026-09-07']);
  });
});

describe('band edges', () => {
  const rows = [
    { day: '2026-09-04', model: 'opus', tokens: 10 },
    { day: '2026-09-04', model: 'fable', tokens: 5 },
    { day: '2026-09-05', model: 'fable', tokens: 2 },
    { day: '2026-09-05', model: 'opus', tokens: 4 },
  ];
  const edgesIn = (view: TimeView) =>
    seriesData(view, tokensByModelData(rows), MODEL_OF).rows.map((row) => ({
      day: row.day,
      model: row.model,
      top: 'top' in row ? row.top : null,
      rank: 'rank' in row ? row.rank : null,
    }));

  it('tops each band at its own value on every band beneath it', () => {
    expect(edgesIn('stacked')).toEqual([
      { day: '2026-09-04', model: 'opus', top: 10, rank: 0 },
      { day: '2026-09-04', model: 'fable', top: 15, rank: 1 },
      { day: '2026-09-05', model: 'fable', top: 6, rank: 1 },
      { day: '2026-09-05', model: 'opus', top: 4, rank: 0 },
    ]);
  });

  it('tops each band at its running share of the bucket in the 100% view', () => {
    expect(edgesIn('share').map((edge) => edge.top)).toEqual([10 / 15, 1, 1, 4 / 6]);
  });

  it('draws the edges from the top band down, so the band beneath paints last', () => {
    const result = createCompiler().compile({
      spec: tokensByModelInputWithMarkers([], 'stacked'),
      data: seriesData('stacked', tokensByModelData(rows), MODEL_OF),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const edges = result.scene.layers[1];
    expect(edges?.interactive).toBe(false);
    // The renderer draws one line per series in the order the layer's rows first meet them.
    expect([...new Set(edges?.data.getValues('model'))]).toEqual(['fable', 'opus']);
  });
});
