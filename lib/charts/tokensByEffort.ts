import { seriesInput, type TimeView } from '@/lib/charts/seriesViews';
import type { TimeWindow } from '@/lib/queries/aggregate';

export type TokensByEffortRow = {
  day: string;
  effort: string;
  tokens: number;
};

export const tokensByEffortColumns = [{ key: 'day' }, { key: 'effort' }, { key: 'tokens' }];

/** The levels from least effort to most, then the requests that named none. */
export const EFFORT_LEVELS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max', 'unset'];

export function tokensByEffortData(rows: TokensByEffortRow[]) {
  return { columns: tokensByEffortColumns, rows };
}

export function tokensByEffortInputFor(view: TimeView, span?: TimeWindow) {
  return seriesInput(view, { x: 'day', y: 'tokens', color: 'effort' }, span);
}

export const tokensByEffortInput = tokensByEffortInputFor('stacked');
