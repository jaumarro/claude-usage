import type { DatabaseSync } from 'node:sqlite';

/**
 * Claude Code sometimes writes a dated snapshot id (`claude-haiku-4-5-20251001`). Left
 * alone it becomes a second series for the same model, so the trailing `-YYYYMMDD` is
 * stripped wherever a model is grouped or labelled.
 */
export const BASE_MODEL = `CASE
    WHEN model GLOB '*-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    THEN substr(model, 1, length(model) - 9)
    ELSE model
  END`;

export const BUCKETS = ['minute', '10m', 'hour', 'day', 'week'] as const;
export type Bucket = (typeof BUCKETS)[number];

/**
 * All buckets resolve in local time. The `today` range starts at local midnight, so a UTC
 * day boundary here would put the first hours of the day in the wrong bucket. The labels carry
 * the local wall clock marked as UTC, which is how the chart engine prints it unshifted; a day
 * needs no mark, as a bare date already reads as UTC midnight.
 */
export const BUCKET_EXPRESSION: Record<Bucket, string> = {
  minute: "strftime('%Y-%m-%dT%H:%M:00Z', ts / 1000, 'unixepoch', 'localtime')",
  // Floor to a 600s boundary in epoch space, then format: 600 divides every whole-hour
  // UTC offset evenly, so the local bucket edges land on :00, :10, :20 and so on.
  '10m': "strftime('%Y-%m-%dT%H:%M:00Z', (CAST(ts / 1000 / 600 AS INTEGER)) * 600, 'unixepoch', 'localtime')",
  hour: "strftime('%Y-%m-%dT%H:00:00Z', ts / 1000, 'unixepoch', 'localtime')",
  day: "date(ts / 1000, 'unixepoch', 'localtime')",
  week: "date(ts / 1000, 'unixepoch', 'localtime', '-6 days', 'weekday 1')",
};

export const RANGES = ['3h', 'today', '3d', '7d', '30d', '90d', 'all'] as const;
export type Range = (typeof RANGES)[number];

/** Days back from now. Fractions are allowed; 0 is the sentinel for local midnight. */
const RANGE_DAYS: Record<Range, number | null> = {
  '3h': 3 / 24,
  today: 0,
  '3d': 3,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
};

export function isRange(value: string): value is Range {
  return RANGES.some((range) => range === value);
}

export function isBucket(value: string): value is Bucket {
  return BUCKETS.some((bucket) => bucket === value);
}

/**
 * Which granularities are legible over each range. The constraint is readability, not cost:
 * 30 days of minutes answers in a fraction of a second but draws thousands of buckets into
 * a few hundred pixels, which is mush. Roughly a thousand buckets is the ceiling worth
 * plotting.
 */
export const BUCKETS_FOR_RANGE: Record<Range, readonly Bucket[]> = {
  '3h': ['minute', '10m', 'hour'],
  today: ['minute', '10m', 'hour', 'day'],
  '3d': ['minute', '10m', 'hour', 'day'],
  '7d': ['10m', 'hour', 'day'],
  '30d': ['hour', 'day', 'week'],
  '90d': ['day', 'week'],
  all: ['day', 'week'],
};

/**
 * Polling only earns its keep on a range short enough that a new request visibly moves the
 * chart. Every range ends at "now", but a poll on 90 days redraws an identical picture.
 */
export function isLiveRange(range: Range): boolean {
  return range === '3h' || range === 'today';
}

/**
 * A bucket of a day or coarser cannot visibly change between polls: a new request lands in
 * the same bar it would have landed in five seconds ago. Live needs sub-day granularity.
 */
export function isLiveBucket(bucket: Bucket): boolean {
  return bucket === 'minute' || bucket === '10m' || bucket === 'hour';
}

export function isBucketAllowed(range: Range, bucket: Bucket): boolean {
  return BUCKETS_FOR_RANGE[range].includes(bucket);
}

/**
 * The granularity a range opens on: the finest that keeps a chart near 150 points per series.
 * The chart engine's compile time grows close to the square of the rows it plots (a month of
 * hours across eight models took eight seconds against 22 ms by day), so the finer buckets
 * stay a choice rather than a default.
 */
const DEFAULT_BUCKET: Record<Range, Bucket> = {
  '3h': 'minute',
  today: '10m',
  '3d': 'hour',
  '7d': 'hour',
  '30d': 'day',
  '90d': 'day',
  all: 'day',
};

export function defaultBucketFor(range: Range): Bucket {
  return DEFAULT_BUCKET[range];
}

/** Epoch milliseconds the range starts at, or null when it is unbounded. */
export function sinceFor(range: Range, now: number = Date.now()): number | null {
  const days = RANGE_DAYS[range];
  if (days === null) {
    return null;
  }
  // `today` means since local midnight, not the last 24 hours.
  if (days === 0) {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime();
  }
  return now - days * 86_400_000;
}

/** Where the bucket holding `ms` begins, in local time, as `BUCKET_EXPRESSION` cuts it. */
export function bucketStart(ms: number, bucket: Bucket): number {
  if (bucket === '10m') {
    return Math.floor(ms / 600_000) * 600_000;
  }
  const start = new Date(ms);
  if (bucket === 'minute') {
    start.setSeconds(0, 0);
    return start.getTime();
  }
  if (bucket === 'hour') {
    start.setMinutes(0, 0, 0);
    return start.getTime();
  }
  start.setHours(0, 0, 0, 0);
  if (bucket === 'week') {
    // Weeks open on Monday; getDay() counts from Sunday.
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  }
  return start.getTime();
}

const FIXED_BUCKET_MS = { minute: 60_000, '10m': 600_000, hour: 3_600_000 };
const BUCKET_DAYS = { day: 1, week: 7 };

/** Where the bucket after the one opening at `start` begins. A local day can last 23 or 25 hours. */
export function nextBucketStart(start: number, bucket: Bucket): number {
  if (bucket === 'day' || bucket === 'week') {
    const next = new Date(start);
    next.setDate(next.getDate() + BUCKET_DAYS[bucket]);
    return next.getTime();
  }
  return start + FIXED_BUCKET_MS[bucket];
}

/** The span a time chart draws, in epoch milliseconds; an unbounded range has no fixed start. */
export type TimeWindow = { start: number | null; end: number };

/**
 * From the opening of the bucket the range starts in, to now. Every time chart draws this one
 * span, so a series cut into buckets and one plotted at its raw readings start and end together.
 */
export function timeWindow(range: Range, bucket: Bucket, now: number): TimeWindow {
  const since = sinceFor(range, now);
  return { start: since === null ? null : bucketStart(since, bucket), end: now };
}

export const SURFACES = ['all', 'desktop code', 'terminal'] as const;
export type Surface = (typeof SURFACES)[number];

/** Display label to the raw `entrypoint` the logs record. */
const SURFACE_ENTRYPOINT: Record<Exclude<Surface, 'all'>, string> = {
  'desktop code': 'claude-desktop',
  terminal: 'cli',
};

export function isSurface(value: string): value is Surface {
  return SURFACES.some((surface) => surface === value);
}

export type QueryFilters = {
  since: number | null;
  surface: Surface;
};

export const ALL_TIME_ALL_SURFACES: QueryFilters = { since: null, surface: 'all' };

/**
 * 60.7% of request ids span more than one log line, so raw rows are collapsed to one row
 * per request at the maximum of each token field before anything is summed. Thinking
 * tokens are a subset of output, so a consumer that reads them must not add them on top.
 * Every aggregation starts from this CTE.
 *
 * Both filters sit inside the CTE rather than outside it, so a request whose lines
 * straddle a boundary is judged once on its earliest line instead of being half counted.
 */
export function perRequest(filters: QueryFilters = ALL_TIME_ALL_SURFACES): string {
  const { since, surface } = filters;
  const sinceClause = since === null ? '' : `AND ts >= ${Math.floor(since)}`;
  const surfaceClause =
    surface === 'all' ? '' : `AND entrypoint = '${SURFACE_ENTRYPOINT[surface]}'`;

  return `WITH per_request AS (
    SELECT
      COALESCE(request_id, uuid) AS req,
      MIN(ts) AS ts,
      MIN(model) AS model,
      MIN(entrypoint) AS entrypoint,
      MIN(effort) AS effort,
      MIN(session_id) AS session_id,
      MIN(project) AS project,
      MIN(git_branch) AS git_branch,
      MAX(input) AS input,
      MAX(output) AS output,
      MAX(thinking) AS thinking,
      MAX(cache_read) AS cache_read,
      MAX(cache_create_5m) AS cache_create_5m,
      MAX(cache_create_1h) AS cache_create_1h
    FROM usage_events
    WHERE model IS NOT '<synthetic>' ${sinceClause} ${surfaceClause}
    GROUP BY req
  )`;
}

/**
 * The longest stride that still lands in every bucket. Day walks by the hour: a local day
 * around a DST change lasts 23 hours, and a 24-hour stride from late evening steps over it.
 */
const BUCKET_STEP_MS: Record<Bucket, number> = {
  minute: 60_000,
  '10m': 600_000,
  hour: 3_600_000,
  day: 3_600_000,
  week: 86_400_000,
};

/**
 * CTEs ending in `buckets(day)`: every bucket from the first request to the last, the idle
 * ones included. The last stride is clamped to the final request, so its bucket is always
 * reached and never overshot.
 */
export function bucketSpanSql(bucket: Bucket): string {
  const step = BUCKET_STEP_MS[bucket];
  return `span AS (SELECT MIN(ts) AS lo, MAX(ts) AS hi FROM per_request),
  steps(ts) AS (
    SELECT lo FROM span WHERE lo IS NOT NULL
    UNION ALL
    SELECT MIN(steps.ts + ${step}, span.hi) FROM steps, span WHERE steps.ts < span.hi
  ),
  buckets AS (SELECT DISTINCT ${BUCKET_EXPRESSION[bucket]} AS day FROM steps)`;
}

/** Every bucket from the first request to the last, in order, the idle ones included. */
export function bucketsSpanned(db: DatabaseSync, bucket: Bucket, filters: QueryFilters): string[] {
  return db
    .prepare(`${perRequest(filters)}, ${bucketSpanSql(bucket)} SELECT day FROM buckets ORDER BY day`)
    .all()
    .map((row) => String(row.day));
}

/**
 * Builds a series query whose grid is dense: every bucket from the first request to the
 * last, idle ones included, carries a row for every series, zero-filled where there was no
 * traffic.
 *
 * Without this a sparse series (an effort level used twice, months apart) draws one long
 * diagonal straight across the plot, because an area geom joins the points it is given and
 * an absent row is not a gap it can see. Zero-filling is a statement about the data, not a
 * cosmetic fix: no traffic in that bucket really is zero tokens.
 */
export function densifiedSeriesSql(options: {
  filters: QueryFilters;
  bucket: Bucket;
  splitExpression: string;
  splitAlias: string;
  valueExpression: string;
}): string {
  const { filters, bucket, splitExpression, splitAlias, valueExpression } = options;

  return `${perRequest(filters)},
  totals AS (
    SELECT ${BUCKET_EXPRESSION[bucket]} AS day, ${splitExpression} AS k, ${valueExpression} AS tokens
    FROM per_request
    GROUP BY day, k
  ),
  ${bucketSpanSql(bucket)},
  keys AS (SELECT DISTINCT k FROM totals)
  SELECT
    buckets.day AS day,
    keys.k AS ${splitAlias},
    COALESCE(totals.tokens, 0) AS tokens
  FROM buckets
  CROSS JOIN keys
  LEFT JOIN totals ON totals.day = buckets.day AND totals.k = keys.k
  ORDER BY buckets.day, keys.k`;
}
