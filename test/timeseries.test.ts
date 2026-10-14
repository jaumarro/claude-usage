import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '@/lib/db';
import { ingestCodeLogs } from '@/lib/ingest/code';
import { tokensByModelSeries } from '@/lib/queries/timeseries';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

let db: DatabaseSync;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'claude-usage-query-'));
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

function sumRawTokens(): number {
  const row = db
    .prepare(
      `SELECT SUM(input + output + cache_read + cache_create_5m + cache_create_1h) AS n
       FROM usage_events`,
    )
    .get();
  return Number(row?.n);
}

function totalOf(rows: { tokens: number }[]): number {
  return rows.reduce((sum, row) => sum + row.tokens, 0);
}

describe('tokensByModelSeries', () => {
  it('counts a request spanning three lines once, at the maximum per token field', async () => {
    await ingest('multiline-request.jsonl');

    const rows = tokensByModelSeries(db, 'day');

    expect(rows).toEqual([{ day: '2026-09-04', model: 'claude-opus-5', tokens: 8468 }]);
    expect(sumRawTokens()).toBe(20938);
  });

  it('sums across requests and splits by model within a day bucket', async () => {
    await ingest('wellformed.jsonl');

    const rows = tokensByModelSeries(db, 'day');

    // The grid is dense, so both models appear on both days; the untouched cells are 0.
    expect(rows).toEqual([
      { day: '2026-09-01', model: 'claude-fable-5-1', tokens: 0 },
      { day: '2026-09-01', model: 'claude-opus-5', tokens: 1310 },
      { day: '2026-09-02', model: 'claude-fable-5-1', tokens: 855 },
      { day: '2026-09-02', model: 'claude-opus-5', tokens: 0 },
    ]);
  });

  it('buckets by the Monday that starts the week', async () => {
    await ingest('wellformed.jsonl');
    await ingest('multiline-request.jsonl');

    const rows = tokensByModelSeries(db, 'week');

    expect(rows).toEqual([
      { day: '2026-08-31', model: 'claude-fable-5-1', tokens: 855 },
      { day: '2026-08-31', model: 'claude-opus-5', tokens: 9778 },
    ]);
  });

  it('preserves the day totals when the same rows are bucketed by week', async () => {
    await ingest('wellformed.jsonl');
    await ingest('multiline-request.jsonl');

    expect(totalOf(tokensByModelSeries(db, 'week'))).toBe(
      totalOf(tokensByModelSeries(db, 'day')),
    );
  });

  it('falls back to the uuid when a record carries no request_id', async () => {
    const insert = db.prepare(
      `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
        cache_create_5m, cache_create_1h, cache_read)
       VALUES (?, NULL, ?, 'claude-opus-5', 0, ?, 0, 0, 0, 0)`,
    );
    insert.run('no-req-1', Date.parse('2026-09-06T00:00:00.000Z'), 7);
    insert.run('no-req-2', Date.parse('2026-09-06T00:00:00.000Z'), 11);

    const rows = tokensByModelSeries(db, 'day');

    expect(rows).toEqual([{ day: '2026-09-06', model: 'claude-opus-5', tokens: 18 }]);
  });

  it('excludes thinking tokens, which are already counted inside output', async () => {
    await ingest('wellformed.jsonl');
    const stored = db.prepare('SELECT thinking FROM usage_events WHERE uuid = ?').get('a-1');
    expect(Number(stored?.thinking)).toBe(40);

    const rows = tokensByModelSeries(db, 'day');
    const cell = rows.find((row) => row.day === '2026-09-01' && row.model === 'claude-opus-5');

    expect(cell?.tokens).toBe(1310);
  });

  it('returns an empty series when nothing has been ingested', () => {
    expect(tokensByModelSeries(db, 'day')).toEqual([]);
  });

  it('zero-fills a day with no traffic at all, so the area drops instead of bridging it', () => {
    const insert = db.prepare(
      `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
        cache_create_5m, cache_create_1h, cache_read)
       VALUES (?, ?, ?, 'claude-opus-5', 0, ?, 0, 0, 0, 0)`,
    );
    insert.run('gap-1', 'req_gap_1', new Date(2026, 8, 1, 12).getTime(), 5);
    insert.run('gap-2', 'req_gap_2', new Date(2026, 8, 3, 12).getTime(), 7);

    expect(tokensByModelSeries(db, 'day')).toEqual([
      { day: '2026-09-01', model: 'claude-opus-5', tokens: 5 },
      { day: '2026-09-02', model: 'claude-opus-5', tokens: 0 },
      { day: '2026-09-03', model: 'claude-opus-5', tokens: 7 },
    ]);
  });

  it('zero-fills idle hours between two active ones', () => {
    const insert = db.prepare(
      `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
        cache_create_5m, cache_create_1h, cache_read)
       VALUES (?, ?, ?, 'claude-opus-5', 0, ?, 0, 0, 0, 0)`,
    );
    insert.run('hour-1', 'req_hour_1', new Date(2026, 8, 1, 10, 45).getTime(), 5);
    insert.run('hour-2', 'req_hour_2', new Date(2026, 8, 1, 13, 5).getTime(), 7);

    expect(tokensByModelSeries(db, 'hour').map((row) => [row.day, row.tokens])).toEqual([
      ['2026-09-01T10:00:00Z', 5],
      ['2026-09-01T11:00:00Z', 0],
      ['2026-09-01T12:00:00Z', 0],
      ['2026-09-01T13:00:00Z', 7],
    ]);
  });
});
