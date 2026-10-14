'use client';

import { Chart } from '@/components/Chart';
import { useFilters } from '@/components/Filters';
import { Loading, Panel } from '@/components/Shell';
import { useColorScheme } from '@/components/useColorScheme';
import { rowsParser, useLiveData } from '@/components/useLiveData';
import { ViewToggle, usePanelView } from '@/components/ViewToggle';
import {
  activityBubblesInputFor,
  activityHeatmapData,
  activityHeatmapInputFor,
  type ActivityHeatmapRow,
} from '@/lib/charts/activityHeatmap';

function isRow(value: unknown): value is ActivityHeatmapRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const day = Reflect.get(value, 'day');
  const hour = Reflect.get(value, 'hour');
  const tokens = Reflect.get(value, 'tokens');
  return typeof day === 'string' && typeof hour === 'string' && typeof tokens === 'number';
}

const VIEWS = ['heatmap', 'bubbles'] as const;
const VIEW_LABELS: Record<(typeof VIEWS)[number], string> = { heatmap: 'heatmap', bubbles: 'bubbles' };

export function ActivityPanel() {
  const { bucket, query, tick } = useFilters();
  const scheme = useColorScheme();
  const [view, setView] = usePanelView('activity_by_hour', VIEWS, 'heatmap');
  const state = useLiveData(`/api/usage/activity?bucket=${bucket}&${query}`, tick, rowsParser(isRow));

  // A week of zeros has no range for the colour key, which then lists 0 twice.
  const rows = state.status === 'ready' && state.data.some((row) => row.tokens > 0) ? state.data : [];
  // The engine paints a bubble legend's symbols in its own default red whatever colour the dots
  // are, so the key would contradict the chart it explains.
  const chart =
    view === 'bubbles' ? (
      <Chart hideLegend data={activityHeatmapData(rows)} input={activityBubblesInputFor(rows)} />
    ) : (
      <Chart
        categoricalColor={false}
        data={activityHeatmapData(rows)}
        input={activityHeatmapInputFor(rows, scheme)}
      />
    );

  return (
    <Panel
      title="activity_by_hour"
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
