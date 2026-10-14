'use client';

import { useEffect, useState, useRef } from 'react';
import { Chart } from '@/components/Chart';
import { useFilters } from '@/components/Filters';
import { Loading, Panel } from '@/components/Shell';
import {
  projectBreakdownData,
  projectBreakdownInput,
  type ProjectBreakdownRow,
} from '@/lib/charts/projectBreakdown';
import { seriesOrderOf, totalsBy } from '@/lib/charts/categoryShare';
import { ViewToggle, usePanelView } from '@/components/ViewToggle';
import { DonutChart } from '@/components/DonutChart';

const PROJECT_LIMIT = 15;

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: ProjectBreakdownRow[] };

function isRow(value: unknown): value is ProjectBreakdownRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const label = Reflect.get(value, 'label');
  const full = Reflect.get(value, 'full');
  const tokens = Reflect.get(value, 'tokens');
  return typeof label === 'string' && typeof full === 'string' && typeof tokens === 'number';
}

async function fetchRows(query: string): Promise<ProjectBreakdownRow[]> {
  const response = await fetch(`/api/usage/breakdown?by=project&limit=${PROJECT_LIMIT}&${query}`);
  if (!response.ok) {
    throw new Error(`breakdown responded ${response.status}`);
  }
  const body: unknown = await response.json();
  const envelope = typeof body === 'object' && body !== null ? body : {};
  const rows = Reflect.get(envelope, 'rows');
  if (!Array.isArray(rows) || !rows.every(isRow)) {
    throw new Error('breakdown returned an unexpected shape');
  }
  return rows;
}

const VIEWS = ['bars', 'donut'] as const;
const VIEW_LABELS: Record<(typeof VIEWS)[number], string> = { bars: 'bars', donut: 'donut' };

export function ProjectPanel() {
  const { query, tick } = useFilters();
  const [view, setView] = usePanelView('tokens_by_project', VIEWS, 'bars');
  const [state, setState] = useState<State>({ status: 'loading' });
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    // A poll swaps data in place; only a filter change is allowed to blank the panel.
    const key = `${query}`;
    if (lastKey.current !== key) {
      lastKey.current = key;
      setState({ status: 'loading' });
    }
    fetchRows(query)
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
  }, [query, tick]);

  const rows = state.status === 'ready' ? state.rows : [];
  // Rows arrive ranked, so the donut's hues follow rank; the bars carry no colour of their own.
  const chart =
    view === 'donut' ? (
      <DonutChart
        totals={totalsBy(rows, (row) => row.label, (row) => row.tokens)}
        seriesOrder={seriesOrderOf(rows, (row) => row.label)}
      />
    ) : (
      <Chart hideCategoryAxis data={projectBreakdownData(rows)} input={projectBreakdownInput} />
    );

  return (
    <Panel
      span={6}
      title="tokens_by_project"
      controls={<ViewToggle views={VIEWS} labels={VIEW_LABELS} value={view} onChange={setView} />}
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
