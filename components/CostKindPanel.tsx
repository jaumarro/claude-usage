'use client';

import { Chart } from '@/components/Chart';
import { DonutChart } from '@/components/DonutChart';
import { useFilters } from '@/components/Filters';
import { Loading, Panel } from '@/components/Shell';
import { StackedBars } from '@/components/StackedBars';
import { rowsParser, useLiveData } from '@/components/useLiveData';
import { ViewToggle, usePanelView } from '@/components/ViewToggle';
import { seriesOrderOf, totalsBy } from '@/lib/charts/categoryShare';
import {
  COST_KIND_VIEW_LABELS,
  costByKindBarsInput,
  costByKindData,
  costByKindInputFor,
  costKindViewsFor,
  type CostByKindRow,
  type CostKindView,
} from '@/lib/charts/costByKind';
import { seriesData, type SeriesOf } from '@/lib/charts/seriesViews';
import type { TimeWindow } from '@/lib/queries/aggregate';

function isRow(value: unknown): value is CostByKindRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const day = Reflect.get(value, 'day');
  const kind = Reflect.get(value, 'kind');
  const cost = Reflect.get(value, 'cost');
  return typeof day === 'string' && typeof kind === 'string' && typeof cost === 'number';
}

const BY_KIND: SeriesOf<CostByKindRow> = {
  bucket: (row) => row.day,
  series: (row) => row.kind,
  value: (row) => row.cost,
};

function KindChart({ view, rows, span }: { view: CostKindView; rows: CostByKindRow[]; span: TimeWindow }) {
  if (view === 'donut') {
    return (
      <DonutChart
        totals={totalsBy(rows, BY_KIND.series, BY_KIND.value)}
        seriesOrder={seriesOrderOf(rows, BY_KIND.series)}
      />
    );
  }
  if (view === 'bars') {
    return <StackedBars data={costByKindData(rows)} of={BY_KIND} input={costByKindBarsInput} />;
  }
  return <Chart data={seriesData(view, costByKindData(rows), BY_KIND)} input={costByKindInputFor(view, span)} />;
}

export function CostKindPanel() {
  const { bucket, query, tick, span } = useFilters();
  const views = costKindViewsFor(bucket);
  const [view, setView] = usePanelView('cost_by_kind', views, 'stacked');
  const state = useLiveData(`/api/usage/cost/kinds?bucket=${bucket}&${query}`, tick, rowsParser(isRow));

  return (
    <Panel
      title="cost_by_kind"
      controls={<ViewToggle views={views} labels={COST_KIND_VIEW_LABELS} value={view} onChange={setView} />}
    >
      <div className="chart">
        {state.status === 'ready' ? <KindChart view={view} rows={state.data} span={span} /> : null}
        {state.status === 'loading' ? <Loading /> : null}
        {state.status === 'error' ? (
          <p className="note" role="alert">
            {state.message}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
