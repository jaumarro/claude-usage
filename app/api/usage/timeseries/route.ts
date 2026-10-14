import { tokensByModelData } from '@/lib/charts/tokensByModel';
import { openDb } from '@/lib/db';
import { filtersFromParams } from '@/lib/queries/filters';
import { isBucket, isBucketAllowed, defaultBucketFor } from '@/lib/queries/aggregate';
import { isDimension, modelMarkers, tokensByModelSeries } from '@/lib/queries/timeseries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const requestedBucket = params.get('bucket') ?? 'day';
  const by = params.get('by') ?? 'model';

  if (!isBucket(requestedBucket)) {
    return Response.json({ error: `unknown bucket: ${requestedBucket}` }, { status: 400 });
  }
  if (!isDimension(by)) {
    return Response.json({ error: `unknown dimension: ${by}` }, { status: 400 });
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
    const chart = tokensByModelData(tokensByModelSeries(db, bucket, parsed.filters));
    const markers = modelMarkers(db, bucket, parsed.filters);
    return Response.json({ ...chart, markers });
  } finally {
    db.close();
  }
}
