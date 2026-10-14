import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '@/lib/db';
import { ingestCodeLogs } from '@/lib/ingest/code';
import { ellipsizePath, isBreakdownDimension, projectTotals, shortenProject } from '@/lib/queries/breakdown';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

let db: DatabaseSync;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'claude-usage-breakdown-'));
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

async function ingest(fixtureName: string): Promise<void> {
  const target = join(root, fixtureName.replace('.jsonl', ''), 'session.jsonl');
  mkdirSync(join(target, '..'), { recursive: true });
  copyFileSync(join(FIXTURES, fixtureName), target);
  await ingestCodeLogs(db, root);
}

function insertEvent(uuid: string, requestId: string, project: string, tokens: number): void {
  db.prepare(
    `INSERT INTO usage_events (uuid, request_id, ts, model, project, git_branch,
      input, output, thinking, cache_create_5m, cache_create_1h, cache_read)
     VALUES (?, ?, 0, 'claude-opus-5', ?, 'main', 0, ?, 0, 0, 0, 0)`,
  ).run(uuid, requestId, project, tokens);
}

describe('shortenProject', () => {
  it('strips the projects root so the display name is the project itself', () => {
    expect(shortenProject(join(homedir(), 'projects', 'claude-usage'))).toBe('claude-usage');
  });

  it('keeps enough of a worktree path to tell branches apart', () => {
    const path = join(homedir(), 'projects', 'worktrees', 'monorepo', 'feat-overlay-menus');
    expect(shortenProject(path)).toBe('worktrees/monorepo/feat-overlay-menus');
  });

  it('leaves a path outside the projects root alone', () => {
    expect(shortenProject('/etc/somewhere')).toBe('/etc/somewhere');
  });
});

describe('ellipsizePath', () => {
  it('leaves a path that fits alone', () => {
    expect(ellipsizePath('worktrees/monorepo/friendly-hugle-c23901')).toBe(
      'worktrees/monorepo/friendly-hugle-c23901',
    );
  });

  it('keeps the first segment and as many trailing ones as fit', () => {
    expect(ellipsizePath('monorepo/.claude/issues/point-and-edit/poc-2/assets')).toBe(
      'monorepo/…/point-and-edit/poc-2/assets',
    );
    expect(
      ellipsizePath('claude-usage/node_modules/.pnpm/@graphysdk+react-renderer@2.0.0/node_modules/@graphysdk/react-renderer/dist'),
    ).toBe('claude-usage/…/react-renderer/dist');
  });

  it('cuts a single segment too long to fit from the front, keeping its end', () => {
    const label = ellipsizePath('worktree-agent-a32226277740316dd-with-a-much-longer-tail');
    expect(label).toHaveLength(40);
    expect(label.startsWith('…')).toBe(true);
    expect(label.endsWith('much-longer-tail')).toBe(true);
  });
});

describe('isBreakdownDimension', () => {
  it('accepts the one dimension this slice serves', () => {
    expect(isBreakdownDimension('project')).toBe(true);
    expect(isBreakdownDimension('branch')).toBe(false);
  });
});

describe('projectTotals', () => {
  it('counts a request spanning three lines once, at the maximum per token field', async () => {
    await ingest('multiline-request.jsonl');

    expect(projectTotals(db)).toEqual([
      { label: '/Users/j/proj', full: '/Users/j/proj', tokens: 8468 },
    ]);
  });

  it('ranks projects by tokens, largest first', () => {
    insertEvent('p-1', 'req_a', '/work/small', 10);
    insertEvent('p-2', 'req_b', '/work/large', 90);
    insertEvent('p-3', 'req_c', '/work/large', 5);

    expect(projectTotals(db)).toEqual([
      { label: '/work/large', full: '/work/large', tokens: 95 },
      { label: '/work/small', full: '/work/small', tokens: 10 },
    ]);
  });

  it('shortens the label for display while keeping the full path on the row', () => {
    const full = join(homedir(), 'projects', 'claude-usage');
    insertEvent('p-4', 'req_d', full, 42);

    expect(projectTotals(db)).toEqual([{ label: 'claude-usage', full, tokens: 42 }]);
  });

  it('keeps only the top projects when a limit is given', () => {
    insertEvent('p-5', 'req_e', '/work/a', 30);
    insertEvent('p-6', 'req_f', '/work/b', 20);
    insertEvent('p-7', 'req_g', '/work/c', 10);

    expect(projectTotals(db, 2).map((row) => row.full)).toEqual(['/work/a', '/work/b']);
  });

  it('returns nothing when no events are stored', () => {
    expect(projectTotals(db)).toEqual([]);
  });
});
