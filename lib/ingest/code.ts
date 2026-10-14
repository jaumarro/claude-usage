import { createReadStream, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export type UsageEvent = {
  uuid: string;
  requestId: string | null;
  ts: number;
  model: string | null;
  entrypoint: string | null;
  effort: string | null;
  sessionId: string | null;
  project: string | null;
  gitBranch: string | null;
  input: number;
  output: number;
  thinking: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cacheRead: number;
  serviceTier: string | null;
  ccVersion: string | null;
};

export type IngestResult = {
  filesScanned: number;
  filesRead: number;
  bytesRead: number;
  rowsAdded: number;
};

type JsonObject = Record<string, unknown>;

const NEWLINE = 0x0a;

const INSERT_EVENT = `INSERT OR IGNORE INTO usage_events (
  uuid, request_id, ts, model, entrypoint, effort, session_id, project, git_branch,
  input, output, thinking, cache_create_5m, cache_create_1h, cache_read,
  service_tier, cc_version
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPSERT_FILE = `INSERT INTO ingest_files (path, size, mtime, offset)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, offset = excluded.offset`;

export function defaultProjectsRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

function asObject(value: unknown): JsonObject | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.trunc(value);
}

export function parseUsageEvent(line: string): UsageEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  const record = asObject(parsed);
  if (record === null || record.type !== 'assistant') {
    return null;
  }

  const message = asObject(record.message);
  const usage = message === null ? null : asObject(message.usage);
  const uuid = asText(record.uuid);
  if (usage === null || uuid === null) {
    return null;
  }

  const timestamp = asText(record.timestamp);
  const parsedTs = timestamp === null ? Number.NaN : Date.parse(timestamp);
  const details = asObject(usage.output_tokens_details);
  const cacheCreation = asObject(usage.cache_creation);

  return {
    uuid,
    requestId: asText(record.requestId),
    ts: Number.isNaN(parsedTs) ? 0 : parsedTs,
    model: asText(message?.model),
    entrypoint: asText(record.entrypoint),
    effort: asText(record.effort),
    sessionId: asText(record.sessionId),
    project: asText(record.cwd),
    gitBranch: asText(record.gitBranch),
    input: asCount(usage.input_tokens),
    output: asCount(usage.output_tokens),
    thinking: asCount(details?.thinking_tokens),
    cacheCreate5m: asCount(cacheCreation?.ephemeral_5m_input_tokens),
    cacheCreate1h: asCount(cacheCreation?.ephemeral_1h_input_tokens),
    cacheRead: asCount(usage.cache_read_input_tokens),
    serviceTier: asText(usage.service_tier) ?? asText(record.service_tier),
    ccVersion: asText(record.version),
  };
}

async function listJsonlFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      paths.push(join(entry.parentPath, entry.name));
    }
  }
  return paths.sort();
}

type FileScan = { bytesRead: number; consumed: number };

/**
 * A trailing line with no newline is handed to `onLine` but never counted as consumed,
 * so a line still being written is re-read on the next run rather than lost.
 */
async function scanFrom(
  path: string,
  start: number,
  onLine: (line: string) => void,
): Promise<FileScan> {
  const stream = createReadStream(path, { start });
  let pending: Buffer = Buffer.alloc(0);
  let bytesRead = 0;
  let consumed = 0;

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    bytesRead += chunk.byteLength;
    pending = pending.byteLength === 0 ? chunk : Buffer.concat([pending, chunk]);
    let breakAt = pending.indexOf(NEWLINE);
    while (breakAt !== -1) {
      onLine(pending.subarray(0, breakAt).toString('utf8'));
      consumed += breakAt + 1;
      pending = pending.subarray(breakAt + 1);
      breakAt = pending.indexOf(NEWLINE);
    }
  }

  if (pending.byteLength > 0) {
    onLine(pending.toString('utf8'));
  }
  return { bytesRead, consumed };
}

export async function ingestCodeLogs(
  db: DatabaseSync,
  root: string = defaultProjectsRoot(),
): Promise<IngestResult> {
  const insertEvent = db.prepare(INSERT_EVENT);
  const upsertFile = db.prepare(UPSERT_FILE);
  const readState = db.prepare('SELECT size, offset FROM ingest_files WHERE path = ?');
  const paths = await listJsonlFiles(root);
  const result: IngestResult = {
    filesScanned: paths.length,
    filesRead: 0,
    bytesRead: 0,
    rowsAdded: 0,
  };

  for (const path of paths) {
    const stats = statSync(path);
    const state = readState.get(path);
    const knownSize = Number(state?.size ?? 0);
    const knownOffset = Number(state?.offset ?? 0);
    const start = stats.size >= knownSize ? knownOffset : 0;
    if (start >= stats.size) {
      continue;
    }

    let rowsAdded = 0;
    db.exec('BEGIN');
    const scan = await scanFrom(path, start, (line) => {
      const event = parseUsageEvent(line);
      if (event === null) {
        return;
      }
      const changes = insertEvent.run(
        event.uuid,
        event.requestId,
        event.ts,
        event.model,
        event.entrypoint,
        event.effort,
        event.sessionId,
        event.project,
        event.gitBranch,
        event.input,
        event.output,
        event.thinking,
        event.cacheCreate5m,
        event.cacheCreate1h,
        event.cacheRead,
        event.serviceTier,
        event.ccVersion,
      );
      rowsAdded += Number(changes.changes);
    });
    upsertFile.run(path, stats.size, Math.trunc(stats.mtimeMs), start + scan.consumed);
    db.exec('COMMIT');

    result.filesRead += 1;
    result.bytesRead += scan.bytesRead;
    result.rowsAdded += rowsAdded;
  }

  return result;
}
