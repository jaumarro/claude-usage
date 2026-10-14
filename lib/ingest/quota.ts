import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export type QuotaIngestResult = { read: number; upserted: number };

type QuotaSample = { t: number; org: string | null; fh: number | null; sd: number | null };

const UPSERT = `INSERT INTO quota_samples (t, org, fh_pct, sd_pct) VALUES (?, ?, ?, ?)
  ON CONFLICT(t) DO UPDATE SET org = excluded.org, fh_pct = excluded.fh_pct, sd_pct = excluded.sd_pct`;

export function quotaHistoryPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'Claude', 'plan-usage-history.json');
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function readSamples(path: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object') {
    return [];
  }
  const samples = (parsed as Record<string, unknown>).samples;
  if (!Array.isArray(samples)) {
    return [];
  }
  return samples;
}

function toSample(raw: unknown): QuotaSample | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const t = num(record.t);
  const usage = record.u;
  if (t === null || usage === null || typeof usage !== 'object') {
    return null;
  }
  const org = typeof record.org === 'string' ? record.org : null;
  const { fh, sd } = usage as Record<string, unknown>;
  return { t, org, fh: num(fh), sd: num(sd) };
}

export function ingestQuota(db: DatabaseSync, path = quotaHistoryPath()): QuotaIngestResult {
  const upsert = db.prepare(UPSERT);
  let read = 0;
  let upserted = 0;

  for (const raw of readSamples(path)) {
    const sample = toSample(raw);
    if (sample === null) {
      continue;
    }
    read += 1;
    upserted += Number(upsert.run(sample.t, sample.org, sample.fh, sample.sd).changes);
  }

  return { read, upserted };
}
