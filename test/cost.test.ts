import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '@/lib/db';
import { ingestCodeLogs } from '@/lib/ingest/code';
import { costByKindSeries, costByModelSeries } from '@/lib/queries/cost';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

let db: DatabaseSync;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'claude-usage-cost-'));
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

function insertEvent(uuid: string, model: string, day: string, cacheRead: number): void {
  db.prepare(
    `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
      cache_create_5m, cache_create_1h, cache_read)
     VALUES (?, NULL, ?, ?, 0, 0, 0, 0, 0, ?)`,
  ).run(uuid, Date.parse(`${day}T00:00:00.000Z`), model, cacheRead);
}

describe('costByModelSeries', () => {
  it('prices a request spanning three lines once, at the maximum per token field', async () => {
    await ingest('multiline-request.jsonl');

    const series = costByModelSeries(db, 'day');

    expect(series.rows).toHaveLength(1);
    expect(series.rows[0].day).toBe('2026-09-04');
    expect(series.rows[0].model).toBe('claude-opus-5');
    expect(series.rows[0].cost).toBeCloseTo(0.023285, 12);
  });

  it('charges each token type at its own rate, per model', async () => {
    await ingest('wellformed.jsonl');

    const spent = costByModelSeries(db, 'day').rows.filter((row) => row.cost > 0);

    expect(spent.map((row) => [row.day, row.model])).toEqual([
      ['2026-09-01', 'claude-opus-5'],
      ['2026-09-02', 'claude-fable-5-1'],
    ]);
    expect(spent[0].cost).toBeCloseTo(0.0043, 12);
    expect(spent[1].cost).toBeCloseTo(0.008675, 12);
  });

  it('prices a dated model snapshot at its base model rate', () => {
    insertEvent('haiku-1', 'claude-haiku-4-5-20251001', '2026-08-28', 2_000_000);

    const series = costByModelSeries(db, 'day');

    expect(series.unpriced).toEqual([]);
    expect(series.rows[0].model).toBe('claude-haiku-4-5');
    expect(series.rows[0].cost).toBeCloseTo(0.2, 12);
  });

  it('surfaces an unknown model instead of pricing it at zero', () => {
    insertEvent('known-1', 'claude-opus-5', '2026-09-01', 1_000_000);
    insertEvent('mystery-1', 'claude-unreleased-9', '2026-09-01', 4_000);
    insertEvent('mystery-2', 'claude-unreleased-9', '2026-09-02', 6_000);

    const series = costByModelSeries(db, 'day');

    expect([...new Set(series.rows.map((row) => row.model))]).toEqual(['claude-opus-5']);
    expect(series.unpriced).toEqual([{ model: 'claude-unreleased-9', tokens: 10_000 }]);
  });

  it('excludes the synthetic model, which carries no tokens', () => {
    insertEvent('synthetic-1', '<synthetic>', '2026-09-01', 0);
    insertEvent('real-1', 'claude-opus-5', '2026-09-01', 1_000_000);

    const series = costByModelSeries(db, 'day');

    expect(series.rows.map((row) => row.model)).toEqual(['claude-opus-5']);
    expect(series.unpriced).toEqual([]);
  });

  it('preserves the day totals when the same rows are bucketed by week', async () => {
    await ingest('wellformed.jsonl');
    await ingest('multiline-request.jsonl');

    const byDay = costByModelSeries(db, 'day');
    const byWeek = costByModelSeries(db, 'week');
    const total = (rows: { cost: number }[]) => rows.reduce((sum, row) => sum + row.cost, 0);

    expect(byWeek.rows.map((row) => row.day)).toEqual(['2026-08-31', '2026-08-31']);
    expect(total(byWeek.rows)).toBeCloseTo(total(byDay.rows), 12);
  });

  it('returns an empty series when nothing has been ingested', () => {
    expect(costByModelSeries(db, 'day')).toEqual({ rows: [], unpriced: [] });
  });

  it('zero-fills idle days and models, so area and line views drop instead of bridging', () => {
    const insert = db.prepare(
      `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
        cache_create_5m, cache_create_1h, cache_read)
       VALUES (?, NULL, ?, ?, 0, 0, 0, 0, 0, 1000000)`,
    );
    insert.run('first', new Date(2026, 8, 1, 12).getTime(), 'claude-opus-5');
    insert.run('last', new Date(2026, 8, 3, 12).getTime(), 'claude-fable-5-1');

    const rows = costByModelSeries(db, 'day').rows.map((row) => [row.day, row.model, row.cost]);

    expect(rows).toEqual([
      ['2026-09-01', 'claude-fable-5-1', 0],
      ['2026-09-01', 'claude-opus-5', 0.5],
      ['2026-09-02', 'claude-fable-5-1', 0],
      ['2026-09-02', 'claude-opus-5', 0],
      ['2026-09-03', 'claude-fable-5-1', 0.25],
      ['2026-09-03', 'claude-opus-5', 0],
    ]);
  });
});

type Tokens = {
  input?: number;
  output?: number;
  thinking?: number;
  cacheRead?: number;
  write5m?: number;
  write1h?: number;
};

/** One request on claude-opus-5: $5 input, $25 output, $6.25 and $10 cache writes, $0.50 cache reads. */
function insertRequest(uuid: string, at: Date, tokens: Tokens): void {
  db.prepare(
    `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
      cache_create_5m, cache_create_1h, cache_read)
     VALUES (?, ?, ?, 'claude-opus-5', ?, ?, ?, ?, ?, ?)`,
  ).run(
    uuid,
    `req_${uuid}`,
    at.getTime(),
    tokens.input ?? 0,
    tokens.output ?? 0,
    tokens.thinking ?? 0,
    tokens.write5m ?? 0,
    tokens.write1h ?? 0,
    tokens.cacheRead ?? 0,
  );
}

function costsOn(day: string): Record<string, number> {
  const rows = costByKindSeries(db, 'day').filter((row) => row.day === day);
  return Object.fromEntries(rows.map((row) => [row.kind, row.cost]));
}

describe('costByKindSeries', () => {
  it('prices each kind at its own rate, with the thinking split out of the output', () => {
    insertRequest('a', new Date(2026, 8, 4, 12), {
      input: 1_000_000,
      output: 2_000_000,
      thinking: 500_000,
      cacheRead: 4_000_000,
      write5m: 1_000_000,
      write1h: 1_000_000,
    });

    expect(costsOn('2026-09-04')).toEqual({
      'cache read': 2,
      'cache write': 16.25,
      input: 5,
      output: 37.5,
      thinking: 12.5,
    });
  });

  it('caps the thinking at the output it is part of', () => {
    insertRequest('a', new Date(2026, 8, 4, 12), { output: 1_000_000, thinking: 3_000_000 });

    expect(costsOn('2026-09-04')).toMatchObject({ output: 0, thinking: 25 });
  });

  it('prices a request spanning three lines once, and adds up to what it cost by model', async () => {
    await ingest('multiline-request.jsonl');

    const total = costByKindSeries(db, 'day').reduce((sum, row) => sum + row.cost, 0);

    expect(total).toBeCloseTo(0.023285, 12);
  });

  it('zero-fills every kind in every bucket, so area views drop instead of bridging', () => {
    insertRequest('first', new Date(2026, 8, 1, 12), { cacheRead: 1_000_000 });
    insertRequest('last', new Date(2026, 8, 3, 12), { cacheRead: 1_000_000 });

    const rows = costByKindSeries(db, 'day');

    expect(rows.map((row) => row.day)).toEqual(
      ['2026-09-01', '2026-09-02', '2026-09-03'].flatMap((day) => Array.from({ length: 5 }, () => day)),
    );
    expect(rows.filter((row) => row.day === '2026-09-02').every((row) => row.cost === 0)).toBe(true);
  });
});
