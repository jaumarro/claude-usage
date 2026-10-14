import { createSpec, pipe, mapping, geom, scale, transform } from '@graphysdk/react';
import type { ColorScheme } from '@/lib/charts/theme';

export type ActivityHeatmapRow = {
  day: string;
  hour: string;
  tokens: number;
};

/** Monday first, so the working week reads as one block and the weekend closes it. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Minutes per column at each granularity the grid supports. */
export const SLOT_MINUTES = { minute: 1, '10m': 10, hour: 60 } as const;
export type SlotSize = keyof typeof SLOT_MINUTES;

/**
 * Time-of-day labels as `HH:MM`.
 *
 * The colon matters: a bare `'09'` parses as the number 9 and the engine infers the whole
 * column as numeric from its first cell, after which a discrete scale with a string domain
 * matches nothing, every cell falls out of its band, and every axis label renders as a
 * dash. `Data` exposes no type hint, so a non-numeric character is the only way to pin the
 * column as text.
 */
export function slotsOfDay(slot: SlotSize): string[] {
  const step = SLOT_MINUTES[slot];
  const count = (24 * 60) / step;
  return Array.from({ length: count }, (_, index) => {
    const minutes = index * step;
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  });
}

export const HOURS = slotsOfDay('hour');

/**
 * Tokens are a magnitude, so the encoding is one hue dark to light rather than the
 * categorical palette the other charts use: neighbouring cells have to say "more" and
 * "less", which seven unrelated hues cannot. Validated with the dataviz skill's
 * `validate_palette.js` in ordinal mode against the graph plate `#11151A`: monotone
 * lightness, every adjacent gap over the 0.06 floor, a 10 degree hue spread, and a darkest
 * step at 2.12:1 so a zero-token cell still reads as a cell rather than as a hole. Re-run
 * the validator before changing a value.
 */
export const ACTIVITY_RAMP = ['#22553a', '#2f7848', '#419c5a', '#5ec375', '#86e894'] as const;

/**
 * On a light plate the ramp runs the other way, light to dark, so a quiet cell still fades
 * towards the plate. Validated the same way against `#FCFCFB`: monotone, every gap over 0.06,
 * a 1 degree hue spread, and the lightest step at 2.13:1.
 */
export const ACTIVITY_RAMP_LIGHT = ['#78bf8a', '#55a76a', '#3a8b50', '#266e3c', '#16512a'] as const;

const RAMPS: Record<ColorScheme, readonly string[]> = {
  dark: ACTIVITY_RAMP,
  light: ACTIVITY_RAMP_LIGHT,
};

/**
 * The busiest cell is roughly 400 times the quietest one that saw any traffic, so a linear
 * ramp spends its whole range on a handful of cells and flattens the rest onto the floor.
 * A square root keeps zero at the bottom stop and gives the mid-range cells somewhere to
 * sit.
 */
const MAGNITUDE_TRANSFORM = 'sqrt';

export const activityHeatmapColumns = [{ key: 'day' }, { key: 'hour' }, { key: 'tokens' }];

export function activityHeatmapData(rows: ActivityHeatmapRow[]) {
  return { columns: activityHeatmapColumns, rows };
}

/**
 * The axes are built from the rows rather than from the full week and day.
 *
 * A pinned `domain: [...WEEKDAYS]` draws all seven bands whatever the data holds, so a
 * three-day range still showed an empty Sunday: the query had dropped the row but the axis
 * put the band back. Deriving both domains from the rows keeps the axis and the grid
 * telling the same story, while the WEEKDAYS and HOURS orders keep Monday first and the
 * hours ascending.
 */
function bandsFor(rows: ActivityHeatmapRow[]) {
  // Weekdays are filtered through WEEKDAYS to keep Monday first. Columns are taken from
  // the rows themselves: filtering them through a fixed hourly list would empty the domain
  // at any granularity finer than an hour, because a 10m column is `09:40` and no hourly
  // list contains it. `HH:MM` sorts lexicographically in clock order.
  const days = WEEKDAYS.filter((day) => rows.some((row) => row.day === day));
  const hours = [...new Set(rows.map((row) => row.hour))].sort();
  return { days, hours };
}

export function activityHeatmapInputFor(rows: ActivityHeatmapRow[], scheme: ColorScheme = 'dark') {
  const { days, hours } = bandsFor(rows);

  return pipe(
    createSpec(),
    // `tile` sizes its cells from the band, so there is no size aesthetic to carry.
    mapping({ x: 'hour', y: 'day', color: 'tokens' }),
    geom.tile(),
    scale.x.discrete({ domain: hours }),
    // `reverse` runs the band order downwards, putting Monday at the top of the plot.
    scale.y.discrete({ domain: days, reverse: true }),
    scale.color.continuous({ range: [...RAMPS[scheme]], transform: MAGNITUDE_TRANSFORM }),
  );
}

/**
 * The same grid as dots sized by tokens, the punch-card reading of when the work happens. Area
 * rather than diameter should carry the value, so the size scale takes the square root, and a
 * zero-token cell shrinks to nothing.
 */
export function activityBubblesInputFor(rows: ActivityHeatmapRow[]) {
  const { days, hours } = bandsFor(rows);

  return pipe(
    createSpec(),
    mapping({ x: 'hour', y: 'day', size: 'tokens' }),
    // An idle cell has no dot to label; left in, it would print a zero in every quiet hour.
    geom.point({
      dataLabels: { showDataLabels: true },
      transforms: [transform.filter({ variableName: 'tokens', operator: 'gt', value: 0 })],
    }),
    scale.x.discrete({ domain: hours }),
    scale.y.discrete({ domain: days, reverse: true }),
    scale.size.continuous({ range: [0, 22], transform: MAGNITUDE_TRANSFORM }),
  );
}

export const activityHeatmapInput = activityHeatmapInputFor(
  WEEKDAYS.flatMap((day) => HOURS.map((hour) => ({ day, hour, tokens: 0 }))),
);
