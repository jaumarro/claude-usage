import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import {
  DEFAULT_WEEKLY_RESET,
  nextWeeklyReset,
  quotaOverTimeData,
  quotaOverTimeInput,
  quotaOverTimeInputWithResets,
  weeklyResets,
  type QuotaOverTimeRow,
} from '@/lib/charts/quotaOverTime';

const ROWS: QuotaOverTimeRow[] = [
  { t: '2026-09-01T00:00:00.000Z', window: 'five_hour', pct: 20 },
  { t: '2026-09-01T06:00:00.000Z', window: 'five_hour', pct: 97 },
  { t: '2026-09-02T00:00:00.000Z', window: 'five_hour', pct: 12 },
  { t: '2026-09-01T00:00:00.000Z', window: 'seven_day', pct: 40 },
  { t: '2026-09-01T06:00:00.000Z', window: 'seven_day', pct: 55 },
  { t: '2026-09-02T00:00:00.000Z', window: 'seven_day', pct: 62 },
];

const RESETS = [Date.parse('2026-09-01T10:00:00.000Z'), Date.parse('2026-09-01T15:00:00.000Z')];

function compile(spec: ReturnType<typeof quotaOverTimeInputWithResets>) {
  return createCompiler().compile({ spec, data: quotaOverTimeData(ROWS) });
}

describe('quotaOverTime spec', () => {
  it('compiles one overlapping area per window', () => {
    const result = compile(quotaOverTimeInput);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.warnings).toEqual([]);
    // No threshold rule: the y axis is pinned to 0-100, so the ceiling is the axis.
    expect(result.scene.layers).toHaveLength(1);
    expect(result.scene.layers[0].geom).toBe('area');
    expect(result.scene.layers[0].position).toBe('identity');
    expect(result.scene.layers[0].mapping).toMatchObject({ x: 't', y: 'pct', color: 'window' });
    expect(result.scene.scales.y?.domain).toEqual([0, 100]);
  });

  it('adds one vertical rule per reset boundary', () => {
    const result = compile(quotaOverTimeInputWithResets(RESETS));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.warnings).toEqual([]);
    expect(result.scene.layers).toHaveLength(3);
    expect(result.scene.layers.map((layer) => layer.geom)).toEqual(['area', 'rule', 'rule']);
  });

  it('orients the reset markers on x', () => {
    const result = compile(quotaOverTimeInputWithResets(RESETS));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const markers = result.scene.layers.slice(1);
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      expect(marker.mapping.x).toBeDefined();
      expect(marker.mapping.y).toBeUndefined();
    }
  });

  it('compiles with no reset boundaries at all', () => {
    const result = compile(quotaOverTimeInputWithResets([]));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.layers).toHaveLength(1);
  });

  it('shapes data with the declared columns', () => {
    expect(quotaOverTimeData(ROWS)).toEqual({
      columns: [{ key: 't' }, { key: 'window' }, { key: 'pct' }],
      rows: ROWS,
    });
  });
});

describe('weeklyResets', () => {
  it('lists every reset a whole number of weeks from the observed one, Tuesdays at 01:00', () => {
    const resets = weeklyResets(
      new Date(2026, 8, 1, 12).getTime(),
      new Date(2026, 9, 1, 15).getTime(),
      DEFAULT_WEEKLY_RESET,
    );

    expect(resets).toEqual([
      new Date(2026, 8, 8, 1).getTime(),
      new Date(2026, 8, 15, 1).getTime(),
      new Date(2026, 8, 22, 1).getTime(),
      new Date(2026, 8, 29, 1).getTime(),
    ]);
  });

  it('includes a reset that falls on the span opening itself', () => {
    const tuesday = new Date(2026, 8, 1, 1).getTime();

    expect(weeklyResets(tuesday, tuesday, DEFAULT_WEEKLY_RESET)).toEqual([tuesday]);
  });

  it('keeps the time of day across a change of clocks', () => {
    const resets = weeklyResets(
      new Date(2026, 9, 20).getTime(),
      new Date(2026, 10, 5).getTime(),
      DEFAULT_WEEKLY_RESET,
    );

    expect(resets.map((at) => new Date(at).getHours())).toEqual([1, 1, 1]);
  });

  it('follows a reset moved to another day and time', () => {
    const fridayEvening = { weekday: 5, hour: 18, minute: 30 };
    const resets = weeklyResets(new Date(2026, 8, 1).getTime(), new Date(2026, 8, 15).getTime(), fridayEvening);

    expect(resets).toEqual([new Date(2026, 8, 4, 18, 30).getTime(), new Date(2026, 8, 11, 18, 30).getTime()]);
  });
});

describe('nextWeeklyReset', () => {
  it('finds the first reset at or after a moment', () => {
    const thursday = new Date(2026, 9, 1, 15).getTime();

    expect(nextWeeklyReset(thursday, DEFAULT_WEEKLY_RESET)).toBe(new Date(2026, 9, 6, 1).getTime());
  });

  it('counts the moment of a reset as that reset', () => {
    const tuesday = new Date(2026, 9, 6, 1).getTime();

    expect(nextWeeklyReset(tuesday, DEFAULT_WEEKLY_RESET)).toBe(tuesday);
  });

  it('waits a week when the reset day has come but its hour has passed', () => {
    const tuesdayNoon = new Date(2026, 9, 6, 12).getTime();

    expect(nextWeeklyReset(tuesdayNoon, DEFAULT_WEEKLY_RESET)).toBe(new Date(2026, 9, 13, 1).getTime());
  });
});
