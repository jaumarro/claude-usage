import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as ingest } from '@/app/api/ingest/route';
import { GET as sessions } from '@/app/api/usage/sessions/route';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

const originalHome = process.env.HOME;
let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-usage-sessions-route-'));
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
  rows: { t: string; mid: string; session: string; bar: string; spent: number }[];
};

function placeFixture(name: string): void {
  copyFileSync(join(FIXTURES, name), join(home, '.claude', 'projects', 'proj', name));
}

async function readSessions(query: string): Promise<Payload> {
  const response = await sessions(new Request(`http://localhost/api/usage/sessions${query}`));
  expect(response.status).toBe(200);
  return response.json();
}

describe('GET /api/usage/sessions', () => {
  it('returns chart-ready columns and a segment per session and bucket', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    const payload = await readSessions('?bucket=day');

    expect(payload.columns).toEqual([
      { key: 't' },
      { key: 'mid' },
      { key: 'session' },
      { key: 'bar' },
      { key: 'spent' },
    ]);
    expect(payload.rows.map((row) => `${row.t} | ${row.bar}`)).toEqual([
      '2026-09-01T02:24:00.000Z | 0',
      '2026-09-01T21:36:00.000Z | 0',
      '2026-09-02T02:24:00.000Z | 1',
      '2026-09-02T21:36:00.000Z | 1',
    ]);
    // One session across both days, labelled once.
    expect(new Set(payload.rows.map((row) => row.session)).size).toBe(1);
  });

  it('rejects an unknown bucket', async () => {
    const response = await sessions(new Request('http://localhost/api/usage/sessions?bucket=month'));

    expect(response.status).toBe(400);
  });
});
