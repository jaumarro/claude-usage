import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '@/lib/db';
import { readSummary } from '@/lib/queries/summary';

let db: DatabaseSync;

beforeEach(() => {
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
});

function insertOutput(uuid: string, ts: number, output: number): void {
  db.prepare(
    `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
      cache_create_5m, cache_create_1h, cache_read)
     VALUES (?, ?, ?, 'claude-opus-5', 0, ?, 0, 0, 0, 0)`,
  ).run(uuid, `req_${uuid}`, ts, output);
}

describe('readSummary', () => {
  it('measures value captured against the subscription for the whole period, idle days included', () => {
    insertOutput('first', new Date(2026, 8, 1, 12).getTime(), 1_000_000);
    insertOutput('last', new Date(2026, 8, 4, 12).getTime(), 1_000_000);

    const summary = readSummary(db);

    expect(summary.costUsd).toBeCloseTo(50, 12);
    expect(summary.thresholdUsd).toBeCloseTo((200 * 4) / 30, 12);
    expect(summary.planValueRatio).toBeCloseTo(1.875, 12);
  });

  it('reports no value captured when nothing has been ingested', () => {
    expect(readSummary(db).planValueRatio).toBe(0);
  });

  it('counts each session once and reports thinking as a share of output', () => {
    const insert = db.prepare(
      `INSERT INTO usage_events (uuid, request_id, ts, model, session_id, input, output, thinking,
        cache_create_5m, cache_create_1h, cache_read)
       VALUES (?, ?, 0, 'claude-opus-5', ?, 0, ?, ?, 0, 0, 0)`,
    );
    insert.run('a', 'req_a', 's1', 100, 40);
    insert.run('b', 'req_b', 's1', 100, 10);
    insert.run('c', 'req_c', 's2', 200, 0);

    const summary = readSummary(db);

    expect(summary.sessions).toBe(2);
    expect(summary.thinkingShare).toBeCloseTo(50 / 400, 12);
  });

  it('takes thinking and output at their maximum per request rather than summing its lines', () => {
    const insert = db.prepare(
      `INSERT INTO usage_events (uuid, request_id, ts, model, session_id, input, output, thinking,
        cache_create_5m, cache_create_1h, cache_read)
       VALUES (?, 'req_multi', 0, 'claude-opus-5', 's1', 0, ?, ?, 0, 0, 0)`,
    );
    insert.run('line-1', 50, 50);
    insert.run('line-2', 100, 20);

    expect(readSummary(db).thinkingShare).toBeCloseTo(50 / 100, 12);
  });

  it('leaves every quota window unread when no reading was stored', () => {
    expect(readSummary(db).windows).toEqual({ five_hour: null, seven_day: null, spend_limit: null });
  });
});
