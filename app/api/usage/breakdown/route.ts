import { projectBreakdownData } from '@/lib/charts/projectBreakdown';
import { openDb } from '@/lib/db';
import { filtersFromParams } from '@/lib/queries/filters';
import { DEFAULT_PROJECT_LIMIT, isBreakdownDimension, projectTotals } from '@/lib/queries/breakdown';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseLimit(raw: string | null): number | null {
  if (raw === null) {
    return DEFAULT_PROJECT_LIMIT;
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) {
    return null;
  }
  return limit;
}

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const by = params.get('by') ?? 'project';
  const limit = parseLimit(params.get('limit'));

  if (!isBreakdownDimension(by)) {
    return Response.json({ error: `unknown dimension: ${by}` }, { status: 400 });
  }
  if (limit === null) {
    return Response.json({ error: 'limit must be a positive integer' }, { status: 400 });
  }

  const parsed = filtersFromParams(params);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const db = openDb();
  try {
    return Response.json(projectBreakdownData(projectTotals(db, limit, parsed.filters)));
  } finally {
    db.close();
  }
}
