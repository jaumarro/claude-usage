import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as ingest } from '@/app/api/ingest/route';
import { GET as effort } from '@/app/api/usage/effort/route';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

const originalHome = process.env.HOME;
let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-usage-effort-route-'));
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

type Payload = {
  columns: { key: string }[];
  rows: { day: string; effort: string; tokens: number }[];
};

function placeFixture(name: string): void {
  copyFileSync(join(FIXTURES, name), join(home, '.claude', 'projects', 'proj', name));
}

async function readEffort(query: string): Promise<Payload> {
  const response = await effort(new Request(`http://localhost/api/usage/effort${query}`));
  expect(response.status).toBe(200);
  return response.json();
}

describe('GET /api/usage/effort', () => {
  it('returns chart-ready columns and dedup-correct rows', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    const payload = await readEffort('?bucket=day');

    expect(payload.columns).toEqual([{ key: 'day' }, { key: 'effort' }, { key: 'tokens' }]);
    expect(payload.rows).toEqual([
      { day: '2026-09-01', effort: 'high', tokens: 1310 },
      { day: '2026-09-01', effort: 'max', tokens: 0 },
      { day: '2026-09-02', effort: 'high', tokens: 0 },
      { day: '2026-09-02', effort: 'max', tokens: 855 },
    ]);
  });

  it('defaults to a daily bucket', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    expect(await readEffort('')).toEqual(await readEffort('?bucket=day'));
  });

  it('buckets by week when asked', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    const payload = await readEffort('?bucket=week');

    expect(payload.rows.map((row) => row.day)).toEqual(['2026-08-31', '2026-08-31']);
  });

  it('rejects an unknown bucket', async () => {
    const response = await effort(new Request('http://localhost/api/usage/effort?bucket=month'));

    expect(response.status).toBe(400);
  });
});
