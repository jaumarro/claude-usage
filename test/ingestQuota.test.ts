import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db';
import { ingestQuota } from '@/lib/ingest/quota';

const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'claude-usage-quota-'));
}

function tempDb() {
  return openDb(join(scratch(), 'usage.db'));
}

function fixture(name: string): string {
  return join(FIXTURES, name);
}

describe('ingestQuota', () => {
  it('stores every well-formed sample keyed on its timestamp', () => {
    const db = tempDb();

    expect(ingestQuota(db, fixture('plan-usage-history.json'))).toEqual({ read: 7, upserted: 7 });
    expect(db.prepare('SELECT * FROM quota_samples ORDER BY t LIMIT 1').get()).toEqual({
      t: 1786015420346,
      org: '00000000-1111-2222-3333-444444444444',
      fh_pct: 0,
      sd_pct: 13,
    });
    expect(db.prepare('SELECT MAX(fh_pct) AS fh, MAX(sd_pct) AS sd FROM quota_samples').get()).toEqual({
      fh: 97,
      sd: 62,
    });
    db.close();
  });

  it('skips samples missing a timestamp or a usage object', () => {
    const db = tempDb();

    expect(ingestQuota(db, fixture('plan-usage-history-partial.json'))).toEqual({ read: 2, upserted: 2 });
    db.close();
  });

  it('upserts so a rolling buffer accumulates past its retention', () => {
    const db = tempDb();
    const older = join(scratch(), 'older.json');
    const newer = join(scratch(), 'newer.json');
    writeFileSync(
      older,
      JSON.stringify({
        version: 2,
        samples: [
          { t: 1, org: 'o', u: { fh: 1, sd: 2 } },
          { t: 2, org: 'o', u: { fh: 3, sd: 4 } },
        ],
      }),
    );
    writeFileSync(
      newer,
      JSON.stringify({
        version: 2,
        samples: [
          { t: 2, org: 'o', u: { fh: 9, sd: 4 } },
          { t: 3, org: 'o', u: { fh: 5, sd: 6 } },
        ],
      }),
    );

    ingestQuota(db, older);
    ingestQuota(db, newer);

    expect(db.prepare('SELECT t, fh_pct FROM quota_samples ORDER BY t').all()).toEqual([
      { t: 1, fh_pct: 1 },
      { t: 2, fh_pct: 9 },
      { t: 3, fh_pct: 5 },
    ]);
    db.close();
  });

  it('returns an empty result when the file is absent or unreadable', () => {
    const db = tempDb();

    expect(ingestQuota(db, join(scratch(), 'absent.json'))).toEqual({ read: 0, upserted: 0 });
    db.close();
  });

  it('returns an empty result when the file is not the expected shape', () => {
    const db = tempDb();
    const broken = join(scratch(), 'broken.json');
    writeFileSync(broken, '{ "version": 2, "samples": ');

    expect(ingestQuota(db, broken)).toEqual({ read: 0, upserted: 0 });
    db.close();
  });
});
