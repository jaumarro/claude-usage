import { seriesInput, type TimeView } from '@/lib/charts/seriesViews';
import type { TimeWindow } from '@/lib/queries/aggregate';

export type CostByModelRow = {
  day: string;
  model: string;
  cost: number;
};

export const costByModelColumns = [{ key: 'day' }, { key: 'model' }, { key: 'cost' }];

export function costByModelData(rows: CostByModelRow[]) {
  return { columns: costByModelColumns, rows };
}

export function costByModelInputFor(view: TimeView, span?: TimeWindow) {
  return seriesInput(view, { x: 'day', y: 'cost', color: 'model' }, span);
}

export const costByModelInput = costByModelInputFor('stacked');
