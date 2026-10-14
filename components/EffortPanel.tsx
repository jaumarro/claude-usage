'use client';

import { useEffect, useState, useRef } from 'react';
import { Chart } from '@/components/Chart';
import { useFilters } from '@/components/Filters';
import type { Bucket } from '@/lib/queries/aggregate';
import { Loading, Panel } from '@/components/Shell';
import {
  EFFORT_LEVELS,
  tokensByEffortData,
  tokensByEffortInputFor,
  type TokensByEffortRow,
} from '@/lib/charts/tokensByEffort';
import { seriesOrderOf, totalsBy } from '@/lib/charts/categoryShare';
import { SERIES_VIEWS, SERIES_VIEW_LABELS, seriesData } from '@/lib/charts/seriesViews';
import { ViewToggle, usePanelView } from '@/components/ViewToggle';
import { DonutChart } from '@/components/DonutChart';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: TokensByEffortRow[] };

function isSeriesRow(value: unknown): value is TokensByEffortRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const day = Reflect.get(value, 'day');
  const effort = Reflect.get(value, 'effort');
  const tokens = Reflect.get(value, 'tokens');
  return typeof day === 'string' && typeof effort === 'string' && typeof tokens === 'number';
}

async function fetchRows(bucket: Bucket, query: string): Promise<TokensByEffortRow[]> {
  const response = await fetch(`/api/usage/effort?bucket=${bucket}&${query}`);
  if (!response.ok) {
    throw new Error(`effort responded ${response.status}`);
  }
  const body: unknown = await response.json();
  const envelope = typeof body === 'object' && body !== null ? body : {};
  const rows = Reflect.get(envelope, 'rows');
  if (!Array.isArray(rows) || !rows.every(isSeriesRow)) {
    throw new Error('effort returned an unexpected series shape');
  }
  return rows;
}

export function EffortPanel() {
  const { bucket, query, tick, span } = useFilters();
  const [view, setView] = usePanelView('tokens_by_effort', SERIES_VIEWS, 'stacked');
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
        totals={totalsBy(rows, (row) => row.effort, (row) => row.tokens)}
        seriesOrder={seriesOrderOf(rows, (row) => row.effort)}
        order={EFFORT_LEVELS}
      />
    ) : (
      <Chart
        data={seriesData(view, tokensByEffortData(rows), {
          bucket: (row) => row.day,
          series: (row) => row.effort,
          value: (row) => row.tokens,
        })}
        input={tokensByEffortInputFor(view, span)}
      />
    );

  return (
    <Panel
      span={6}
      title="tokens_by_effort"
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
