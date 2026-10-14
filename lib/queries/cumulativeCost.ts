import type { DatabaseSync } from 'node:sqlite';
import type { CumulativeCostRow } from '@/lib/charts/cumulativeCost';
import { costOf, ratesFor, type TokenCounts } from '@/lib/pricing';
import {
  ALL_TIME_ALL_SURFACES,
  BUCKET_EXPRESSION,
  perRequest,
  type Bucket,
  type QueryFilters,
} from '@/lib/queries/aggregate';
import { planMonthlyUsd } from '@/lib/config';

const DAYS_PER_MONTH = 30;
const MS_PER_DAY = 86_400_000;

export type Crossing = {
  day: string;
  /** Epoch milliseconds of the same bucket, which is what a `geom.rule` x constant takes. */
  at: number;
};

export type CumulativeCostSeries = {
  rows: CumulativeCostRow[];
  /** Calendar days the data spans, first bucket to last inclusive, capped by a bounded range. */
  days: number;
  /** The subscription pro-rated over `days`, so a partial window compares fairly. */
  thresholdUsd: number;
  crossing: Crossing | null;
  unpricedTokens: number;
};

function bucketedTokensSql(bucket: Bucket, filters: QueryFilters): string {
  return `${perRequest(filters)}
  SELECT
    ${BUCKET_EXPRESSION[bucket]} AS day,
    COALESCE(model, 'unknown') AS model,
    SUM(input) AS input,
    SUM(output) AS output,
    SUM(cache_read) AS cache_read,
    SUM(cache_create_5m) AS cache_create_5m,
    SUM(cache_create_1h) AS cache_create_1h
  FROM per_request
  GROUP BY day, model
  ORDER BY day, model`;
}

const SPAN_SQL = (filters: QueryFilters): string => `${perRequest(filters)}
  SELECT
    MIN(date(ts / 1000, 'unixepoch', 'localtime')) AS first_day,
    MAX(date(ts / 1000, 'unixepoch', 'localtime')) AS last_day
  FROM per_request`;

function totalTokens(counts: TokenCounts): number {
  return (
    counts.input + counts.output + counts.cacheWrite5m + counts.cacheWrite1h + counts.cacheRead
  );
}

/** Inclusive, so a single day of data spans one day rather than zero. */
function daysSpanned(db: DatabaseSync, filters: QueryFilters): number {
  const row = db.prepare(SPAN_SQL(filters)).get();
  if (row === undefined || row.first_day === null || row.last_day === null) {
    return 0;
  }
  const elapsed = Date.parse(String(row.last_day)) - Date.parse(String(row.first_day));
  return Math.round(elapsed / MS_PER_DAY) + 1;
}

/**
 * A bounded range starts and ends partway through a day, so its calendar dates alone would
 * price thirty days as thirty-one. Its exact length caps the span; a range the data covers
 * only in part still keeps the days the data spans.
 */
function periodDays(db: DatabaseSync, filters: QueryFilters, now: number): number {
  const spanned = daysSpanned(db, filters);
  if (filters.since === null) {
    return spanned;
  }
  return Math.min(spanned, (now - filters.since) / MS_PER_DAY);
}

/**
 * The running API-equivalent total across buckets, against the subscription pro-rated over
 * the same span. Where the two meet is the point the subscription paid for itself, which is
 * the whole question this chart exists to answer.
 */
export function cumulativeCostSeries(
  db: DatabaseSync,
  bucket: Bucket,
  filters: QueryFilters = ALL_TIME_ALL_SURFACES,
  now: number = Date.now(),
): CumulativeCostSeries {
  const perBucket = new Map<string, number>();
  let unpricedTokens = 0;

  for (const row of db.prepare(bucketedTokensSql(bucket, filters)).all()) {
    const day = String(row.day);
    const counts: TokenCounts = {
      input: Number(row.input),
      output: Number(row.output),
      cacheWrite5m: Number(row.cache_create_5m),
      cacheWrite1h: Number(row.cache_create_1h),
      cacheRead: Number(row.cache_read),
    };
    const rates = ratesFor(String(row.model), day);
    if (rates === undefined) {
      unpricedTokens += totalTokens(counts);
      continue;
    }
    perBucket.set(day, (perBucket.get(day) ?? 0) + costOf(counts, rates));
  }

  const days = periodDays(db, filters, now);
  const thresholdUsd = (planMonthlyUsd() * days) / DAYS_PER_MONTH;

  const rows: CumulativeCostRow[] = [];
  let crossing: Crossing | null = null;
  let running = 0;

  for (const [day, cost] of [...perBucket].sort(([left], [right]) => left.localeCompare(right))) {
    running += cost;
    rows.push({ day, cost: running });
    if (crossing === null && days > 0 && running >= thresholdUsd) {
      crossing = { day, at: Date.parse(day) };
    }
  }

  return { rows, days, thresholdUsd, crossing, unpricedTokens };
}
