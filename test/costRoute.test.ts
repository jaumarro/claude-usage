import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as ingest } from '@/app/api/ingest/route';
import { GET as cost } from '@/app/api/usage/cost/route';
import { GET as costKinds } from '@/app/api/usage/cost/kinds/route';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

const originalHome = process.env.HOME;
let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-usage-cost-route-'));
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
  columns: { key: string }[];
  rows: { day: string; model: string; cost: number }[];
};

async function readCost(query: string): Promise<Payload> {
  const response = await cost(new Request(`http://localhost/api/usage/cost${query}`));
  expect(response.status).toBe(200);
  return response.json();
}

describe('GET /api/usage/cost', () => {
  it('returns chart-ready columns and dedup-correct dollars', async () => {
    placeFixture('multiline-request.jsonl');
    await ingest();

    const payload = await readCost('?bucket=day');

    expect(payload.columns).toEqual([{ key: 'day' }, { key: 'model' }, { key: 'cost' }]);
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0].day).toBe('2026-09-04');
    expect(payload.rows[0].model).toBe('claude-opus-5');
    expect(payload.rows[0].cost).toBeCloseTo(0.023285, 12);
  });

  it('defaults to a daily bucket', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    expect(await readCost('')).toEqual(await readCost('?bucket=day'));
  });

  it('buckets by week when asked', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    const payload = await readCost('?bucket=week');

    expect(payload.rows.map((row) => row.day)).toEqual(['2026-08-31', '2026-08-31']);
  });

  it('rejects an unknown bucket', async () => {
    const response = await cost(new Request('http://localhost/api/usage/cost?bucket=month'));

    expect(response.status).toBe(400);
  });
});

describe('GET /api/usage/cost/kinds', () => {
  it('returns chart-ready columns, every kind priced once per bucket', async () => {
    placeFixture('multiline-request.jsonl');
    await ingest();

    const response = await costKinds(new Request('http://localhost/api/usage/cost/kinds?bucket=day'));
    expect(response.status).toBe(200);
    const payload: { columns: { key: string }[]; rows: { day: string; kind: string; cost: number }[] } =
      await response.json();

    expect(payload.columns).toEqual([{ key: 'day' }, { key: 'kind' }, { key: 'cost' }]);
    expect(payload.rows.map((row) => row.kind)).toEqual(['cache read', 'cache write', 'input', 'output', 'thinking']);
    expect(payload.rows.reduce((sum, row) => sum + row.cost, 0)).toBeCloseTo(0.023285, 12);
  });

  it('rejects an unknown bucket', async () => {
    const response = await costKinds(new Request('http://localhost/api/usage/cost/kinds?bucket=month'));

    expect(response.status).toBe(400);
  });
});
