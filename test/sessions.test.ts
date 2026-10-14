import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '@/lib/db';
import { sessionBlocks } from '@/lib/queries/sessions';

let db: DatabaseSync;

beforeEach(() => {
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
});

type Line = {
  uuid: string;
  request?: string;
  session: string;
  project: string;
  at: Date;
  output?: number;
  branch?: string | null;
};

function addLine({ uuid, request = `req_${uuid}`, session, project, at, output = 1, branch = null }: Line): void {
  db.prepare(
    `INSERT INTO usage_events (uuid, request_id, ts, model, session_id, project, git_branch, input, output,
      thinking, cache_create_5m, cache_create_1h, cache_read)
     VALUES (?, ?, ?, 'claude-opus-5', ?, ?, ?, 0, ?, 0, 0, 0, 0)`,
  ).run(uuid, request, at.getTime(), session, project, branch, output);
}

function addRequest(uuid: string, session: string, project: string, at: Date, branch: string | null = null): void {
  addLine({ uuid, session, project, at, branch });
}

function hourOf(hour: number) {
  return { from: new Date(2026, 8, 3, hour).getTime(), to: new Date(2026, 8, 3, hour + 1).getTime() };
}

describe('sessionBlocks', () => {
  it('lists one block per session and bucket it was active in, oldest session first', () => {
    addRequest('a1', 's1', '/work/alpha', new Date(2026, 8, 3, 10, 5));
    addRequest('a2', 's1', '/work/alpha', new Date(2026, 8, 3, 10, 20));
    addRequest('a3', 's2', '/work/alpha', new Date(2026, 8, 3, 10, 30));
    addRequest('b1', 's3', '/work/beta', new Date(2026, 8, 3, 11, 10));
    addRequest('a4', 's1', '/work/alpha', new Date(2026, 8, 3, 11, 40));

    const s1 = { session: 's1', project: 'alpha', branch: null };
    const s2 = { session: 's2', project: 'alpha', branch: null };
    const s3 = { session: 's3', project: 'beta', branch: null };
    expect(sessionBlocks(db, 'hour')).toEqual([
      { ...hourOf(10), ...s1, spent: 2 },
      { ...hourOf(11), ...s1, spent: 1 },
      { ...hourOf(10), ...s2, spent: 1 },
      { ...hourOf(11), ...s3, spent: 1 },
    ]);
  });

  it('files a session that changes folder under the folder it started in', () => {
    addRequest('m1', 's1', '/work/alpha', new Date(2026, 8, 3, 10, 5));
    addRequest('m2', 's1', '/work/alpha/node_modules/pkg', new Date(2026, 8, 3, 11, 15));

    expect(sessionBlocks(db, 'hour').map((block) => block.project)).toEqual(['alpha', 'alpha']);
  });

  it('names a session by the branch most of its requests came from, never a detached HEAD', () => {
    addRequest('m1', 's1', '/work/alpha', new Date(2026, 8, 3, 10, 1), 'main');
    addRequest('f1', 's1', '/work/alpha', new Date(2026, 8, 3, 10, 2), 'feat/edit');
    addRequest('f2', 's1', '/work/alpha', new Date(2026, 8, 3, 10, 3), 'feat/edit');
    addRequest('h1', 's1', '/work/alpha', new Date(2026, 8, 3, 10, 4), 'HEAD');
    addRequest('h2', 's1', '/work/alpha', new Date(2026, 8, 3, 10, 5), 'HEAD');
    addRequest('h3', 's1', '/work/alpha', new Date(2026, 8, 3, 10, 6), 'HEAD');
    addRequest('d1', 's2', '/work/beta', new Date(2026, 8, 3, 10, 7), 'HEAD');

    expect(sessionBlocks(db, 'hour').map((block) => block.branch)).toEqual(['feat/edit', null]);
  });

  it('counts a request logged over several lines once', () => {
    const at = new Date(2026, 8, 3, 10, 5);
    addLine({ uuid: 'l1', request: 'req_shared', session: 's1', project: '/work/alpha', at, output: 5 });
    addLine({ uuid: 'l2', request: 'req_shared', session: 's1', project: '/work/alpha', at, output: 5 });

    expect(sessionBlocks(db, 'hour').map((block) => block.spent)).toEqual([5]);
  });

  it('returns no blocks when nothing has been ingested', () => {
    expect(sessionBlocks(db, 'hour')).toEqual([]);
  });
});
