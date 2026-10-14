import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '@/lib/db';
import { ingestCodeLogs } from '@/lib/ingest/code';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');

function fixture(name: string): string {
  return join(FIXTURES, name);
}

let db: DatabaseSync;
let root: string;

beforeEach(() => {
  db = openDb(':memory:');
  root = mkdtempSync(join(tmpdir(), 'claude-usage-ingest-'));
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function place(fixtureName: string, relativePath: string): string {
  const target = join(root, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  copyFileSync(fixture(fixtureName), target);
  return target;
}

function countRows(): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM usage_events').get();
  return Number(row?.n);
}

describe('ingestCodeLogs', () => {
  it('keeps only assistant records that carry a usage block', async () => {
    place('wellformed.jsonl', 'proj-a/session.jsonl');

    const result = await ingestCodeLogs(db, root);

    expect(result.rowsAdded).toBe(2);
    expect(countRows()).toBe(2);
  });

  it('extracts every field from a well-formed record', async () => {
    place('wellformed.jsonl', 'proj-a/session.jsonl');
    await ingestCodeLogs(db, root);

    const row = db.prepare('SELECT * FROM usage_events WHERE uuid = ?').get('a-1');

    expect(row).toEqual({
      uuid: 'a-1',
      request_id: 'req_one',
      ts: Date.parse('2026-09-01T10:00:05.000Z'),
      model: 'claude-opus-5',
      entrypoint: 'cli',
      effort: 'high',
      session_id: 's-1',
      project: '/Users/j/proj',
      git_branch: 'main',
      input: 10,
      output: 100,
      thinking: 40,
      cache_create_5m: 200,
      cache_create_1h: 0,
      cache_read: 1000,
      service_tier: 'standard',
      cc_version: '2.1.246',
    });
  });

  it('skips a truncated final line without throwing', async () => {
    place('truncated.jsonl', 'proj-b/session.jsonl');

    const result = await ingestCodeLogs(db, root);

    expect(result.rowsAdded).toBe(2);
    const uuids = db
      .prepare('SELECT uuid FROM usage_events ORDER BY uuid')
      .all()
      .map((row) => row.uuid);
    expect(uuids).toEqual(['t-1', 't-2']);
  });

  it('leaves the byte offset before a truncated line so a later run picks it up', async () => {
    const path = place('truncated.jsonl', 'proj-b/session.jsonl');
    await ingestCodeLogs(db, root);

    const state = db.prepare('SELECT offset, size FROM ingest_files WHERE path = ?').get(path);
    const truncatedLineLength = readFileSync(fixture('truncated.jsonl'), 'utf8').split('\n')[2].length;
    expect(Number(state?.size) - Number(state?.offset)).toBe(truncatedLineLength);
  });

  it('stores one row per uuid, so re-running adds nothing', async () => {
    place('wellformed.jsonl', 'proj-a/session.jsonl');
    await ingestCodeLogs(db, root);

    const second = await ingestCodeLogs(db, root);

    expect(second.rowsAdded).toBe(0);
    expect(second.bytesRead).toBe(0);
    expect(countRows()).toBe(2);
  });

  it('keeps every line of a multi-line request, deduplication is a query concern', async () => {
    place('multiline-request.jsonl', 'proj-c/session.jsonl');

    const result = await ingestCodeLogs(db, root);

    expect(result.rowsAdded).toBe(3);
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM usage_events WHERE request_id = ?')
      .get('req_multi');
    expect(Number(row?.n)).toBe(3);
  });

  it('reads only the appended bytes when a file grows between runs', async () => {
    const path = place('growing-initial.jsonl', 'proj-d/session.jsonl');
    const first = await ingestCodeLogs(db, root);
    expect(first.rowsAdded).toBe(2);

    const appended = readFileSync(fixture('growing-appended.jsonl'));
    appendFileSync(path, appended);
    const second = await ingestCodeLogs(db, root);

    expect(second.bytesRead).toBe(appended.byteLength);
    expect(second.rowsAdded).toBe(1);
    expect(countRows()).toBe(3);
  });

  it('restarts from zero when a file shrinks', async () => {
    const path = place('growing-initial.jsonl', 'proj-d/session.jsonl');
    await ingestCodeLogs(db, root);
    place('growing-appended.jsonl', 'proj-d/session.jsonl');

    const second = await ingestCodeLogs(db, root);

    expect(second.bytesRead).toBe(readFileSync(path).byteLength);
    expect(countRows()).toBe(3);
  });

  it('walks nested project directories and ignores non-jsonl files', async () => {
    place('wellformed.jsonl', 'proj-a/session.jsonl');
    place('multiline-request.jsonl', 'proj-b/nested/session.jsonl');
    place('wellformed.jsonl', 'proj-b/notes.txt');

    const result = await ingestCodeLogs(db, root);

    expect(result.filesScanned).toBe(2);
    expect(countRows()).toBe(5);
  });
});
