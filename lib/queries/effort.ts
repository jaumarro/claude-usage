import type { DatabaseSync } from 'node:sqlite';
import { EFFORT_LEVELS, type TokensByEffortRow } from '@/lib/charts/tokensByEffort';
import { densifiedSeriesSql, type Bucket, ALL_TIME_ALL_SURFACES, type QueryFilters } from '@/lib/queries/aggregate';

/**
 * A request that spans several log lines is collapsed to one row at the maximum of each
 * token field before anything is summed. Thinking is a subset of output, so it is never
 * added to the token total.
 */
function seriesSql(bucket: Bucket, filters: QueryFilters): string {
  return densifiedSeriesSql({
    filters,
    bucket,
    splitExpression: "COALESCE(effort, 'unset')",
    splitAlias: 'effort',
    valueExpression: 'SUM(input + output + cache_read + cache_create_5m + cache_create_1h)',
  });
}

/** A level the list does not know goes after the ones it does. */
function levelRank(effort: string): number {
  const rank = EFFORT_LEVELS.indexOf(effort);
  return rank === -1 ? EFFORT_LEVELS.length : rank;
}

/** Levels stack from least effort up, which alphabetical order would scramble. */
function byBucketThenLevel(left: TokensByEffortRow, right: TokensByEffortRow): number {
  return (
    left.day.localeCompare(right.day) ||
    levelRank(left.effort) - levelRank(right.effort) ||
    left.effort.localeCompare(right.effort)
  );
}

export function tokensByEffortSeries(
  db: DatabaseSync,
  bucket: Bucket,
  filters: QueryFilters = ALL_TIME_ALL_SURFACES,
): TokensByEffortRow[] {
  return db
    .prepare(seriesSql(bucket, filters))
    .all()
    .map((row) => ({
      day: String(row.day),
      effort: String(row.effort),
      tokens: Number(row.tokens),
    }))
    .sort(byBucketThenLevel);
}
