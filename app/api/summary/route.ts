import { openDb } from '@/lib/db';
import { filtersFromParams } from '@/lib/queries/filters';
import { readSummary } from '@/lib/queries/summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const parsed = filtersFromParams(params);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const db = openDb();
  try {
    return Response.json(readSummary(db, parsed.filters));
  } finally {
    db.close();
  }
}
