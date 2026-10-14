import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import { sessionsData, sessionsInputFor, type SessionBlock } from '@/lib/charts/sessionsInParallel';
import { seriesHues } from '@/lib/charts/theme';

type Shape = Partial<SessionBlock> & { session: string; hour: number };

function block({ session, hour, ...rest }: Shape): SessionBlock {
  return {
    from: new Date(2026, 8, 3, hour).getTime(),
    to: new Date(2026, 8, 3, hour + 1).getTime(),
    session,
    project: session,
    branch: null,
    spent: 1,
    ...rest,
  };
}

const BLOCKS = [
  block({ session: 's1', hour: 10, spent: 3_000_000 }),
  block({ session: 's1', hour: 11, spent: 1_000_000 }),
  block({ session: 's2', hour: 10, spent: 1_000_000 }),
];

function compile(blocks: SessionBlock[] = BLOCKS) {
  const data = sessionsData(blocks);
  return createCompiler().compile({ spec: sessionsInputFor(data.rows, 'dark'), data });
}

/** The hue each session's segments are painted in, by label. */
function huesOf(blocks: SessionBlock[]): Map<string, string> {
  const result = compile(blocks);
  if (!result.ok) {
    return new Map();
  }
  const layer = result.scene.layers[0]?.data;
  const colors = layer?.getValues(layer.getVariableNames().find((name) => name.endsWith('_color')) ?? '') ?? [];
  return new Map(layer?.getValues('session').map((session, index) => [String(session), String(colors[index])]));
}

describe('sessionsData', () => {
  it('draws a segment inset from its bucket edges, so the bars stand apart', () => {
    const rows = sessionsData([block({ session: 's1', hour: 10 })]).rows;

    expect(rows.map((row) => row.t)).toEqual(['2026-09-03T10:06:00.000Z', '2026-09-03T10:54:00.000Z']);
    expect(rows.map((row) => row.mid)).toEqual(['2026-09-03T10:30:00.000Z', '2026-09-03T10:30:00.000Z']);
  });

  it('gives every segment a group of its own, so no area joins two bars', () => {
    expect(sessionsData(BLOCKS).rows.map((row) => row.bar)).toEqual(['0', '0', '1', '1', '2', '2']);
  });

  it('names a session by its branch and folder, or the folder alone when no branch was checked out', () => {
    const labels = sessionsData([
      block({ session: 's1', hour: 10, project: 'alpha', branch: 'feat/edit' }),
      block({ session: 's2', hour: 10, project: 'alpha' }),
      block({ session: 's3', hour: 10, project: 'alpha', branch: 'feat/edit' }),
    ]).rows.map((row) => row.session);

    expect([...new Set(labels)]).toEqual(['feat/edit · alpha', 'alpha', 'feat/edit · alpha #2']);
  });
});

describe('sessionsInParallel spec', () => {
  it('stacks the tokens each session spent in a bucket on the datetime axis', () => {
    const result = compile();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.warnings).toEqual([]);
    expect(result.scene.layers.map((layer) => `${layer.geom}/${layer.position}`)).toEqual([
      'area/stack',
      'point/identity',
    ]);
    expect(result.scene.scales.x?.spec.scaleType).toBe('datetime');
    expect(result.scene.scales.y?.domain).toEqual([0, 4_000_000]);
  });

  it('labels each bar with the sum of its segments, once per bar', () => {
    const result = compile();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const totals = result.scene.layers[1];
    expect(totals?.interactive).toBe(false);
    expect(totals?.data.getValues('total')).toEqual([4_000_000, 1_000_000]);
  });

  it('hands the hues out in turn, so every one gets used', () => {
    const hues = seriesHues('dark');
    const apart = hues.map((_, index) => block({ session: `s${index}`, hour: index }));

    expect([...huesOf(apart).values()]).toEqual(hues);
  });

  it('never paints two sessions stacked against each other in the same hue', () => {
    // s0 opens alone, so taking turns alone would give s8 the hue s0 wears, right beneath it.
    const stacked = [
      block({ session: 's0', hour: 1 }),
      ...Array.from({ length: 7 }, (_, index) => block({ session: `s${index + 1}`, hour: index + 2 })),
      block({ session: 's0', hour: 20 }),
      block({ session: 's8', hour: 20 }),
    ];
    const hues = huesOf(stacked);

    expect(hues.get('s8')).not.toBe(hues.get('s0'));
  });
});
