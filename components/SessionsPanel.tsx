'use client';

import { Chart } from '@/components/Chart';
import { useFilters } from '@/components/Filters';
import { Loading, Panel } from '@/components/Shell';
import { rowsParser, useLiveData } from '@/components/useLiveData';
import { useColorScheme } from '@/components/useColorScheme';
import { sessionsColumns, sessionsInputFor, type SessionsRow } from '@/lib/charts/sessionsInParallel';

function isRow(value: unknown): value is SessionsRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const labels = ['t', 'mid', 'session', 'bar'].every((key) => typeof Reflect.get(value, key) === 'string');
  return labels && typeof Reflect.get(value, 'spent') === 'number';
}

export function SessionsPanel() {
  const { bucket, query, tick, span } = useFilters();
  const scheme = useColorScheme();
  const state = useLiveData(`/api/usage/sessions?bucket=${bucket}&${query}`, tick, rowsParser(isRow));

  return (
    <Panel title="tokens_by_session">
      <div className="chart">
        {state.status === 'ready' ? (
          <Chart
            categoricalColor={false}
            hideLegend
            data={{ columns: sessionsColumns, rows: state.data }}
            input={sessionsInputFor(state.data, scheme, span)}
          />
        ) : null}
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
