'use client';

import { useEffect, useState } from 'react';
import { Chart } from '@/components/Chart';
import { useFilters } from '@/components/Filters';
import { Loading, Panel } from '@/components/Shell';
import { WeeklyResetInput, useWeeklyReset } from '@/components/WeeklyReset';
import { RANGE_DAYS } from '@/lib/queries/filters';
import type { TimeWindow } from '@/lib/queries/aggregate';
import { quotaOverTimeData, quotaOverTimeInputWithResets, weeklyResets } from '@/lib/charts/quotaOverTime';
import type { QuotaOverTimeRow, WeeklySchedule } from '@/lib/charts/quotaOverTime';
import type { Status } from '@/lib/status';

function age(seconds: number): string {
  if (seconds < 90) {
    return `${Math.max(0, Math.round(seconds))}s ago`;
  }
  if (seconds < 5400) {
    return `${Math.round(seconds / 60)}m ago`;
  }
  if (seconds < 172_800) {
    return `${Math.round(seconds / 3600)}h ago`;
  }
  return `${Math.round(seconds / 86_400)}d ago`;
}

type QuotaChartProps = { rows: QuotaOverTimeRow[]; resets: number[]; span: TimeWindow; schedule: WeeklySchedule };

function QuotaChart({ rows, resets, span, schedule }: QuotaChartProps) {
  const first = rows[0];
  if (first === undefined) {
    return <p className="note">No quota samples yet. Run the desktop app or install the collector.</p>;
  }
  // An unbounded range starts where the readings do.
  const weekly = weeklyResets(span.start ?? Date.parse(first.t), span.end, schedule);
  return (
    <div className="chart">
      <Chart data={quotaOverTimeData(rows)} input={quotaOverTimeInputWithResets([...resets, ...weekly], span)} />
    </div>
  );
}

export function StatusPanel() {
  const { range, tick, span } = useFilters();
  const [schedule, setSchedule] = useWeeklyReset();
  const resetInput = <WeeklyResetInput schedule={schedule} onChange={setSchedule} />;
  const days = RANGE_DAYS[range];
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Readings from where the bucketed charts begin, so every chart opens on the same instant.
  const since = span.start === null ? '' : `&since=${span.start}`;

  useEffect(() => {
    let live = true;
    fetch(`/api/status?days=${days}${since}`)
      .then((response) => response.json())
      .then((body: Status) => {
        if (live) {
          setStatus(body);
        }
      })
      .catch((cause: unknown) => {
        if (live) {
          setError(String(cause));
        }
      });
    return () => {
      live = false;
    };
  }, [days, since, tick]);

  if (error !== null) {
    return (
      <Panel span={6} title="quota_windows" controls={resetInput}>
        <p className="note" role="alert">
          Could not read quota status: {error}
        </p>
      </Panel>
    );
  }

  if (status === null) {
    return (
      <Panel span={6} title="quota_windows" controls={resetInput}>
        <div className="chart">
          <Loading />
        </div>
      </Panel>
    );
  }

  const freshness = status.five_hour ?? status.seven_day ?? status.spend_limit;
  const meta = freshness === null ? 'no reading' : `read ${age(freshness.stale_seconds)}`;

  return (
    <Panel span={6} title={`quota_windows · ${meta}`} controls={resetInput}>
      <QuotaChart rows={status.chart.rows} resets={status.resets} span={span} schedule={schedule} />
    </Panel>
  );
}
