import { describe, expect, it } from 'vitest';
import {
  RANGES,
  bucketStart,
  defaultBucketFor,
  isBucketAllowed,
  nextBucketStart,
  timeWindow,
} from '@/lib/queries/aggregate';

describe('defaultBucketFor', () => {
  it('opens every range on the finest bucket that keeps a chart near 150 points per series', () => {
    expect(defaultBucketFor('3h')).toBe('minute');
    expect(defaultBucketFor('today')).toBe('10m');
    expect(defaultBucketFor('3d')).toBe('hour');
    expect(defaultBucketFor('7d')).toBe('hour');
    expect(defaultBucketFor('30d')).toBe('day');
    expect(defaultBucketFor('90d')).toBe('day');
    expect(defaultBucketFor('all')).toBe('day');
  });

  it('only ever picks a bucket the range allows', () => {
    for (const range of RANGES) {
      expect(isBucketAllowed(range, defaultBucketFor(range)), range).toBe(true);
    }
  });
});

describe('bucketStart', () => {
  // A Thursday afternoon, local time.
  const at = new Date(2026, 9, 1, 15, 27, 42).getTime();

  it('opens each bucket where the SQL cuts it, in local time', () => {
    expect(bucketStart(at, 'minute')).toBe(new Date(2026, 9, 1, 15, 27).getTime());
    expect(bucketStart(at, 'hour')).toBe(new Date(2026, 9, 1, 15).getTime());
    expect(bucketStart(at, 'day')).toBe(new Date(2026, 9, 1).getTime());
    expect(bucketStart(at, 'week')).toBe(new Date(2026, 8, 28).getTime());
  });

  it('cuts ten-minute buckets on the epoch, as the SQL does', () => {
    expect(bucketStart(at, '10m') % 600_000).toBe(0);
    expect(at - bucketStart(at, '10m')).toBeLessThan(600_000);
  });
});

describe('nextBucketStart', () => {
  const hour = new Date(2026, 9, 1, 15).getTime();

  it('opens the next bucket one bucket on', () => {
    expect(nextBucketStart(hour, 'minute')).toBe(new Date(2026, 9, 1, 15, 1).getTime());
    expect(nextBucketStart(hour, '10m')).toBe(new Date(2026, 9, 1, 15, 10).getTime());
    expect(nextBucketStart(hour, 'hour')).toBe(new Date(2026, 9, 1, 16).getTime());
    expect(nextBucketStart(new Date(2026, 8, 28).getTime(), 'week')).toBe(new Date(2026, 9, 5).getTime());
  });

  it('opens the next day at local midnight across a change of clocks', () => {
    expect(nextBucketStart(new Date(2026, 9, 25).getTime(), 'day')).toBe(new Date(2026, 9, 26).getTime());
  });
});

describe('timeWindow', () => {
  const now = new Date(2026, 9, 1, 15, 27).getTime();

  it('spans from the bucket the range opens in to now', () => {
    expect(timeWindow('30d', 'day', now)).toEqual({ start: new Date(2026, 8, 1).getTime(), end: now });
  });

  it('has no fixed start for an unbounded range', () => {
    expect(timeWindow('all', 'day', now)).toEqual({ start: null, end: now });
  });
});
