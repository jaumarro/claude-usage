import type { DatabaseSync } from 'node:sqlite';
import {
  SLOT_MINUTES,
  WEEKDAYS,
  slotsOfDay,
  type ActivityHeatmapRow,
  type SlotSize,
} from '@/lib/charts/activityHeatmap';
import { ALL_TIME_ALL_SURFACES, perRequest, type QueryFilters } from '@/lib/queries/aggregate';

/**
 * Both buckets resolve in local time, for the same reason every bucket in `aggregate.ts`
 * does: a UTC hour is not the hour the work happened in, and near midnight it is not even
 * the right weekday.
 */
const DAY_OF_WEEK = "CAST(strftime('%w', ts / 1000, 'unixepoch', 'localtime') AS INTEGER)";
/**
 * Time of day at the requested granularity, floored to the slot. Minutes are floored in
 * epoch space for the same reason the 10m bucket is: 600 divides every whole-hour UTC
 * offset evenly, so local slot edges land on the minute they should.
 */
function slotExpression(slot: SlotSize): string {
  const seconds = SLOT_MINUTES[slot] * 60;
  if (seconds === 60) {
    return "strftime('%H:%M', ts / 1000, 'unixepoch', 'localtime')";
  }
  return `strftime('%H:%M', (CAST(ts / 1000 / ${seconds} AS INTEGER)) * ${seconds}, 'unixepoch', 'localtime')`;
}

/** `ord` is the Monday-first reading order; `dow` is what `strftime('%w')` returns, Sunday as 0. */
function dayValues(days: readonly string[]): string {
  return days
    .map((day) => {
      const index = WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number]);
      return `(${index}, ${(index + 1) % 7}, '${day}')`;
    })
    .join(', ');
}

/**
 * The weekdays the window actually covers. A three-day range spans three weekdays, and
 * drawing the other four as empty rows says "you never work then" when the truth is that
 * those days are not in the window at all. Rows the range cannot speak to are dropped.
 */
export function weekdaysCovered(since: number | null, now: number = Date.now()): string[] {
  if (since === null || now - since >= 7 * 86_400_000) {
    return [...WEEKDAYS];
  }
  const covered = new Set<string>();
  for (let t = since; t <= now; t += 3_600_000) {
    const index = (new Date(t).getDay() + 6) % 7;
    covered.add(WEEKDAYS[index]);
  }
  covered.add(WEEKDAYS[(new Date(now).getDay() + 6) % 7]);
  return WEEKDAYS.filter((day) => covered.has(day));
}

function hourValues(hours: readonly string[]): string {
  return hours.map((hour) => `('${hour}')`).join(', ');
}

/**
 * The hours of the day the window actually covers, on the same reasoning as the weekdays:
 * at 10:25 the range `today` has nothing to say about 18:00, and an empty column there
 * reads as "you never work then". Any window of a day or more covers every hour.
 */
export function slotsCovered(
  slot: SlotSize,
  since: number | null,
  now: number = Date.now(),
): string[] {
  const all = slotsOfDay(slot);
  if (since === null || now - since >= 86_400_000) {
    return all;
  }
  const stepMs = SLOT_MINUTES[slot] * 60_000;
  const covered = new Set<string>();
  const label = (at: number): string => {
    const floored = new Date(Math.floor(at / stepMs) * stepMs);
    return `${String(floored.getHours()).padStart(2, '0')}:${String(floored.getMinutes()).padStart(2, '0')}`;
  };
  for (let t = since; t <= now; t += stepMs) {
    covered.add(label(t));
  }
  covered.add(label(now));
  return all.filter((value) => covered.has(value));
}

const TOKENS = 'SUM(input + output + cache_read + cache_create_5m + cache_create_1h)';

/**
 * Tokens per local weekday and local hour.
 *
 * The grid comes from generated day and hour lists rather than from the distinct values
 * the data happens to hold, so every covered cell exists: a quiet hour is a dark cell, not
 * a hole in the week. Weekdays and hours the range does not reach are omitted entirely,
 * since an empty cell should mean "idle", never "outside the window". `densifiedSeriesSql` cannot do this job, because its
 * grid is a run of dated buckets, not every weekday crossed with every hour.
 */
export function activityByHourOfWeek(
  db: DatabaseSync,
  filters: QueryFilters = ALL_TIME_ALL_SURFACES,
  slot: SlotSize = 'hour',
  now: number = Date.now(),
): ActivityHeatmapRow[] {
  return db
    .prepare(
      `${perRequest(filters)},
      days(ord, dow, day) AS (VALUES ${dayValues(weekdaysCovered(filters.since, now))}),
      hours(hour) AS (VALUES ${hourValues(slotsCovered(slot, filters.since, now))}),
      totals AS (
        SELECT ${DAY_OF_WEEK} AS dow, ${slotExpression(slot)} AS hour, ${TOKENS} AS tokens
        FROM per_request
        GROUP BY dow, hour
      )
      SELECT days.day AS day, hours.hour AS hour, COALESCE(totals.tokens, 0) AS tokens
      FROM days
      CROSS JOIN hours
      LEFT JOIN totals ON totals.dow = days.dow AND totals.hour = hours.hour
      ORDER BY days.ord, hours.hour`,
    )
    .all()
    .map((row) => ({
      day: String(row.day),
      hour: String(row.hour),
      tokens: Number(row.tokens),
    }));
}
