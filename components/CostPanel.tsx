'use client';

import { useEffect, useState, useRef } from 'react';
import { Chart } from '@/components/Chart';
import { useFilters } from '@/components/Filters';
import type { Bucket } from '@/lib/queries/aggregate';
import { Loading, Panel } from '@/components/Shell';
import {
  costByModelData,
  costByModelInputFor,
  type CostByModelRow,
} from '@/lib/charts/costByModel';
import { seriesOrderOf, totalsBy } from '@/lib/charts/categoryShare';
import { SERIES_VIEWS, SERIES_VIEW_LABELS, seriesData } from '@/lib/charts/seriesViews';
import { ViewToggle, usePanelView } from '@/components/ViewToggle';
import { DonutChart } from '@/components/DonutChart';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: CostByModelRow[] };

function isRow(value: unknown): value is CostByModelRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const day = Reflect.get(value, 'day');
  const model = Reflect.get(value, 'model');
  const cost = Reflect.get(value, 'cost');
  return typeof day === 'string' && typeof model === 'string' && typeof cost === 'number';
}

async function fetchRows(bucket: Bucket, query: string): Promise<CostByModelRow[]> {
  const response = await fetch(`/api/usage/cost?bucket=${bucket}&${query}`);
  if (!response.ok) {
    throw new Error(`cost responded ${response.status}`);
  }
  const body: unknown = await response.json();
  const rows = typeof body === 'object' && body !== null ? Reflect.get(body, 'rows') : null;
  if (!Array.isArray(rows) || !rows.every(isRow)) {
    throw new Error('cost returned an unexpected shape');
  }
  return rows;
}

export function CostPanel() {
  const { bucket, query, tick, span } = useFilters();
  const [view, setView] = usePanelView('cost_by_model', SERIES_VIEWS, 'stacked');
  const [state, setState] = useState<State>({ status: 'loading' });
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    // A poll swaps data in place; only a filter change is allowed to blank the panel.
    const key = `${bucket}&${query}`;
    if (lastKey.current !== key) {
      lastKey.current = key;
      setState({ status: 'loading' });
    }
    fetchRows(bucket, query)
      .then((rows) => {
        if (live) {
          setState({ status: 'ready', rows });
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setState({ status: 'error', message: String(error) });
        }
      });
    return () => {
      live = false;
    };
  }, [bucket, query, tick]);

  const rows = state.status === 'ready' ? state.rows : [];
  const chart =
    view === 'donut' ? (
      <DonutChart
        totals={totalsBy(rows, (row) => row.model, (row) => row.cost)}
        seriesOrder={seriesOrderOf(rows, (row) => row.model)}
      />
    ) : (
      <Chart
        data={seriesData(view, costByModelData(rows), {
          bucket: (row) => row.day,
          series: (row) => row.model,
          value: (row) => row.cost,
        })}
        input={costByModelInputFor(view, span)}
      />
    );

  return (
    <Panel
      span={6}
      title="cost_by_model"
      controls={<ViewToggle views={SERIES_VIEWS} labels={SERIES_VIEW_LABELS} value={view} onChange={setView} />}
    >
      <div className="chart">
        {state.status === 'ready' ? chart : null}
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
