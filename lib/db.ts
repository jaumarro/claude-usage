import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS usage_events (
    uuid TEXT PRIMARY KEY, request_id TEXT, ts INTEGER, model TEXT,
    entrypoint TEXT, effort TEXT, session_id TEXT, project TEXT, git_branch TEXT,
    input INTEGER, output INTEGER, thinking INTEGER,
    cache_create_5m INTEGER, cache_create_1h INTEGER, cache_read INTEGER,
    service_tier TEXT, cc_version TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_events(ts)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_events(model)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_events(project)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_entrypoint ON usage_events(entrypoint)`,
  `CREATE TABLE IF NOT EXISTS ingest_files (
    path TEXT PRIMARY KEY, size INTEGER, mtime INTEGER, offset INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS statusline_samples (
    t INTEGER PRIMARY KEY, session_id TEXT,
    fh_pct REAL, fh_resets_at INTEGER, sd_pct REAL, sd_resets_at INTEGER,
    spend_pct REAL, spend_resets_at INTEGER,
    cache_hit_ratio REAL, cache_warm INTEGER,
    pr_number INTEGER, pr_review_state TEXT, worktree_branch TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS quota_samples (
    t INTEGER PRIMARY KEY, org TEXT, fh_pct INTEGER, sd_pct INTEGER
  )`,
];

// The statusline collector reads the same variable, so one override relocates every file the
// app owns: the database, and the log the collector appends to.
export function usageDir(): string {
  const override = process.env.CLAUDE_USAGE_DIR;
  if (typeof override === 'string' && override !== '') {
    return override;
  }
  return join(homedir(), '.claude-usage');
}

export function dbPath(): string {
  const dir = usageDir();
  mkdirSync(dir, { recursive: true });
  return join(dir, 'usage.db');
}

export function openDb(path = dbPath()): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  for (const statement of MIGRATIONS) {
    db.exec(statement);
  }
  return db;
}
