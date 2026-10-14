import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '@/lib/db';
import { ingestCodeLogs } from '@/lib/ingest/code';
import { cumulativeCostSeries } from '@/lib/queries/cumulativeCost';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

let db: DatabaseSync;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'claude-usage-cumulative-'));
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

/** One million cache reads on opus-5 is exactly $0.50, which keeps the arithmetic readable. */
function insertHalfDollar(uuid: string, day: string): void {
  db.prepare(
    `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
      cache_create_5m, cache_create_1h, cache_read)
     VALUES (?, NULL, ?, 'claude-opus-5', 0, 0, 0, 0, 0, 1000000)`,
  ).run(uuid, Date.parse(`${day}T12:00:00.000Z`));
}

describe('cumulativeCostSeries', () => {
  it('counts a request spanning three lines once', async () => {
    await ingest('multiline-request.jsonl');

    const series = cumulativeCostSeries(db, 'day');

    expect(series.rows).toHaveLength(1);
    expect(series.rows[0].day).toBe('2026-09-04');
    expect(series.rows[0].cost).toBeCloseTo(0.023285, 12);
  });

  it('runs the total forward across buckets', async () => {
    await ingest('wellformed.jsonl');

    const series = cumulativeCostSeries(db, 'day');

    expect(series.rows.map((row) => row.day)).toEqual(['2026-09-01', '2026-09-02']);
    expect(series.rows[0].cost).toBeCloseTo(0.0043, 12);
    expect(series.rows[1].cost).toBeCloseTo(0.012975, 12);
  });

  it('pro-rates the subscription over the days the data spans', () => {
    insertHalfDollar('a', '2026-09-01');
    insertHalfDollar('b', '2026-09-15');

    const series = cumulativeCostSeries(db, 'day');

    expect(series.days).toBe(15);
    expect(series.thresholdUsd).toBeCloseTo(100, 12);
  });

  it("caps the span at a bounded range's exact length, so thirty days cost one month", () => {
    const since = new Date(2026, 8, 1, 6).getTime();
    const now = since + 30 * 86_400_000;
    const insert = db.prepare(
      `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
        cache_create_5m, cache_create_1h, cache_read)
       VALUES (?, NULL, ?, 'claude-opus-5', 0, 0, 0, 0, 0, 1000000)`,
    );
    insert.run('first', new Date(2026, 8, 1, 7).getTime());
    insert.run('last', new Date(2026, 9, 1, 5).getTime());

    const series = cumulativeCostSeries(db, 'day', { since, surface: 'all' }, now);

    expect(series.days).toBeCloseTo(30, 12);
    expect(series.thresholdUsd).toBeCloseTo(200, 12);
  });

  it('reports the bucket where the running total first reaches the line', () => {
    for (let index = 0; index < 30; index += 1) {
      insertHalfDollar(`day-${index}`, `2026-09-${String(index + 1).padStart(2, '0')}`);
    }

    const series = cumulativeCostSeries(db, 'day');

    // 30 days spanned prices the line at the full $200, which $0.50 a day never reaches.
    expect(series.thresholdUsd).toBeCloseTo(200, 12);
    expect(series.crossing).toBeNull();
  });

  it('marks the crossing with both the bucket label and its epoch milliseconds', () => {
    insertHalfDollar('cheap', '2026-09-01');
    db.prepare(
      `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
        cache_create_5m, cache_create_1h, cache_read)
       VALUES ('big', NULL, ?, 'claude-opus-5', 0, 0, 0, 0, 0, 400000000)`,
    ).run(Date.parse('2026-09-02T12:00:00.000Z'));

    const series = cumulativeCostSeries(db, 'day');

    expect(series.thresholdUsd).toBeCloseTo((200 * 2) / 30, 12);
    expect(series.crossing).toEqual({ day: '2026-09-02', at: Date.parse('2026-09-02') });
  });

  it('surfaces tokens it could not price rather than folding them in at zero', () => {
    insertHalfDollar('known', '2026-09-01');
    db.prepare(
      `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
        cache_create_5m, cache_create_1h, cache_read)
       VALUES ('mystery', NULL, ?, 'claude-unreleased-9', 0, 0, 0, 0, 0, 7000)`,
    ).run(Date.parse('2026-09-01T13:00:00.000Z'));

    const series = cumulativeCostSeries(db, 'day');

    expect(series.unpricedTokens).toBe(7000);
    expect(series.rows[0].cost).toBeCloseTo(0.5, 12);
  });

  it('returns an empty series when nothing has been ingested', () => {
    expect(cumulativeCostSeries(db, 'day')).toEqual({
      rows: [],
      days: 0,
      thresholdUsd: 0,
      crossing: null,
      unpricedTokens: 0,
    });
  });
});
