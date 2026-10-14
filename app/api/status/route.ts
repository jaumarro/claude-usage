import { NextResponse } from 'next/server';
import { openDb } from '@/lib/db';
import { ingestQuota } from '@/lib/ingest/quota';
import { ingestStatusline } from '@/lib/ingest/statusline';
import { readStatus } from '@/lib/status';

export const dynamic = 'force-dynamic';

function requestedDays(url: string): number {
  const raw = Number(new URL(url).searchParams.get('days'));
  if (!Number.isFinite(raw) || raw <= 0) {
    return 7;
  }
  return Math.min(Math.round(raw), 365);
}

/** Epoch milliseconds to start the series at, when the caller names one. */
function requestedSince(url: string): number | undefined {
  const raw = Number(new URL(url).searchParams.get('since') ?? Number.NaN);
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

export function GET(request: Request) {
  const db = openDb();
  try {
    ingestQuota(db);
    ingestStatusline(db);
    const now = Date.now();
    return NextResponse.json(readStatus(db, now, requestedDays(request.url), requestedSince(request.url)));
  } finally {
    db.close();
  }
}
