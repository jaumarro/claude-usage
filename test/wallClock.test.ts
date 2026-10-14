import { describe, expect, it } from 'vitest';
import { wallClock, wallClockIso } from '@/lib/charts/wallClock';

describe('wallClock', () => {
  it('writes the local time as UTC, so the engine prints the hour the clock showed', () => {
    const tenInTheMorning = new Date(2026, 8, 15, 10, 30).getTime();

    expect(wallClockIso(tenInTheMorning)).toBe('2026-09-15T10:30:00.000Z');
  });

  it('follows the offset of each instant across a change of clocks', () => {
    const winter = new Date(2026, 11, 1, 9).getTime();

    expect(new Date(wallClock(winter)).getUTCHours()).toBe(9);
  });
});
