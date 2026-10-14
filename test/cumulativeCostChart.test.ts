import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import {
  cumulativeCostData,
  cumulativeCostInput,
  cumulativeCostInputWithSubscription,
  type CumulativeCostRow,
} from '@/lib/charts/cumulativeCost';

const ROWS: CumulativeCostRow[] = [
  { day: '2026-09-01', cost: 40 },
  { day: '2026-09-02', cost: 120 },
  { day: '2026-09-03', cost: 260 },
];

const CROSSED = {
  thresholdUsd: 200,
  crossingAt: Date.parse('2026-09-03'),
  crossingDay: '2026-09-03',
};

const NOT_CROSSED = { thresholdUsd: 5000, crossingAt: null, crossingDay: null };

function compile(spec: ReturnType<typeof cumulativeCostInputWithSubscription>) {
  return createCompiler().compile({ spec, data: cumulativeCostData(ROWS) });
}

describe('cumulativeCost spec', () => {
  it('compiles a single area over a datetime axis', () => {
    const result = createCompiler().compile({
      spec: cumulativeCostInput,
      data: cumulativeCostData(ROWS),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.warnings).toEqual([]);
    expect(result.scene.layers).toHaveLength(1);
    expect(result.scene.layers[0].geom).toBe('area');
    expect(result.scene.layers[0].position).toBe('identity');
    expect(result.scene.layers[0].mapping).toMatchObject({ x: 'day', y: 'cost' });
    expect(result.scene.scales.x?.spec.scaleType).toBe('datetime');
  });

  it('adds the subscription line as a horizontal rule', () => {
    const result = compile(cumulativeCostInputWithSubscription(NOT_CROSSED));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.warnings).toEqual([]);
    expect(result.scene.layers.map((layer) => layer.geom)).toEqual(['area', 'rule']);
    expect(result.scene.layers[1].mapping.y).toBeDefined();
    expect(result.scene.layers[1].mapping.x).toBeUndefined();
  });

  it('marks the crossing with a vertical rule when the curve reaches the line', () => {
    const result = compile(cumulativeCostInputWithSubscription(CROSSED));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Annotations fail soft: a dropped anchor is a warning, not an error, so an empty
    // warning list is the only proof the label actually resolved.
    expect(result.warnings).toEqual([]);
    expect(result.scene.layers.map((layer) => layer.geom)).toEqual(['area', 'rule', 'rule']);
    expect(result.scene.layers[2].mapping.x).toBeDefined();
    expect(result.scene.layers[2].mapping.y).toBeUndefined();
  });

  it('labels the crossing without the rule pill that renders a dangling value', () => {
    const result = compile(cumulativeCostInputWithSubscription(CROSSED));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const vertical = result.scene.layers[2];
    expect((vertical.params as Record<string, unknown>).label).toBeUndefined();
    // The horizontal rule reads its value off the y axis, so its pill is meaningful.
    expect((result.scene.layers[1].params as Record<string, unknown>).label).toBe(
      'subscription',
    );
  });

  it('shapes data with the declared columns', () => {
    expect(cumulativeCostData(ROWS)).toEqual({
      columns: [
        { key: 'day', label: 'Bucket' },
        { key: 'cost', label: 'API equivalent' },
      ],
      rows: ROWS,
    });
  });
});
