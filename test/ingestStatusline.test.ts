import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db';
import { ingestStatusline } from '@/lib/ingest/statusline';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'claude-usage-ingest-'));
}

function tempDb() {
  return openDb(join(scratch(), 'usage.db'));
}

function writeLog(lines: string[]): string {
  const path = join(scratch(), 'statusline.jsonl');
  writeFileSync(path, lines.map((line) => `${line}\n`).join(''));
  return path;
}

const FULL = JSON.stringify({
  t: 1788509746265,
  session_id: 'sess-a',
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

const PARTIAL = JSON.stringify({
  t: 1788509756265,
  session_id: 'sess-b',
  fh_pct: 97,
  fh_resets_at: 1788523200,
  sd_pct: null,
  sd_resets_at: null,
  spend_pct: null,
  spend_resets_at: null,
  cache_hit_ratio: null,
  cache_warm: null,
  pr_number: null,
  pr_review_state: null,
  worktree_branch: null,
});

describe('ingestStatusline', () => {
  it('stores every field of a full record', () => {
    const db = tempDb();

    expect(ingestStatusline(db, writeLog([FULL]))).toEqual({ read: 1, inserted: 1 });
    expect(db.prepare('SELECT * FROM statusline_samples').get()).toEqual({
      t: 1788509746265,
      session_id: 'sess-a',
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
    db.close();
  });

  it('keeps nulls for an absent window', () => {
    const db = tempDb();
    ingestStatusline(db, writeLog([PARTIAL]));

    expect(db.prepare('SELECT sd_pct, spend_pct, cache_warm FROM statusline_samples').get()).toEqual({
      sd_pct: null,
      spend_pct: null,
      cache_warm: null,
    });
    db.close();
  });

  it('skips malformed and truncated lines without failing the run', () => {
    const db = tempDb();

    const result = ingestStatusline(db, writeLog([FULL, '{"t": 1, "fh_pct"', 'not json at all', '[]', PARTIAL]));

    expect(result).toEqual({ read: 2, inserted: 2 });
    db.close();
  });

  it('skips records with no usable timestamp', () => {
    const db = tempDb();

    expect(ingestStatusline(db, writeLog(['{"session_id":"x","fh_pct":10}']))).toEqual({ read: 0, inserted: 0 });
    db.close();
  });

  it('is idempotent when the same log is ingested twice', () => {
    const db = tempDb();
    const path = writeLog([FULL, PARTIAL]);

    ingestStatusline(db, path);
    const second = ingestStatusline(db, path);

    expect(second).toEqual({ read: 2, inserted: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM statusline_samples').get()).toEqual({ n: 2 });
    db.close();
  });

  it('returns an empty result when the log does not exist yet', () => {
    const db = tempDb();

    expect(ingestStatusline(db, join(scratch(), 'absent.jsonl'))).toEqual({ read: 0, inserted: 0 });
    db.close();
  });
});
