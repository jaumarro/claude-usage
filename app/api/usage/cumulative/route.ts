import { cumulativeCostData } from '@/lib/charts/cumulativeCost';
import { openDb } from '@/lib/db';
import { filtersFromParams } from '@/lib/queries/filters';
import { cumulativeCostSeries } from '@/lib/queries/cumulativeCost';
import { isBucket, isBucketAllowed, defaultBucketFor } from '@/lib/queries/aggregate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const requestedBucket = params.get('bucket') ?? 'day';

  if (!isBucket(requestedBucket)) {
    return Response.json({ error: `unknown bucket: ${requestedBucket}` }, { status: 400 });
  }

  const parsed = filtersFromParams(params);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const bucket = isBucketAllowed(parsed.range, requestedBucket)
    ? requestedBucket
    : defaultBucketFor(parsed.range);

  const db = openDb();
  try {
    const series = cumulativeCostSeries(db, bucket, parsed.filters);
    return Response.json({
      ...cumulativeCostData(series.rows),
      days: series.days,
      thresholdUsd: series.thresholdUsd,
      crossing: series.crossing,
      unpricedTokens: series.unpricedTokens,
    });
  } finally {
    db.close();
  }
}
