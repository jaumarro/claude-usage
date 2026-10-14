import type { DatabaseSync } from 'node:sqlite';
import type { TokensByModelRow } from '@/lib/charts/tokensByModel';
import { releaseMsFor } from '@/lib/modelReleases';
import { BASE_MODEL, BUCKET_EXPRESSION, densifiedSeriesSql, perRequest, type Bucket, ALL_TIME_ALL_SURFACES, type QueryFilters } from '@/lib/queries/aggregate';

export const DIMENSIONS = ['model'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

type Split = { expression: string; alias: string };

const MODEL_SPLIT: Split = { expression: `COALESCE(${BASE_MODEL}, 'unknown')`, alias: 'model' };

function seriesSql(bucket: Bucket, split: Split, filters: QueryFilters): string {
  return densifiedSeriesSql({
    filters,
    bucket,
    splitExpression: split.expression,
    splitAlias: split.alias,
    valueExpression: 'SUM(input + output + cache_read + cache_create_5m + cache_create_1h)',
  });
}

export function isDimension(value: string): value is Dimension {
  return DIMENSIONS.some((dimension) => dimension === value);
}

export function tokensByModelSeries(
  db: DatabaseSync,
  bucket: Bucket,
  filters: QueryFilters = ALL_TIME_ALL_SURFACES,
): TokensByModelRow[] {
  return db
    .prepare(seriesSql(bucket, MODEL_SPLIT, filters))
    .all()
    .map((row) => ({
      day: String(row.day),
      model: String(row.model),
      tokens: Number(row.tokens),
    }));
}

export type ModelMarker = {
  model: string;
  /** Epoch milliseconds. A `geom.rule` x constant needs ms, not the ISO the axis uses. */
  at: number;
  /**
   * The marker snapped to a bucket label, in the exact format the series rows carry. An
   * annotation's `axis` anchor is matched against the data's own values, so a full ISO
   * string or an epoch number fails to map and the label is silently dropped.
   */
  bucket: string;
  /** `release` when a published date is known, `first-use` when the corpus is the source. */
  kind: 'release' | 'first-use';
};

export function modelMarkers(
  db: DatabaseSync,
  bucket: Bucket,
  filters: QueryFilters = ALL_TIME_ALL_SURFACES,
): ModelMarker[] {
  // A model's release is a fact about the world and its first use a fact about the whole
  // corpus. Neither is a property of the selected window, so both are computed unfiltered
  // and only the markers landing inside the window are kept.
  const since = filters.since;

  const firstUse = db
    .prepare(
      `${perRequest({ ...ALL_TIME_ALL_SURFACES, surface: filters.surface })}
      SELECT ${BASE_MODEL} AS model, MIN(ts) AS at
      FROM per_request
      WHERE model IS NOT NULL
      GROUP BY model`,
    )
    .all()
    .map((row) => ({ model: String(row.model), firstUse: Number(row.at) }));

  const bucketOf = db.prepare(
    `SELECT ${BUCKET_EXPRESSION[bucket]} AS bucket FROM (SELECT ? AS ts)`,
  );

  return firstUse
    .map(({ model, firstUse: seen }) => {
      const released = releaseMsFor(model);
      const at = released ?? seen;
      const row = bucketOf.get(at);
      return {
        model,
        at,
        bucket: String(row?.bucket ?? ''),
        kind: released === null ? ('first-use' as const) : ('release' as const),
      };
    })
    .filter((marker) => marker.bucket !== '')
    .filter((marker) => since === null || marker.at >= since)
    .sort((a, b) => a.at - b.at);
}
