import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '@/lib/db';
import { ingestCodeLogs } from '@/lib/ingest/code';
import { tokensByEffortSeries } from '@/lib/queries/effort';
import { tokensByModelSeries } from '@/lib/queries/timeseries';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

let db: DatabaseSync;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'claude-usage-effort-'));
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

async function ingest(fixtureName: string): Promise<void> {
  const target = join(root, fixtureName.replace('.jsonl', ''), 'session.jsonl');
  mkdirSync(join(target, '..'), { recursive: true });
  copyFileSync(join(FIXTURES, fixtureName), target);
  await ingestCodeLogs(db, root);
}

function totalOf(rows: { tokens: number }[]): number {
  return rows.reduce((sum, row) => sum + row.tokens, 0);
}

describe('tokensByEffortSeries', () => {
  it('counts a request spanning three lines once, at the maximum per token field', async () => {
    await ingest('multiline-request.jsonl');

    expect(tokensByEffortSeries(db, 'day')).toEqual([
      { day: '2026-09-04', effort: 'unset', tokens: 8468 },
    ]);
  });

  it('splits a day bucket by effort level', async () => {
    await ingest('wellformed.jsonl');

    expect(tokensByEffortSeries(db, 'day')).toEqual([
      { day: '2026-09-01', effort: 'high', tokens: 1310 },
      { day: '2026-09-01', effort: 'max', tokens: 0 },
      { day: '2026-09-02', effort: 'high', tokens: 0 },
      { day: '2026-09-02', effort: 'max', tokens: 855 },
    ]);
  });

  it('labels a null effort unset rather than dropping the record', async () => {
    await ingest('wellformed.jsonl');
    await ingest('multiline-request.jsonl');

    const efforts = tokensByEffortSeries(db, 'week').map((row) => row.effort);

    expect(efforts).toContain('unset');
  });

  it('buckets by the Monday that starts the week', async () => {
    await ingest('wellformed.jsonl');
    await ingest('multiline-request.jsonl');

    expect(tokensByEffortSeries(db, 'week')).toEqual([
      { day: '2026-08-31', effort: 'high', tokens: 1310 },
      { day: '2026-08-31', effort: 'max', tokens: 855 },
      { day: '2026-08-31', effort: 'unset', tokens: 8468 },
    ]);
  });

  it('totals the same as the model split, so no dimension adds tokens of its own', async () => {
    await ingest('wellformed.jsonl');
    await ingest('multiline-request.jsonl');

    expect(totalOf(tokensByEffortSeries(db, 'day'))).toBe(totalOf(tokensByModelSeries(db, 'day')));
  });

  it('returns an empty series when nothing has been ingested', () => {
    expect(tokensByEffortSeries(db, 'day')).toEqual([]);
  });

  it('lists the levels from least effort to most, the unnamed ones last', () => {
    const levels = ['xhigh', 'unset', 'low', 'max', 'high', 'medium'];
    levels.forEach((effort, index) => {
      db.prepare(
        `INSERT INTO usage_events (uuid, request_id, ts, model, effort, input, output, thinking,
          cache_create_5m, cache_create_1h, cache_read)
         VALUES (?, ?, 0, 'claude-opus-5', ?, 1, 1, 0, 0, 0, 0)`,
      ).run(`e-${index}`, `req_e${index}`, effort === 'unset' ? null : effort);
    });

    expect(tokensByEffortSeries(db, 'day').map((row) => row.effort)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'unset',
    ]);
  });
});
