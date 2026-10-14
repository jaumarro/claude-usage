'use client';

import { useEffect, useRef, useState } from 'react';
import { ActivityPanel } from '@/components/ActivityPanel';
import { Chart } from '@/components/Chart';
import { CostKindPanel } from '@/components/CostKindPanel';
import { CostPanel } from '@/components/CostPanel';
import { EffortPanel } from '@/components/EffortPanel';
import { FilterBar, FiltersProvider, useFilters } from '@/components/Filters';
import { ProjectPanel } from '@/components/ProjectPanel';
import { SessionsPanel } from '@/components/SessionsPanel';
import { Loading, Panel, Shell } from '@/components/Shell';
import { StatusPanel } from '@/components/StatusPanel';
import { SummaryPanel } from '@/components/SummaryPanel';
import {
  tokensByModelData,
  tokensByModelInputWithMarkers,
  type TokensByModelRow,
} from '@/lib/charts/tokensByModel';
import { seriesOrderOf, totalsBy } from '@/lib/charts/categoryShare';
import { SERIES_VIEWS, SERIES_VIEW_LABELS, seriesData } from '@/lib/charts/seriesViews';
import { ViewToggle, usePanelView } from '@/components/ViewToggle';
import { DonutChart } from '@/components/DonutChart';
import type { ModelMarker } from '@/lib/queries/timeseries';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; payload: ModelPayload };

function isRow(value: unknown): value is TokensByModelRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const day = Reflect.get(value, 'day');
  const model = Reflect.get(value, 'model');
  const tokens = Reflect.get(value, 'tokens');
  return typeof day === 'string' && typeof model === 'string' && typeof tokens === 'number';
}

type ModelPayload = { rows: TokensByModelRow[]; markers: ModelMarker[] };

function isMarker(value: unknown): value is ModelMarker {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    typeof Reflect.get(value, 'model') === 'string' &&
    typeof Reflect.get(value, 'at') === 'number' &&
    typeof Reflect.get(value, 'bucket') === 'string' &&
    typeof Reflect.get(value, 'kind') === 'string'
  );
}

async function fetchPayload(bucket: string, query: string): Promise<ModelPayload> {
  const response = await fetch(`/api/usage/timeseries?bucket=${bucket}&by=model&${query}`);
  if (!response.ok) {
    throw new Error(`timeseries responded ${response.status}`);
  }
  const payload: unknown = await response.json();
  const rows = typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'rows') : null;
  const markers = typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'markers') : [];
  if (!Array.isArray(rows) || !rows.every(isRow)) {
    throw new Error('timeseries returned an unexpected shape');
  }
  return { rows, markers: Array.isArray(markers) ? markers.filter(isMarker) : [] };
}

function ModelPanel() {
  const { bucket, query, tick, span } = useFilters();
  const [view, setView] = usePanelView('tokens_by_model', SERIES_VIEWS, 'stacked');
  const [state, setState] = useState<State>({ status: 'loading' });
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    // A poll swaps data in place; only a filter change is allowed to blank the panel.
    const key = `${bucket}|${query}`;
    if (lastKey.current !== key) {
      lastKey.current = key;
      setState({ status: 'loading' });
    }
    fetchPayload(bucket, query)
      .then((payload) => {
        if (live) {
          setState({ status: 'ready', payload });
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

  const rows = state.status === 'ready' ? state.payload.rows : [];
  const markers = state.status === 'ready' ? state.payload.markers : [];
  const chart =
    view === 'donut' ? (
      <DonutChart
        totals={totalsBy(rows, (row) => row.model, (row) => row.tokens)}
        seriesOrder={seriesOrderOf(rows, (row) => row.model)}
      />
    ) : (
      <Chart
        data={seriesData(view, tokensByModelData(rows), {
          bucket: (row) => row.day,
          series: (row) => row.model,
          value: (row) => row.tokens,
        })}
        input={tokensByModelInputWithMarkers(markers, view, span)}
      />
    );

  return (
    <Panel
      title="tokens_by_model"
      controls={
        <ViewToggle views={SERIES_VIEWS} labels={SERIES_VIEW_LABELS} value={view} onChange={setView} />
      }
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

function Panels() {
  const { synced } = useFilters();

  if (!synced) {
    return (
      <Panel title="log_sync">
        <p className="note">reading new session logs…</p>
      </Panel>
    );
  }

  return (
    <>
      <SummaryPanel />
      <ModelPanel />
      <StatusPanel />
      <CostPanel />
      <CostKindPanel />
      <ProjectPanel />
      <EffortPanel />
      <ActivityPanel />
      <SessionsPanel />
    </>
  );
}

export default function Page() {
  return (
    <FiltersProvider>
      <Shell controls={<FilterBar />}>
        <Panels />
      </Shell>
    </FiltersProvider>
  );
}
