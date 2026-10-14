import { activityHeatmapData } from '@/lib/charts/activityHeatmap';
import { openDb } from '@/lib/db';
import { activityByHourOfWeek } from '@/lib/queries/activity';
import { SLOT_MINUTES, type SlotSize } from '@/lib/charts/activityHeatmap';

/**
 * The grid's columns are a time of day, so only sub-day granularities apply. A day or week
 * bucket collapses every column into one, which is not a heatmap; those fall back to hour.
 */
function slotFor(bucket: string): SlotSize {
  return bucket in SLOT_MINUTES ? (bucket as SlotSize) : 'hour';
}
import { filtersFromParams } from '@/lib/queries/filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** No bucket parameter: the grid is fixed at weekday by hour, so there is nothing to choose. */
export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;

  const parsed = filtersFromParams(params);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const db = openDb();
  try {
    const slot = slotFor(params.get('bucket') ?? 'hour');
    const chart = activityHeatmapData(activityByHourOfWeek(db, parsed.filters, slot));
    return Response.json({ ...chart, range: parsed.range, slot });
  } finally {
    db.close();
  }
}
