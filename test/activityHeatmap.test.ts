import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import {
  ACTIVITY_RAMP,
  ACTIVITY_RAMP_LIGHT,
  HOURS,
  WEEKDAYS,
  activityHeatmapData,
  activityHeatmapInput,
  activityBubblesInputFor,
  activityHeatmapInputFor,
  type ActivityHeatmapRow,
} from '@/lib/charts/activityHeatmap';

const ROWS: ActivityHeatmapRow[] = WEEKDAYS.flatMap((day, dayIndex) =>
  HOURS.map((hour, hourIndex) => ({ day, hour, tokens: dayIndex * 100 + hourIndex })),
);

function compile() {
  return createCompiler().compile({
    spec: activityHeatmapInput,
    data: activityHeatmapData(ROWS),
  });
}

describe('activityHeatmap spec', () => {
  it('compiles a single tile layer over the 168 cells of the week', () => {
    const result = compile();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.layers).toHaveLength(1);
    expect(result.scene.layers[0].geom).toBe('tile');
    expect(result.scene.layers[0].position).toBe('identity');
    expect(ROWS).toHaveLength(168);
  });

  it('exposes the columns the mapping references', () => {
    expect(activityHeatmapData(ROWS).columns).toEqual([
      { key: 'day' },
      { key: 'hour' },
      { key: 'tokens' },
    ]);
  });

  it('puts Monday at the top of the y axis and keeps every weekday banded', () => {
    const result = compile();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.scales.y?.spec).toMatchObject({
      scaleType: 'discrete',
      domain: [...WEEKDAYS],
      reverse: true,
    });
  });

  it('bands the x axis into the 24 hours of the day', () => {
    const result = compile();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.scales.x?.spec.scaleType).toBe('discrete');
    expect(result.scene.scales.x?.domain).toHaveLength(24);
  });

  it('encodes tokens on one sequential ramp rather than a categorical palette', () => {
    const result = compile();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.scales.color?.spec).toMatchObject({
      scaleType: 'continuous',
      transform: 'sqrt',
      range: [...ACTIVITY_RAMP],
    });
  });

  it('runs the light ramp from light to dark, so a quiet cell sits close to a light plate', () => {
    const result = createCompiler().compile({
      spec: activityHeatmapInputFor(ROWS, 'light'),
      data: activityHeatmapData(ROWS),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.scales.color?.spec).toMatchObject({
      scaleType: 'continuous',
      transform: 'sqrt',
      range: [...ACTIVITY_RAMP_LIGHT],
    });
  });
});

describe('activityHeatmapInputFor', () => {
  it('bands only the weekdays and hours the rows carry', () => {
    const rows = [
      { day: 'Fri', hour: '09:00', tokens: 10 },
      { day: 'Fri', hour: '10:00', tokens: 4 },
    ];
    const result = createCompiler().compile({
      spec: activityHeatmapInputFor(rows),
      data: activityHeatmapData(rows),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // A pinned full-week domain would put five empty bands back on the axis the query
    // deliberately dropped.
    expect(result.scene.scales.y?.domain).toEqual(['Fri']);
    expect(result.scene.scales.x?.domain).toEqual(['09:00', '10:00']);
  });
});

describe('activityBubblesInputFor', () => {
  it('sizes one dot per cell by tokens, on the same bands as the heatmap', () => {
    const result = createCompiler().compile({
      spec: activityBubblesInputFor(ROWS),
      data: activityHeatmapData(ROWS),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.warnings).toEqual([]);
    expect(result.scene.layers[0]?.geom).toBe('point');
    expect(result.scene.scales.size?.spec.scaleType).toBe('continuous');
    expect(result.scene.scales.y?.domain).toHaveLength(WEEKDAYS.length);
  });
});
