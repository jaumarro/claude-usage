import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as ingest } from '@/app/api/ingest/route';
import { GET as timeseries } from '@/app/api/usage/timeseries/route';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

const originalHome = process.env.HOME;
let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-usage-routes-'));
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

type Payload = { columns: { key: string }[]; rows: { day: string; model: string; tokens: number }[] };

async function readTimeseries(query: string): Promise<Payload> {
  const response = await timeseries(new Request(`http://localhost/api/usage/timeseries${query}`));
  expect(response.status).toBe(200);
  return response.json();
}

describe('POST /api/ingest', () => {
  it('reports the rows it added and adds nothing on a second run', async () => {
    placeFixture('wellformed.jsonl');

    const first = await ingest();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ rowsAdded: 2 });

    const second = await ingest();
    expect(await second.json()).toMatchObject({ rowsAdded: 0, bytesRead: 0 });
  });

  it('shares one run between requests that arrive while it is in flight', async () => {
    placeFixture('wellformed.jsonl');

    const [first, second] = await Promise.all([ingest(), ingest()]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ rowsAdded: 2 });
    expect(await second.json()).toMatchObject({ rowsAdded: 2 });
  });
});

describe('GET /api/usage/timeseries', () => {
  it('returns chart-ready columns and dedup-correct rows', async () => {
    placeFixture('multiline-request.jsonl');
    await ingest();

    const payload = await readTimeseries('?bucket=day&by=model');

    expect(payload.columns).toEqual([{ key: 'day' }, { key: 'model' }, { key: 'tokens' }]);
    expect(payload.rows).toEqual([{ day: '2026-09-04', model: 'claude-opus-5', tokens: 8468 }]);
  });

  it('defaults to a daily bucket split by model', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    expect(await readTimeseries('')).toEqual(await readTimeseries('?bucket=day&by=model'));
  });

  it('buckets by week when asked', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    const payload = await readTimeseries('?bucket=week&by=model');

    expect(payload.rows.map((row) => row.day)).toEqual(['2026-08-31', '2026-08-31']);
  });

  it('rejects an unknown bucket', async () => {
    const response = await timeseries(
      new Request('http://localhost/api/usage/timeseries?bucket=month'),
    );

    expect(response.status).toBe(400);
  });

  it('rejects a dimension this slice does not serve', async () => {
    const response = await timeseries(
      new Request('http://localhost/api/usage/timeseries?by=effort'),
    );

    expect(response.status).toBe(400);
  });
});
