import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dbPath, usageDir } from '@/lib/db';

const ORIGINAL = process.env.CLAUDE_USAGE_DIR;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.CLAUDE_USAGE_DIR;
    return;
  }
  process.env.CLAUDE_USAGE_DIR = ORIGINAL;
});

describe('usageDir', () => {
  it('defaults to ~/.claude-usage', () => {
    delete process.env.CLAUDE_USAGE_DIR;

    expect(usageDir()).toBe(join(homedir(), '.claude-usage'));
    expect(dbPath()).toBe(join(homedir(), '.claude-usage', 'usage.db'));
  });

  it('relocates the whole data directory when CLAUDE_USAGE_DIR is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-usage-dir-'));
    process.env.CLAUDE_USAGE_DIR = dir;

    expect(usageDir()).toBe(dir);
    expect(dbPath()).toBe(join(dir, 'usage.db'));
  });

  it('ignores an empty override', () => {
    process.env.CLAUDE_USAGE_DIR = '';

    expect(usageDir()).toBe(join(homedir(), '.claude-usage'));
  });
});
