import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/status/route';

beforeAll(() => {
  process.env.CLAUDE_USAGE_DIR = mkdtempSync(join(tmpdir(), 'claude-usage-route-'));
});

describe('GET /api/status', () => {
  it('answers with both windows, reset markers and a chart-ready series', async () => {
    const response = await GET(new Request('http://localhost/api/status?days=30'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.days).toBe(30);
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(['now', 'days', 'five_hour', 'seven_day', 'spend_limit', 'resets', 'chart']),
    );
    expect(body.chart.columns.map((column: { key: string }) => column.key)).toEqual(['t', 'window', 'pct']);
    expect(Array.isArray(body.chart.rows)).toBe(true);
    expect(Array.isArray(body.resets)).toBe(true);
  });

  it('defaults and clamps the requested range', async () => {
    expect((await (await GET(new Request('http://localhost/api/status'))).json()).days).toBe(7);
    expect((await (await GET(new Request('http://localhost/api/status?days=nope'))).json()).days).toBe(7);
    expect((await (await GET(new Request('http://localhost/api/status?days=99999'))).json()).days).toBe(365);
  });
});
