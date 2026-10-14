import type { DatabaseSync } from 'node:sqlite';
import type { CostByModelRow } from '@/lib/charts/costByModel';
import { COST_KINDS, type CostByKindRow, type CostKind } from '@/lib/charts/costByKind';
import { baseModel, costOf, ratesFor, type Rates, type TokenCounts } from '@/lib/pricing';
import { BUCKET_EXPRESSION, bucketsSpanned, perRequest, type Bucket, ALL_TIME_ALL_SURFACES, type QueryFilters } from '@/lib/queries/aggregate';

export type UnpricedModel = {
  model: string;
  tokens: number;
};

export type CostSeries = {
  rows: CostByModelRow[];
  unpriced: UnpricedModel[];
};

/**
 * Buckets are priced in TypeScript rather than SQL so a rate change is one table edit.
 */
function bucketedTokensSql(bucket: Bucket, filters: QueryFilters): string {
  return `${perRequest(filters)}
  SELECT
    ${BUCKET_EXPRESSION[bucket]} AS day,
    COALESCE(model, 'unknown') AS model,
    SUM(input) AS input,
    SUM(output) AS output,
    SUM(cache_read) AS cache_read,
    SUM(cache_create_5m) AS cache_create_5m,
    SUM(cache_create_1h) AS cache_create_1h,
    SUM(MIN(thinking, output)) AS thinking
  FROM per_request
  GROUP BY day, model
  ORDER BY day, model`;
}

type BucketTokens = {
  day: string;
  model: string;
  counts: TokenCounts;
  /**
   * The part of `counts.output` spent thinking. Six requests in a hundred thousand log more
   * thinking than output, so each is capped at its output and the two still add up.
   */
  thinking: number;
};

function readBuckets(db: DatabaseSync, bucket: Bucket, filters: QueryFilters): BucketTokens[] {
  return db
    .prepare(bucketedTokensSql(bucket, filters))
    .all()
    .map((row) => ({
      day: String(row.day),
      model: String(row.model),
      counts: {
        input: Number(row.input),
        output: Number(row.output),
        cacheWrite5m: Number(row.cache_create_5m),
        cacheWrite1h: Number(row.cache_create_1h),
        cacheRead: Number(row.cache_read),
      },
      thinking: Number(row.thinking),
    }));
}

function totalTokens(counts: TokenCounts): number {
  return (
    counts.input + counts.output + counts.cacheWrite5m + counts.cacheWrite1h + counts.cacheRead
  );
}

/**
 * Dated snapshots such as `claude-haiku-4-5-20251001` collapse onto their base model, so
 * one model occupies one series however Claude Code spelled it that week.
 */
export function costByModelSeries(
  db: DatabaseSync,
  bucket: Bucket,
  filters: QueryFilters = ALL_TIME_ALL_SURFACES,
): CostSeries {
  const priced = new Map<string, CostByModelRow>();
  const unpriced = new Map<string, UnpricedModel>();

  for (const entry of readBuckets(db, bucket, filters)) {
    const model = baseModel(entry.model);
    const rates = ratesFor(entry.model, entry.day);
    if (rates === undefined) {
      const seen = unpriced.get(model);
      unpriced.set(model, { model, tokens: (seen?.tokens ?? 0) + totalTokens(entry.counts) });
      continue;
    }
    const key = `${entry.day} ${model}`;
    const running = priced.get(key);
    const cost = (running?.cost ?? 0) + costOf(entry.counts, rates);
    priced.set(key, { day: entry.day, model, cost });
  }

  // Dense for the same reason the token series are: an area or line view joins the points it
  // is given, so a bucket with no spend has to be a zero rather than a gap it bridges.
  const models = [...new Set([...priced.values()].map((row) => row.model))].sort();
  const rows = bucketsSpanned(db, bucket, filters).flatMap((day) =>
    models.map((model) => priced.get(`${day} ${model}`) ?? { day, model, cost: 0 }),
  );

  return { rows, unpriced: [...unpriced.values()] };
}

/** What each kind of token in a bucket cost, at the rates its model had that day. */
function kindCosts({ counts, thinking }: BucketTokens, rates: Rates): Array<{ kind: CostKind; cost: number }> {
  const dollars = (tokens: number, rate: number) => (tokens * rate) / 1_000_000;
  return [
    { kind: 'cache read', cost: dollars(counts.cacheRead, rates.cacheRead) },
    {
      kind: 'cache write',
      cost: dollars(counts.cacheWrite5m, rates.cacheWrite5m) + dollars(counts.cacheWrite1h, rates.cacheWrite1h),
    },
    { kind: 'input', cost: dollars(counts.input, rates.input) },
    { kind: 'output', cost: dollars(counts.output - thinking, rates.output) },
    { kind: 'thinking', cost: dollars(thinking, rates.output) },
  ];
}

/** Models with no known rates are left out, as they are from the cost by model. */
export function costByKindSeries(
  db: DatabaseSync,
  bucket: Bucket,
  filters: QueryFilters = ALL_TIME_ALL_SURFACES,
): CostByKindRow[] {
  const priced = new Map<string, number>();
  const add = (day: string, { kind, cost }: { kind: CostKind; cost: number }) => {
    const key = `${day} ${kind}`;
    priced.set(key, (priced.get(key) ?? 0) + cost);
  };

  for (const entry of readBuckets(db, bucket, filters)) {
    const rates = ratesFor(entry.model, entry.day);
    if (rates !== undefined) {
      kindCosts(entry, rates).forEach((line) => add(entry.day, line));
    }
  }

  return bucketsSpanned(db, bucket, filters).flatMap((day) =>
    COST_KINDS.map((kind) => ({ day, kind, cost: priced.get(`${day} ${kind}`) ?? 0 })),
  );
}
