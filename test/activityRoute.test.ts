import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as ingest } from '@/app/api/ingest/route';
import { GET as activity } from '@/app/api/usage/activity/route';
import { HOURS, WEEKDAYS } from '@/lib/charts/activityHeatmap';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

const originalHome = process.env.HOME;
let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-usage-activity-route-'));
  process.env.HOME = home;
});

afterAll(() => {
  process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  mkdirSync(join(home, '.claude', 'projects', 'proj'), { recursive: true });
});

afterEach(() => {
  rmSync(join(home, '.claude'), { recursive: true, force: true });
  rmSync(join(home, '.claude-usage'), { recursive: true, force: true });
});

type Payload = {
  columns: { key: string }[];
  rows: { day: string; hour: string; tokens: number }[];
};

function placeFixture(name: string): void {
  copyFileSync(join(FIXTURES, name), join(home, '.claude', 'projects', 'proj', name));
}

async function readActivity(query: string): Promise<Payload> {
  const response = await activity(new Request(`http://localhost/api/usage/activity${query}`));
  expect(response.status).toBe(200);
  return response.json();
}

describe('GET /api/usage/activity', () => {
  it('returns chart-ready columns and the whole 7 by 24 grid', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    const payload = await readActivity('?range=all');

    expect(payload.columns).toEqual([{ key: 'day' }, { key: 'hour' }, { key: 'tokens' }]);
    expect(payload.rows).toHaveLength(168);
    expect([...new Set(payload.rows.map((row) => row.day))]).toEqual([...WEEKDAYS]);
    expect([...new Set(payload.rows.map((row) => row.hour))]).toEqual(HOURS);
  });

  it('counts a multi-line request once', async () => {
    placeFixture('multiline-request.jsonl');
    await ingest();

    const payload = await readActivity('?range=all');
    const total = payload.rows.reduce((sum, row) => sum + row.tokens, 0);

    expect(total).toBe(8468);
  });

  it('drops the weekdays and hours the range does not reach', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    const payload = await readActivity('?range=today');
    const days = new Set(payload.rows.map((row) => row.day));
    const hours = new Set(payload.rows.map((row) => row.hour));

    // Today spans one weekday and only the hours elapsed so far; drawing the rest would
    // claim you never work then rather than that they are outside the window.
    expect(days.size).toBe(1);
    expect(hours.size).toBeLessThanOrEqual(24);
    expect(payload.rows).toHaveLength(days.size * hours.size);
  });

  it('keeps the full week once the range covers one', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    const payload = await readActivity('?range=30d');

    expect(new Set(payload.rows.map((row) => row.day)).size).toBe(7);
    expect(payload.rows).toHaveLength(168);
  });

  it('rejects an unknown range', async () => {
    const response = await activity(new Request('http://localhost/api/usage/activity?range=decade'));

    expect(response.status).toBe(400);
  });
});
