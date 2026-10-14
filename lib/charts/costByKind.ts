import {
  SERIES_VIEWS,
  SERIES_VIEW_LABELS,
  barsFit,
  barsInput,
  seriesInput,
  type SeriesView,
  type TimeView,
} from '@/lib/charts/seriesViews';
import type { Bucket, TimeWindow } from '@/lib/queries/aggregate';

/**
 * What a token was billed as, the largest first so it stacks at the bottom. Output leaves out the
 * thinking inside it, which bills at the same rate: the two together are what the model generated.
 */
export const COST_KINDS = ['cache read', 'cache write', 'input', 'output', 'thinking'] as const;

export type CostKind = (typeof COST_KINDS)[number];

export type CostByKindRow = {
  day: string;
  kind: string;
  cost: number;
};

export const costByKindColumns = [{ key: 'day' }, { key: 'kind' }, { key: 'cost' }];

export function costByKindData(rows: CostByKindRow[]) {
  return { columns: costByKindColumns, rows };
}

const KEYS = { x: 'day', y: 'cost', color: 'kind' };

export function costByKindInputFor(view: TimeView, span?: TimeWindow) {
  return seriesInput(view, KEYS, span);
}

export function costByKindBarsInput(seriesOrder: readonly string[]) {
  return barsInput(KEYS, seriesOrder);
}

export type CostKindView = SeriesView | 'bars';

const WITH_BARS: readonly CostKindView[] = ['stacked', 'share', 'bars', 'donut'];

export const COST_KIND_VIEW_LABELS: Record<CostKindView, string> = { ...SERIES_VIEW_LABELS, bars: 'bars' };

/** Bars only where they fit; the series views draw at any bucket. */
export function costKindViewsFor(bucket: Bucket): readonly CostKindView[] {
  return barsFit(bucket) ? WITH_BARS : SERIES_VIEWS;
}
