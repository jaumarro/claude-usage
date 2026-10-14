import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { usageDir } from '@/lib/db';

export type IngestResult = { read: number; inserted: number };

type Sample = {
  t: number;
  session_id: string | null;
  fh_pct: number | null;
  fh_resets_at: number | null;
  sd_pct: number | null;
  sd_resets_at: number | null;
  spend_pct: number | null;
  spend_resets_at: number | null;
  cache_hit_ratio: number | null;
  cache_warm: number | null;
  pr_number: number | null;
  pr_review_state: string | null;
  worktree_branch: string | null;
};

const INSERT = `INSERT OR IGNORE INTO statusline_samples (
  t, session_id, fh_pct, fh_resets_at, sd_pct, sd_resets_at, spend_pct, spend_resets_at,
  cache_hit_ratio, cache_warm, pr_number, pr_review_state, worktree_branch
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function statuslineLogPath(): string {
  return join(usageDir(), 'statusline.jsonl');
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  return null;
}

function parseLine(line: string): Sample | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const t = num(record.t);
  if (t === null) {
    return null;
  }
  return {
    t,
    session_id: text(record.session_id),
    fh_pct: num(record.fh_pct),
    fh_resets_at: num(record.fh_resets_at),
    sd_pct: num(record.sd_pct),
    sd_resets_at: num(record.sd_resets_at),
    spend_pct: num(record.spend_pct),
    spend_resets_at: num(record.spend_resets_at),
    cache_hit_ratio: num(record.cache_hit_ratio),
    cache_warm: num(record.cache_warm),
    pr_number: num(record.pr_number),
    pr_review_state: text(record.pr_review_state),
    worktree_branch: text(record.worktree_branch),
  };
}

function readLog(path: string): string[] {
  try {
    return readFileSync(path, 'utf8').split('\n');
  } catch {
    return [];
  }
}

export function ingestStatusline(db: DatabaseSync, path = statuslineLogPath()): IngestResult {
  const insert = db.prepare(INSERT);
  let read = 0;
  let inserted = 0;

  for (const line of readLog(path)) {
    if (line.trim() === '') {
      continue;
    }
    const sample = parseLine(line);
    if (sample === null) {
      continue;
    }
    read += 1;
    const outcome = insert.run(
      sample.t,
      sample.session_id,
      sample.fh_pct,
      sample.fh_resets_at,
      sample.sd_pct,
      sample.sd_resets_at,
      sample.spend_pct,
      sample.spend_resets_at,
      sample.cache_hit_ratio,
      sample.cache_warm,
      sample.pr_number,
      sample.pr_review_state,
      sample.worktree_branch,
    );
    inserted += Number(outcome.changes);
  }

  return { read, inserted };
}
