import { createSpec, pipe, mapping, geom, scale } from '@graphysdk/react';
import { OVERLAP_LAYER, spanScale } from '@/lib/charts/seriesViews';
import type { TimeWindow } from '@/lib/queries/aggregate';

export type QuotaOverTimeRow = {
  t: string;
  window: string;
  pct: number;
};

// No labels, as no other chart's columns carry one: a label becomes the axis title.
export const quotaOverTimeColumns = [{ key: 't' }, { key: 'window' }, { key: 'pct' }];

export function quotaOverTimeData(rows: QuotaOverTimeRow[]) {
  return { columns: quotaOverTimeColumns, rows };
}

/** When the seven-day window resets each week, in local time. `weekday` counts from Sunday, as `Date.getDay` does. */
export type WeeklySchedule = { weekday: number; hour: number; minute: number };

/**
 * This account's seven-day window resets on Tuesdays at 01:00 local time. The desktop app's
 * history carries no reset time, but its weekly figure drops to zero between Monday night and
 * Tuesday morning every week it was read either side, and once between 00:35 and 09:20 on a
 * Tuesday.
 */
export const DEFAULT_WEEKLY_RESET: WeeklySchedule = { weekday: 2, hour: 1, minute: 0 };

/** The first reset at or after `at`. */
export function nextWeeklyReset(at: number, schedule: WeeklySchedule): number {
  const next = new Date(at);
  next.setHours(schedule.hour, schedule.minute, 0, 0);
  next.setDate(next.getDate() + ((schedule.weekday - next.getDay() + 7) % 7));
  if (next.getTime() < at) {
    next.setDate(next.getDate() + 7);
  }
  return next.getTime();
}

/** Every weekly reset from `from` to `to`, in epoch milliseconds. */
export function weeklyResets(from: number, to: number, schedule: WeeklySchedule): number[] {
  const next = new Date(nextWeeklyReset(from, schedule));
  const resets: number[] = [];
  while (next.getTime() <= to) {
    resets.push(next.getTime());
    // Stepping the date rather than adding a week of milliseconds keeps the time across a DST change.
    next.setDate(next.getDate() + 7);
  }
  return resets;
}

// A rule reads one observation, so each reset boundary needs its own layer. The x constant has to
// be epoch milliseconds: the datetime scale rejects an ISO string or a Date here.
function resetMarker(at: number) {
  return geom.rule({ aes: { x: { value: at }, y: undefined, color: undefined } });
}

export function quotaOverTimeInputWithResets(resets: readonly number[], span?: TimeWindow) {
  return pipe(
    createSpec(),
    mapping({ x: 't', y: 'pct', color: 'window' }),
    geom.area({ id: OVERLAP_LAYER, position: 'identity' }),
    ...resets.map(resetMarker),
    spanScale(span),
    // Pinning the axis to 0-100 makes the ceiling the axis itself, so no reference line is
    // needed. Safe because both windows plotted here are percentages that cap at 100;
    // spend_limit can exceed 100 and would be clipped, so it is not charted.
    // The bounds are `domainMin`/`domainMax`, not `domain`: an unknown key merges without
    // validation and is silently ignored, which is how this axis auto-scaled unnoticed.
    scale.y.continuous({ domainMin: 0, domainMax: 100 }),
  );
}

export const quotaOverTimeInput = quotaOverTimeInputWithResets([]);
