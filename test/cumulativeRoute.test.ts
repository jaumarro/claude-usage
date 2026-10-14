import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as ingest } from '@/app/api/ingest/route';
import { GET as cumulative } from '@/app/api/usage/cumulative/route';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

const originalHome = process.env.HOME;
let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-usage-cumulative-route-'));
  process.env.HOME = home;
  // The routes default to a range that ends now; pinned a few days past the September
  // fixtures, they stay inside it whatever day the suite runs.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-06T12:00:00.000Z') });
});

afterAll(() => {
  vi.useRealTimers();
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

function placeFixture(name: string): void {
  copyFileSync(join(FIXTURES, name), join(home, '.claude', 'projects', 'proj', name));
}

type Payload = {
  columns: { key: string; label: string }[];
  rows: { day: string; cost: number }[];
  days: number;
  thresholdUsd: number;
  crossing: { day: string; at: number } | null;
  unpricedTokens: number;
};

async function readCumulative(query: string): Promise<Payload> {
  const response = await cumulative(new Request(`http://localhost/api/usage/cumulative${query}`));
  expect(response.status).toBe(200);
  return response.json();
}

describe('GET /api/usage/cumulative', () => {
  it('returns chart-ready columns and a running dedup-correct total', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    const payload = await readCumulative('?bucket=day');

    expect(payload.columns).toEqual([
      { key: 'day', label: 'Bucket' },
      { key: 'cost', label: 'API equivalent' },
    ]);
    expect(payload.rows.map((row) => row.day)).toEqual(['2026-09-01', '2026-09-02']);
    expect(payload.rows[1].cost).toBeCloseTo(0.012975, 12);
    expect(payload.days).toBe(2);
    expect(payload.thresholdUsd).toBeCloseTo((200 * 2) / 30, 12);
    expect(payload.crossing).toBeNull();
  });

  it('defaults to a daily bucket', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    expect(await readCumulative('')).toEqual(await readCumulative('?bucket=day'));
  });

  it('clamps a bucket the range does not allow', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    expect(await readCumulative('?bucket=minute&range=all')).toEqual(
      await readCumulative('?bucket=day&range=all'),
    );
  });

  it('rejects an unknown bucket', async () => {
    const response = await cumulative(
      new Request('http://localhost/api/usage/cumulative?bucket=month'),
    );

    expect(response.status).toBe(400);
  });

  it('rejects an unknown range', async () => {
    const response = await cumulative(
      new Request('http://localhost/api/usage/cumulative?range=decade'),
    );

    expect(response.status).toBe(400);
  });
});
