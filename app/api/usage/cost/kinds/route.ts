import { costByKindData } from '@/lib/charts/costByKind';
import { openDb } from '@/lib/db';
import { filtersFromParams } from '@/lib/queries/filters';
import { costByKindSeries } from '@/lib/queries/cost';
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
    return Response.json(costByKindData(costByKindSeries(db, bucket, parsed.filters)));
  } finally {
    db.close();
  }
}
