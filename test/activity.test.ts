import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { HOURS, WEEKDAYS, type ActivityHeatmapRow } from '@/lib/charts/activityHeatmap';
import { openDb } from '@/lib/db';
import { ingestCodeLogs } from '@/lib/ingest/code';
import { activityByHourOfWeek } from '@/lib/queries/activity';
import { tokensByModelSeries } from '@/lib/queries/timeseries';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

let db: DatabaseSync;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'claude-usage-activity-'));
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

function insertEvent(uuid: string, at: number, tokens: number): void {
  db.prepare(
    `INSERT INTO usage_events (uuid, request_id, ts, model, input, output, thinking,
      cache_create_5m, cache_create_1h, cache_read)
     VALUES (?, ?, ?, 'claude-opus-5', ?, 0, 0, 0, 0, 0)`,
  ).run(uuid, uuid, at, tokens);
}

function cellAt(rows: ActivityHeatmapRow[], day: string, hour: string): ActivityHeatmapRow {
  const cell = rows.find((row) => row.day === day && row.hour === hour);
  if (cell === undefined) {
    throw new Error(`no cell for ${day} ${hour}`);
  }
  return cell;
}

/** Where a timestamp lands once the machine's own offset is applied, as SQLite's `localtime` would. */
function localCell(at: number): { day: string; hour: string } {
  const local = new Date(at);
  const day = WEEKDAYS[(local.getDay() + 6) % 7];
  return { day, hour: `${String(local.getHours()).padStart(2, '0')}:00` };
}

function totalOf(rows: { tokens: number }[]): number {
  return rows.reduce((sum, row) => sum + row.tokens, 0);
}

describe('activityByHourOfWeek', () => {
  it('returns all 168 cells of the week for an unbounded range', () => {
    const rows = activityByHourOfWeek(db);

    expect(rows).toHaveLength(168);
    expect(totalOf(rows)).toBe(0);
  });

  it('carries every weekday and every hour exactly once', () => {
    const rows = activityByHourOfWeek(db);

    expect([...new Set(rows.map((row) => row.day))]).toEqual([...WEEKDAYS]);
    expect([...new Set(rows.map((row) => row.hour))]).toEqual(HOURS);
  });

  it('zero-fills the hours that saw no traffic', async () => {
    await ingest('wellformed.jsonl');

    const rows = activityByHourOfWeek(db);

    expect(rows).toHaveLength(168);
    expect(rows.filter((row) => row.tokens > 0)).toHaveLength(2);
  });

  it('buckets a timestamp by local hour and local weekday, not by UTC', () => {
    const at = Date.UTC(2026, 8, 4, 22, 30, 0);
    insertEvent('local-1', at, 4321);

    const rows = activityByHourOfWeek(db);

    const { day, hour } = localCell(at);
    expect(cellAt(rows, day, hour).tokens).toBe(4321);
    expect(totalOf(rows)).toBe(4321);
  });

  it('rolls an event over the local midnight into the next weekday', () => {
    const at = Date.UTC(2026, 8, 6, 23, 30, 0);
    insertEvent('local-2', at, 99);

    const rows = activityByHourOfWeek(db);

    const { day, hour } = localCell(at);
    expect(cellAt(rows, day, hour).tokens).toBe(99);
  });

  it('counts a request spanning three lines once, at the maximum per token field', async () => {
    await ingest('multiline-request.jsonl');

    expect(totalOf(activityByHourOfWeek(db))).toBe(8468);
  });

  it('totals the same as the model series, so the grid adds no tokens of its own', async () => {
    await ingest('wellformed.jsonl');
    await ingest('multiline-request.jsonl');

    expect(totalOf(activityByHourOfWeek(db))).toBe(totalOf(tokensByModelSeries(db, 'day')));
  });

  it('honours the range filter', () => {
    const older = Date.UTC(2026, 7, 3, 9, 0, 0);
    const newer = Date.UTC(2026, 8, 3, 9, 0, 0);
    insertEvent('old-1', older, 700);
    insertEvent('new-1', newer, 30);

    const now = newer + 86_400_000;
    const rows = activityByHourOfWeek(db, { since: newer - 1, surface: 'all' }, 'hour', now);

    expect(totalOf(rows)).toBe(30);
    // A day-long window touches two dates in any timezone: whole days, and nothing wider.
    const days = new Set(rows.map((row) => row.day));
    expect(days.size).toBe(2);
    expect(rows).toHaveLength(days.size * HOURS.length);
  });
});
