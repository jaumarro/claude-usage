import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = new URL('../scripts/statusline.mjs', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;

type Run = {
  status: number | null;
  stdout: string;
  stderr: string;
  dir: string;
  logPath: string;
};

function run(stdin: string, dir = mkdtempSync(join(tmpdir(), 'claude-usage-sl-'))): Run {
  const result = spawnSync(process.execPath, [SCRIPT], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_USAGE_DIR: dir },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    dir,
    logPath: join(dir, 'statusline.jsonl'),
  };
}

function runFixture(name: string): Run {
  return run(readFileSync(join(FIXTURES, name), 'utf8'));
}

function logRecords(result: Run): Array<Record<string, unknown>> {
  if (!existsSync(result.logPath)) {
    return [];
  }
  return readFileSync(result.logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const INPUTS = [
  ['full rate_limits', 'statusline-full.json'],
  ['rate_limits absent', 'statusline-no-rate-limits.json'],
  ['only five_hour', 'statusline-five-hour-only.json'],
  ['truncated json', 'statusline-truncated.json'],
] as const;

describe('statusline script survival', () => {
  for (const [label, fixture] of INPUTS) {
    it(`exits clean and prints on ${label}`, () => {
      const result = runFixture(fixture);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    });
  }

  it('exits clean and prints on empty stdin', () => {
    const result = run('');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  it('prints and never throws when the log directory cannot be written', () => {
    const result = run(readFileSync(join(FIXTURES, 'statusline-full.json'), 'utf8'), '/dev/null/nope');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
});

describe('statusline script output', () => {
  it('shows both windows when both are present', () => {
    const { stdout } = runFixture('statusline-full.json');

    expect(stdout).toContain('5h 26%');
    expect(stdout).toContain('7d 62%');
  });

  it('omits the missing window rather than printing a placeholder', () => {
    const { stdout } = runFixture('statusline-five-hour-only.json');

    expect(stdout).toContain('5h 97%');
    expect(stdout).not.toContain('7d');
  });

  it('still names the model when rate_limits is absent', () => {
    const { stdout } = runFixture('statusline-no-rate-limits.json');

    expect(stdout).toContain('Fable 5.1');
  });
});

describe('statusline script capture', () => {
  it('captures every interesting field from a full payload', () => {
    const result = runFixture('statusline-full.json');
    const [record] = logRecords(result);

    expect(typeof record.t).toBe('number');
    expect(record).toMatchObject({
      session_id: '3f8a1c2e-9b4d-4a71-8e0f-2c6d5b4a1093',
      fh_pct: 26.4,
      fh_resets_at: 1788523200,
      sd_pct: 62,
      sd_resets_at: 1788912000,
      spend_pct: 11.5,
      spend_resets_at: 1791158400,
      cache_hit_ratio: 0.926,
      cache_warm: 1,
      pr_number: 412,
      pr_review_state: 'changes_requested',
      worktree_branch: 'feat/quota-status',
    });
  });

  it('writes nulls for the absent window rather than dropping the sample', () => {
    const result = runFixture('statusline-five-hour-only.json');
    const [record] = logRecords(result);

    expect(record).toMatchObject({ fh_pct: 97, sd_pct: null, sd_resets_at: null, spend_pct: null });
  });

  it('derives the cache hit ratio when the payload omits it', () => {
    const result = runFixture('statusline-five-hour-only.json');
    const [record] = logRecords(result);

    expect(record.cache_hit_ratio).toBe(0);
    expect(record.cache_warm).toBe(0);
  });

  it('writes nothing when no rate-limit window is present', () => {
    expect(logRecords(runFixture('statusline-no-rate-limits.json'))).toEqual([]);
    expect(logRecords(runFixture('statusline-truncated.json'))).toEqual([]);
  });

  it('throttles repeated captures into the same log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-usage-sl-'));
    const payload = readFileSync(join(FIXTURES, 'statusline-full.json'), 'utf8');
    run(payload, dir);
    const second = run(payload, dir);

    expect(logRecords(second)).toHaveLength(1);
  });
});
