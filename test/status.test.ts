import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db';
import { readStatus } from '@/lib/status';

const NOW = Date.parse('2026-09-04T12:00:00.000Z');
const HOUR = 3_600_000;

function tempDb(): DatabaseSync {
  return openDb(join(mkdtempSync(join(tmpdir(), 'claude-usage-status-')), 'usage.db'));
}

type StatuslineRow = {
  t: number;
  fh_pct?: number | null;
  fh_resets_at?: number | null;
  sd_pct?: number | null;
  sd_resets_at?: number | null;
  spend_pct?: number | null;
  spend_resets_at?: number | null;
};

function addStatusline(db: DatabaseSync, row: StatuslineRow): void {
  db.prepare(
    `INSERT INTO statusline_samples (t, session_id, fh_pct, fh_resets_at, sd_pct, sd_resets_at, spend_pct, spend_resets_at)
     VALUES (?, 'sess', ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.t,
    row.fh_pct ?? null,
    row.fh_resets_at ?? null,
    row.sd_pct ?? null,
    row.sd_resets_at ?? null,
    row.spend_pct ?? null,
    row.spend_resets_at ?? null,
  );
}

function addQuota(db: DatabaseSync, t: number, fh: number, sd: number): void {
  db.prepare('INSERT INTO quota_samples (t, org, fh_pct, sd_pct) VALUES (?, ?, ?, ?)').run(t, 'org', fh, sd);
}

describe('readStatus windows', () => {
  it('reports no reading at all on an empty database', () => {
    const db = tempDb();
    const status = readStatus(db, NOW);

    expect(status.five_hour).toBeNull();
    expect(status.seven_day).toBeNull();
    expect(status.spend_limit).toBeNull();
    expect(status.chart.rows).toEqual([]);
    db.close();
  });

  it('reports percentage, headroom, exact reset and staleness from a statusline sample', () => {
    const db = tempDb();
    addStatusline(db, {
      t: NOW - 90_000,
      fh_pct: 26.4,
      fh_resets_at: Math.floor((NOW + 2 * HOUR) / 1000),
      sd_pct: 62,
      sd_resets_at: Math.floor((NOW + 48 * HOUR) / 1000),
    });

    const status = readStatus(db, NOW);

    expect(status.five_hour).toEqual({
      used_percentage: 26.4,
      headroom_percentage: 73.6,
      resets_at: '2026-09-04T14:00:00.000Z',
      seconds_until_reset: 7200,
      source: 'statusline',
      captured_at: '2026-09-04T11:58:30.000Z',
      stale_seconds: 90,
    });
    expect(status.seven_day?.used_percentage).toBe(62);
    db.close();
  });

  it('falls back to plan-usage-history when the statusline log has never run', () => {
    const db = tempDb();
    addQuota(db, NOW - 600_000, 21, 60);

    const status = readStatus(db, NOW);

    expect(status.five_hour).toEqual({
      used_percentage: 21,
      headroom_percentage: 79,
      resets_at: null,
      seconds_until_reset: null,
      source: 'plan-usage-history',
      captured_at: '2026-09-04T11:50:00.000Z',
      stale_seconds: 600,
    });
    db.close();
  });

  it('prefers whichever source captured most recently', () => {
    const db = tempDb();
    addStatusline(db, { t: NOW - 3 * 24 * HOUR, fh_pct: 90, fh_resets_at: Math.floor((NOW - 2 * HOUR) / 1000) });
    addQuota(db, NOW - 60_000, 12, 55);

    expect(readStatus(db, NOW).five_hour).toMatchObject({
      used_percentage: 12,
      source: 'plan-usage-history',
      stale_seconds: 60,
    });
    db.close();
  });

  it('breaks a tie in favour of the exact statusline reading', () => {
    const db = tempDb();
    addStatusline(db, { t: NOW - 60_000, fh_pct: 26, fh_resets_at: Math.floor((NOW + HOUR) / 1000) });
    addQuota(db, NOW - 60_000, 12, 55);

    expect(readStatus(db, NOW).five_hour).toMatchObject({ used_percentage: 26, source: 'statusline' });
    db.close();
  });

  it('drops a reset time that has already passed rather than reporting it as upcoming', () => {
    const db = tempDb();
    addStatusline(db, { t: NOW - 60_000, fh_pct: 26, fh_resets_at: Math.floor((NOW - HOUR) / 1000) });

    expect(readStatus(db, NOW).five_hour).toMatchObject({ resets_at: null, seconds_until_reset: null });
    db.close();
  });

  it('reads each window independently when only one is present', () => {
    const db = tempDb();
    addStatusline(db, { t: NOW - 60_000, fh_pct: 97, fh_resets_at: Math.floor((NOW + HOUR) / 1000) });

    const status = readStatus(db, NOW);

    expect(status.five_hour?.used_percentage).toBe(97);
    expect(status.seven_day).toBeNull();
    expect(status.spend_limit).toBeNull();
    db.close();
  });

  it('reports the spend limit only from statusline samples', () => {
    const db = tempDb();
    addStatusline(db, { t: NOW - 60_000, spend_pct: 11.5, spend_resets_at: Math.floor((NOW + 5 * HOUR) / 1000) });

    expect(readStatus(db, NOW).spend_limit).toMatchObject({ used_percentage: 11.5, source: 'statusline' });
    db.close();
  });

  it('clamps headroom at zero once a window is exceeded', () => {
    const db = tempDb();
    addStatusline(db, { t: NOW, spend_pct: 137 });

    expect(readStatus(db, NOW).spend_limit?.headroom_percentage).toBe(0);
    db.close();
  });

  it('skips a sample whose window is null and uses the last one that had it', () => {
    const db = tempDb();
    addStatusline(db, { t: NOW - 120_000, sd_pct: 62, sd_resets_at: Math.floor((NOW + 48 * HOUR) / 1000) });
    addStatusline(db, { t: NOW - 60_000, fh_pct: 5, sd_pct: null });

    expect(readStatus(db, NOW).seven_day).toMatchObject({ used_percentage: 62, stale_seconds: 120 });
    db.close();
  });
});

describe('readStatus chart series', () => {
  it('unions both sources into one long series ordered by time', () => {
    const db = tempDb();
    addQuota(db, NOW - 2 * HOUR, 10, 50);
    addStatusline(db, { t: NOW - HOUR, fh_pct: 30, sd_pct: 55 });

    expect(readStatus(db, NOW).chart.rows).toEqual([
      { t: '2026-09-04T10:00:00.000Z', window: 'five_hour', pct: 10 },
      { t: '2026-09-04T10:00:00.000Z', window: 'seven_day', pct: 50 },
      { t: '2026-09-04T11:00:00.000Z', window: 'five_hour', pct: 30 },
      { t: '2026-09-04T11:00:00.000Z', window: 'seven_day', pct: 55 },
    ]);
    db.close();
  });

  it('honours the requested window of days', () => {
    const db = tempDb();
    addQuota(db, NOW - 30 * 24 * HOUR, 10, 50);
    addQuota(db, NOW - HOUR, 20, 60);

    const sevenDayRows = (days: number) =>
      readStatus(db, NOW, days).chart.rows.filter((row) => row.window === 'seven_day');
    expect(sevenDayRows(7)).toHaveLength(1);
    expect(sevenDayRows(60)).toHaveLength(2);
    db.close();
  });

  it('starts the series at a given time over the window of days', () => {
    const db = tempDb();
    addQuota(db, NOW - 3 * HOUR, 10, 50);
    addQuota(db, NOW - HOUR, 20, 60);

    const rows = readStatus(db, NOW, 7, NOW - 2 * HOUR).chart.rows.filter((row) => row.window === 'seven_day');

    expect(rows.map((row) => row.pct)).toEqual([60]);
    db.close();
  });

  it('drops five_hour to zero across a gap longer than its window, and leaves seven_day alone', () => {
    const db = tempDb();
    addQuota(db, NOW - 8 * HOUR, 40, 50);
    addQuota(db, NOW - HOUR, 10, 52);

    expect(readStatus(db, NOW).chart.rows).toEqual([
      { t: '2026-09-04T04:00:00.000Z', window: 'five_hour', pct: 40 },
      { t: '2026-09-04T04:00:00.000Z', window: 'seven_day', pct: 50 },
      { t: '2026-09-04T04:00:00.001Z', window: 'five_hour', pct: 0 },
      { t: '2026-09-04T10:59:59.999Z', window: 'five_hour', pct: 0 },
      { t: '2026-09-04T11:00:00.000Z', window: 'five_hour', pct: 10 },
      { t: '2026-09-04T11:00:00.000Z', window: 'seven_day', pct: 52 },
    ]);
    db.close();
  });

  it('collects distinct reset boundaries in range as epoch milliseconds', () => {
    const db = tempDb();
    const first = Math.floor((NOW - 5 * HOUR) / 1000);
    const second = Math.floor((NOW + HOUR) / 1000);
    addStatusline(db, { t: NOW - 6 * HOUR, fh_pct: 40, fh_resets_at: first });
    addStatusline(db, { t: NOW - 4 * HOUR, fh_pct: 10, fh_resets_at: second });
    addStatusline(db, { t: NOW - 2 * HOUR, fh_pct: 30, fh_resets_at: second });

    expect(readStatus(db, NOW).resets).toEqual([first * 1000, second * 1000]);
    db.close();
  });
});
