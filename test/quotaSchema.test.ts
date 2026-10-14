import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db';

function tempDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'claude-usage-')), 'usage.db'));
}

function columnNames(table: string): string[] {
  const db = tempDb();
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  db.close();
  return rows.map((row) => String(row.name));
}

describe('quota schema', () => {
  it('creates statusline_samples with every captured field', () => {
    expect(columnNames('statusline_samples')).toEqual([
      't',
      'session_id',
      'fh_pct',
      'fh_resets_at',
      'sd_pct',
      'sd_resets_at',
      'spend_pct',
      'spend_resets_at',
      'cache_hit_ratio',
      'cache_warm',
      'pr_number',
      'pr_review_state',
      'worktree_branch',
    ]);
  });

  it('creates quota_samples keyed on timestamp', () => {
    expect(columnNames('quota_samples')).toEqual(['t', 'org', 'fh_pct', 'sd_pct']);
  });

  it('is idempotent across repeated opens', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'claude-usage-')), 'usage.db');
    const first = openDb(path);
    first.prepare('INSERT INTO quota_samples (t, org, fh_pct, sd_pct) VALUES (?, ?, ?, ?)').run(1, 'o', 5, 6);
    first.close();

    const second = openDb(path);
    const row = second.prepare('SELECT fh_pct FROM quota_samples WHERE t = 1').get();
    second.close();

    expect(row).toEqual({ fh_pct: 5 });
  });
});
