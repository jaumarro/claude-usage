import type { DatabaseSync } from 'node:sqlite';
import { planMonthlyUsd } from '@/lib/config';
import { ALL_TIME_ALL_SURFACES, perRequest, type QueryFilters } from '@/lib/queries/aggregate';
import { costByModelSeries } from '@/lib/queries/cost';
import { cumulativeCostSeries } from '@/lib/queries/cumulativeCost';
import { readWindow, type WindowName } from '@/lib/status';

export type Summary = {
  tokens: number;
  requests: number;
  logLines: number;
  models: number;
  activeDays: number;
  firstDay: string | null;
  lastDay: string | null;
  costUsd: number;
  unpricedTokens: number;
  /** API-equivalent spend divided by `thresholdUsd`: 1.0 means breaking even. */
  planValueRatio: number;
  /** The subscription pro-rated over the days the data spans, the break-even threshold. */
  thresholdUsd: number;
  /** What the subscription costs per month. */
  planUsd: number;
  /** Sessions that sent a request in the range, each counted once. */
  sessions: number;
  /** Thinking tokens over output tokens, thinking being a part of output. */
  thinkingShare: number;
  /** Each quota window's latest reading, live rather than over the range; null when unread. */
  windows: Record<WindowName, number | null>;
  quota: QuotaSummary | null;
};

export type QuotaSummary = {
  samples: number;
  peakFiveHour: number;
  peakSevenDay: number;
  meanFiveHour: number;
  meanSevenDay: number;
};

const TOTALS_SQL = (filters: QueryFilters): string => `${perRequest(filters)}
  SELECT
    SUM(input + output + cache_read + cache_create_5m + cache_create_1h) AS tokens,
    SUM(output) AS output,
    SUM(thinking) AS thinking,
    COUNT(DISTINCT session_id) AS sessions,
    COUNT(*) AS requests,
    COUNT(DISTINCT model) AS models,
    COUNT(DISTINCT date(ts / 1000, 'unixepoch')) AS active_days,
    MIN(date(ts / 1000, 'unixepoch')) AS first_day,
    MAX(date(ts / 1000, 'unixepoch')) AS last_day
  FROM per_request`;

const QUOTA_SQL = `SELECT
    COUNT(*) AS samples,
    MAX(fh_pct) AS peak_fh,
    MAX(sd_pct) AS peak_sd,
    AVG(fh_pct) AS mean_fh,
    AVG(sd_pct) AS mean_sd
  FROM quota_samples
  WHERE t >= ?`;

function readQuota(db: DatabaseSync, since: number | null): QuotaSummary | null {
  const row = db.prepare(QUOTA_SQL).get(since ?? 0);
  if (row === undefined || Number(row.samples) === 0) {
    return null;
  }
  return {
    samples: Number(row.samples),
    peakFiveHour: Number(row.peak_fh),
    peakSevenDay: Number(row.peak_sd),
    meanFiveHour: Number(row.mean_fh),
    meanSevenDay: Number(row.mean_sd),
  };
}

function countLogLines(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM usage_events').get();
  return row === undefined ? 0 : Number(row.n);
}

function latestReading(db: DatabaseSync, window: WindowName, now: number): number | null {
  return readWindow(db, window, now)?.used_percentage ?? null;
}

export function readSummary(
  db: DatabaseSync,
  filters: QueryFilters = ALL_TIME_ALL_SURFACES,
  now = Date.now(),
): Summary {
  const totals = db.prepare(TOTALS_SQL(filters)).get();
  const series = costByModelSeries(db, 'day', filters);
  const cumulative = cumulativeCostSeries(db, 'day', filters);
  const costUsd = series.rows.reduce((sum, row) => sum + row.cost, 0);
  const unpricedTokens = series.unpriced.reduce((sum, entry) => sum + entry.tokens, 0);

  const activeDays = totals === undefined ? 0 : Number(totals.active_days);
  const output = totals === undefined ? 0 : Number(totals.output ?? 0);
  const thinking = totals === undefined ? 0 : Number(totals.thinking ?? 0);
  // The subscription is paid on idle days too, so the ratio is against every day of the period.
  const planValueRatio = cumulative.thresholdUsd === 0 ? 0 : costUsd / cumulative.thresholdUsd;

  return {
    tokens: totals === undefined ? 0 : Number(totals.tokens ?? 0),
    requests: totals === undefined ? 0 : Number(totals.requests),
    logLines: countLogLines(db),
    models: totals === undefined ? 0 : Number(totals.models),
    activeDays,
    firstDay: totals?.first_day === null || totals === undefined ? null : String(totals.first_day),
    lastDay: totals?.last_day === null || totals === undefined ? null : String(totals.last_day),
    costUsd,
    unpricedTokens,
    planValueRatio,
    thresholdUsd: cumulative.thresholdUsd,
    planUsd: planMonthlyUsd(),
    sessions: totals === undefined ? 0 : Number(totals.sessions),
    thinkingShare: output === 0 ? 0 : thinking / output,
    windows: {
      five_hour: latestReading(db, 'five_hour', now),
      seven_day: latestReading(db, 'seven_day', now),
      spend_limit: latestReading(db, 'spend_limit', now),
    },
    quota: readQuota(db, filters.since),
  };
}
