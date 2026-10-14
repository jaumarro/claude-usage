import { openDb } from '@/lib/db';
import { ingestCodeLogs, type IngestResult } from '@/lib/ingest/code';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A poll can land while the page-load sync is still reading. Two runs on separate
// connections would collide on the database lock, so a request joins the run in flight.
let inFlight: Promise<IngestResult> | null = null;

async function ingestOnce(): Promise<IngestResult> {
  const db = openDb();
  try {
    return await ingestCodeLogs(db);
  } finally {
    db.close();
  }
}

export async function POST(): Promise<Response> {
  if (inFlight === null) {
    inFlight = ingestOnce().finally(() => {
      inFlight = null;
    });
  }
  return Response.json(await inFlight);
}
