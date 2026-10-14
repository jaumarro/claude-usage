/**
 * Public release dates, as UTC midnight. The session logs cannot know when a model shipped,
 * only when it was first called here, so this table is the only source of the real date.
 * A model absent from the table falls back to its first use in the corpus.
 */
export const MODEL_RELEASES: Record<string, string> = {
  'claude-sonnet-5-5': '2026-09-28',
  'claude-opus-5-5': '2026-09-22',
  'claude-fable-5-1': '2026-09-01',
  'claude-mythos-5-1': '2026-09-01',
  'claude-opus-5': '2026-07-24',
  'claude-sonnet-5': '2026-06-30',
  'claude-fable-5': '2026-06-09',
  'claude-mythos-5': '2026-06-09',
  'claude-opus-4-8': '2026-05-28',
  'claude-opus-4-7': '2026-04-16',
  'claude-sonnet-4-6': '2026-02-17',
  'claude-opus-4-6': '2026-02-05',
  'claude-opus-4-5': '2025-11-24',
  'claude-haiku-4-5': '2025-10-15',
  'claude-sonnet-4-5': '2025-09-29',
  'claude-opus-4-1': '2025-08-05',
};

export function releaseMsFor(model: string): number | null {
  const date = MODEL_RELEASES[model];
  if (date === undefined) {
    return null;
  }
  return Date.parse(`${date}T00:00:00.000Z`);
}
