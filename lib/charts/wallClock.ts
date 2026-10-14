/**
 * The chart engine prints every date in UTC. A chart's instants are therefore handed to it as the
 * local wall clock written as UTC: 10:00 here becomes 10:00Z, which the engine prints as 10:00.
 */
export function wallClock(ms: number): number {
  return ms - new Date(ms).getTimezoneOffset() * 60_000;
}

export function wallClockIso(ms: number): string {
  return new Date(wallClock(ms)).toISOString();
}
