import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import { tokensByModelData, tokensByModelInputWithMarkers } from '@/lib/charts/tokensByModel';
import { TIME_VIEWS, seriesData, type TimeView } from '@/lib/charts/seriesViews';
import type { ModelMarker } from '@/lib/queries/timeseries';

const ROWS = [
  { day: '2026-09-01', model: 'claude-opus-5', tokens: 100 },
  { day: '2026-09-02', model: 'claude-opus-5', tokens: 140 },
];

const MARKERS: ModelMarker[] = [
  {
    model: 'claude-opus-5',
    at: Date.parse('2026-09-01T00:00:00.000Z'),
    bucket: '2026-09-01',
    kind: 'release' as const,
  },
  {
    model: 'claude-fable-5-1',
    at: Date.parse('2026-09-02T00:00:00.000Z'),
    bucket: '2026-09-02',
    kind: 'release' as const,
  },
];

function dataFor(view: TimeView) {
  return seriesData(view, tokensByModelData(ROWS), {
    bucket: (row) => row.day,
    series: (row) => row.model,
    value: (row) => row.tokens,
  });
}

function compile(markers: ModelMarker[]) {
  return createCompiler().compile({
    spec: tokensByModelInputWithMarkers(markers),
    data: dataFor('stacked'),
  });
}

describe('tokensByModel markers', () => {
  it('adds one rule layer per marker', () => {
    const result = compile(MARKERS);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.layers.map((layer) => layer.geom)).toEqual(['area', 'line', 'rule', 'rule']);
    // Annotations and mappings fail soft, so an empty warning list is the only proof the
    // markers actually resolved rather than being silently dropped.
    expect(result.warnings).toEqual([]);
  });

  it('names each marker after its model alone, beside the rule rather than on it', () => {
    const result = compile(MARKERS);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.annotations.textAnnotations.map((text) => JSON.stringify(text.content))).toEqual([
      expect.stringContaining('"text":"opus 5"'),
      expect.stringContaining('"text":"fable 5.1"'),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('marks a date taken from the corpus rather than a published release', () => {
    const result = compile([{ ...MARKERS[0], kind: 'first-use' as const }]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(JSON.stringify(result.scene.annotations.textAnnotations[0]?.content)).toContain(
      '"text":"opus 5 (first use)"',
    );
  });

  it('keeps the markers on every time view', () => {
    const ruleCount = (view: TimeView): number => {
      const result = createCompiler().compile({
        spec: tokensByModelInputWithMarkers(MARKERS, view),
        data: dataFor(view),
      });
      return result.ok ? result.scene.layers.filter((layer) => layer.geom === 'rule').length : -1;
    };

    expect(TIME_VIEWS.map(ruleCount)).toEqual([2, 2]);
  });

  it('compiles to a bare area chart when there are no markers', () => {
    const result = compile([]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.layers.map((layer) => layer.geom)).toEqual(['area', 'line']);
  });
});
