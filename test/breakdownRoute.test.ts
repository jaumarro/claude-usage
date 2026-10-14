import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST as ingest } from '@/app/api/ingest/route';
import { GET as breakdown } from '@/app/api/usage/breakdown/route';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

const originalHome = process.env.HOME;
let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-usage-breakdown-route-'));
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
  rows: { label: string; full: string; tokens: number }[];
};

function placeFixture(name: string): void {
  copyFileSync(join(FIXTURES, name), join(home, '.claude', 'projects', 'proj', name));
}

async function readBreakdown(query: string): Promise<Payload> {
  const response = await breakdown(new Request(`http://localhost/api/usage/breakdown${query}`));
  expect(response.status).toBe(200);
  return response.json();
}

describe('GET /api/usage/breakdown', () => {
  it('returns chart-ready columns and dedup-correct project totals', async () => {
    placeFixture('multiline-request.jsonl');
    await ingest();

    const payload = await readBreakdown('?by=project');

    expect(payload.columns).toEqual([{ key: 'label' }, { key: 'full' }, { key: 'tokens' }]);
    expect(payload.rows).toEqual([
      { label: '/Users/j/proj', full: '/Users/j/proj', tokens: 8468 },
    ]);
  });

  it('defaults to the project dimension', async () => {
    placeFixture('wellformed.jsonl');
    await ingest();

    expect(await readBreakdown('')).toEqual(await readBreakdown('?by=project'));
  });

  it('ranks every project by tokens', async () => {
    placeFixture('wellformed.jsonl');
    placeFixture('other-project.jsonl');
    await ingest();

    const payload = await readBreakdown('?by=project');

    expect(payload.rows).toEqual([
      { label: '/Users/j/proj', full: '/Users/j/proj', tokens: 2165 },
      { label: '/Users/j/other', full: '/Users/j/other', tokens: 111 },
    ]);
  });

  it('rejects a dimension this slice does not serve', async () => {
    const response = await breakdown(
      new Request('http://localhost/api/usage/breakdown?by=session'),
    );

    expect(response.status).toBe(400);
  });

  it('rejects a limit that is not a positive integer', async () => {
    const response = await breakdown(
      new Request('http://localhost/api/usage/breakdown?by=project&limit=0'),
    );

    expect(response.status).toBe(400);
  });

  it('honours a limit, keeping the heaviest project', async () => {
    placeFixture('wellformed.jsonl');
    placeFixture('other-project.jsonl');
    await ingest();

    const payload = await readBreakdown('?by=project&limit=1');

    expect(payload.rows).toEqual([
      { label: '/Users/j/proj', full: '/Users/j/proj', tokens: 2165 },
    ]);
  });
});
