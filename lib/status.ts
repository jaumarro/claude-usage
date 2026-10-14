import type { DatabaseSync } from 'node:sqlite';
import { quotaOverTimeData, type QuotaOverTimeRow } from '@/lib/charts/quotaOverTime';

export type QuotaSource = 'statusline' | 'plan-usage-history';

export type WindowStatus = {
  used_percentage: number;
  headroom_percentage: number;
  resets_at: string | null;
  seconds_until_reset: number | null;
  source: QuotaSource;
  captured_at: string;
  stale_seconds: number;
};

export type Status = {
  now: string;
  days: number;
  five_hour: WindowStatus | null;
  seven_day: WindowStatus | null;
  spend_limit: WindowStatus | null;
  resets: number[];
  chart: ReturnType<typeof quotaOverTimeData>;
};

export type WindowName = 'five_hour' | 'seven_day' | 'spend_limit';

type Reading = { t: number; pct: number; resetsAt: number | null; source: QuotaSource };

const DEFAULT_DAYS = 7;
const DAY_MS = 86_400_000;

const STATUSLINE_COLUMNS: Record<WindowName, { pct: string; resetsAt: string }> = {
  five_hour: { pct: 'fh_pct', resetsAt: 'fh_resets_at' },
  seven_day: { pct: 'sd_pct', resetsAt: 'sd_resets_at' },
  spend_limit: { pct: 'spend_pct', resetsAt: 'spend_resets_at' },
};

const QUOTA_COLUMNS: Partial<Record<WindowName, string>> = {
  five_hour: 'fh_pct',
  seven_day: 'sd_pct',
};

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function latestStatusline(db: DatabaseSync, window: WindowName): Reading | null {
  const { pct, resetsAt } = STATUSLINE_COLUMNS[window];
  const row = db
    .prepare(
      `SELECT t, ${pct} AS pct, ${resetsAt} AS resets_at FROM statusline_samples
       WHERE ${pct} IS NOT NULL ORDER BY t DESC LIMIT 1`,
    )
    .get();
  if (row === undefined) {
    return null;
  }
  const value = num(row.pct);
  const t = num(row.t);
  if (value === null || t === null) {
    return null;
  }
  return { t, pct: value, resetsAt: num(row.resets_at), source: 'statusline' };
}

function latestQuota(db: DatabaseSync, window: WindowName): Reading | null {
  const column = QUOTA_COLUMNS[window];
  if (column === undefined) {
    return null;
  }
  const row = db
    .prepare(`SELECT t, ${column} AS pct FROM quota_samples WHERE ${column} IS NOT NULL ORDER BY t DESC LIMIT 1`)
    .get();
  if (row === undefined) {
    return null;
  }
  const value = num(row.pct);
  const t = num(row.t);
  if (value === null || t === null) {
    return null;
  }
  return { t, pct: value, resetsAt: null, source: 'plan-usage-history' };
}

// Statusline readings are exact and carry the window boundary, so they win a tie. They stop
// arriving between Code sessions, though, in which case the desktop app's samples are the fresher
// reading of the same account-wide percentage.
function freshest(statusline: Reading | null, quota: Reading | null): Reading | null {
  if (statusline === null) {
    return quota;
  }
  if (quota === null || statusline.t >= quota.t) {
    return statusline;
  }
  return quota;
}

function toWindowStatus(reading: Reading | null, now: number): WindowStatus | null {
  if (reading === null) {
    return null;
  }
  const resetsAtMs = reading.resetsAt === null ? null : reading.resetsAt * 1000;
  const upcoming = resetsAtMs !== null && resetsAtMs > now;
  return {
    used_percentage: reading.pct,
    headroom_percentage: Math.max(0, 100 - reading.pct),
    resets_at: upcoming && resetsAtMs !== null ? new Date(resetsAtMs).toISOString() : null,
    seconds_until_reset: upcoming && resetsAtMs !== null ? Math.round((resetsAtMs - now) / 1000) : null,
    source: reading.source,
    captured_at: new Date(reading.t).toISOString(),
    stale_seconds: Math.round((now - reading.t) / 1000),
  };
}

export function readWindow(db: DatabaseSync, window: WindowName, now: number): WindowStatus | null {
  return toWindowStatus(freshest(latestStatusline(db, window), latestQuota(db, window)), now);
}

/**
 * Two five-hour readings further apart than the window mean it expired in between, so the
 * line drops to zero across the gap instead of sloping from one reading to the next. The
 * seven-day window carries its usage through a quiet night, so its readings stand as they are.
 */
const FIVE_HOURS_MS = 5 * 3_600_000;

function fiveHourZero(t: number): QuotaOverTimeRow {
  return { t: new Date(t).toISOString(), window: 'five_hour', pct: 0 };
}

function seriesRows(db: DatabaseSync, since: number): QuotaOverTimeRow[] {
  const rows = db
    .prepare(
      `SELECT t, fh_pct, sd_pct FROM quota_samples WHERE t >= ?
       UNION ALL
       SELECT t, fh_pct, sd_pct FROM statusline_samples WHERE t >= ?
       ORDER BY t`,
    )
    .all(since, since);

  const series: QuotaOverTimeRow[] = [];
  let lastFiveHour: number | null = null;
  for (const row of rows) {
    const t = num(row.t);
    if (t === null) {
      continue;
    }
    const at = new Date(t).toISOString();
    const fiveHour = num(row.fh_pct);
    if (fiveHour !== null) {
      if (lastFiveHour !== null && t - lastFiveHour > FIVE_HOURS_MS) {
        series.push(fiveHourZero(lastFiveHour + 1), fiveHourZero(t - 1));
      }
      series.push({ t: at, window: 'five_hour', pct: fiveHour });
      lastFiveHour = t;
    }
    const sevenDay = num(row.sd_pct);
    if (sevenDay !== null) {
      series.push({ t: at, window: 'seven_day', pct: sevenDay });
    }
  }
  // A seven-day-only reading inside a gap was pushed before that gap's zeros. The sort is
  // stable, so readings sharing a timestamp keep their order.
  return series.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

function resetBoundaries(db: DatabaseSync, since: number): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT fh_resets_at AS at FROM statusline_samples
       WHERE t >= ? AND fh_resets_at IS NOT NULL ORDER BY at`,
    )
    .all(since);

  const boundaries: number[] = [];
  for (const row of rows) {
    const at = num(row.at);
    if (at !== null) {
      boundaries.push(at * 1000);
    }
  }
  return boundaries;
}

/** `since` lets a caller start the series where its other charts start; it defaults to `days` back. */
export function readStatus(
  db: DatabaseSync,
  now = Date.now(),
  days = DEFAULT_DAYS,
  since = now - days * DAY_MS,
): Status {
  return {
    now: new Date(now).toISOString(),
    days,
    five_hour: readWindow(db, 'five_hour', now),
    seven_day: readWindow(db, 'seven_day', now),
    spend_limit: readWindow(db, 'spend_limit', now),
    resets: resetBoundaries(db, since),
    chart: quotaOverTimeData(seriesRows(db, since)),
  };
}
