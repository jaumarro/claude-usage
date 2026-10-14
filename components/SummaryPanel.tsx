'use client';

import { useEffect, useRef, useState } from 'react';
import { useFilters } from '@/components/Filters';
import { Panel, Stat } from '@/components/Shell';
import { compactTokens, payback, percent } from '@/lib/format';
import type { Summary } from '@/lib/queries/summary';

function money(usd: number): string {
  if (usd >= 1000) {
    return `$${(usd / 1000).toFixed(2)}k`;
  }
  return `$${usd.toFixed(2)}`;
}

function span(summary: Summary): string {
  if (summary.firstDay === null || summary.lastDay === null) {
    return 'no data';
  }
  return `${summary.activeDays}d active`;
}

const DAYS_PER_MONTH = 30;

/** API-equivalent spend per thirty active days, the rate the period's use runs at. */
function perMonth(summary: Summary): number {
  return summary.activeDays === 0 ? 0 : (summary.costUsd / summary.activeDays) * DAYS_PER_MONTH;
}

function quotaTone(used: number): 'accent' | 'warn' | undefined {
  if (used >= 85) {
    return 'warn';
  }
  if (used >= 50) {
    return undefined;
  }
  return 'accent';
}

/** A live window reading, rounded so it matches the figure the quota chart ends on. */
function WindowStat({ label, used }: { label: string; used: number | null }) {
  if (used === null) {
    return <Stat label={label} value="n/a" />;
  }
  const rounded = Math.round(used);
  return <Stat label={label} value={`${rounded}%`} tone={quotaTone(rounded)} />;
}

/**
 * Two different questions get called "efficiency", so both are shown side by side:
 * value captured is API-equivalent spend against the subscription, and quota used
 * is how much of the allowance the windows actually consumed.
 */
export function SummaryPanel() {
  const { query, tick } = useFilters();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastQuery = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    // A refresh swaps the figures in place; only a range change blanks the panel.
    if (lastQuery.current !== query) {
      lastQuery.current = query;
      setSummary(null);
      setError(null);
    }
    fetch(`/api/summary?${query}`)
      .then((response) => response.json())
      .then((body: Summary) => {
        if (live) {
          setSummary(body);
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
  }, [query, tick]);

  if (error !== null) {
    return (
      <Panel title="plan_efficiency">
        <p className="note" role="alert">
          {error}
        </p>
      </Panel>
    );
  }

  if (summary === null) {
    return (
      <Panel title="plan_efficiency">
        <p className="note">reading…</p>
      </Panel>
    );
  }

  const valueTone = summary.planValueRatio >= 1 ? 'accent' : 'warn';
  const quota = summary.quota;
  const plan = `$${summary.planUsd}/mo`;

  return (
    <Panel title="plan_efficiency">
      <div className="stat-row">
        <Stat
          hero
          label="VALUE CAPTURED"
          value={percent(summary.planValueRatio)}
          tone={valueTone}
          hint={`API rates vs ${plan}`}
        />
        <Stat
          label="PAYBACK"
          value={payback(summary.planValueRatio)}
          tone={valueTone}
          hint="per month of plan"
        />
        <Stat label="SUBSCRIPTION" value={plan} />
      </div>
      <div className="stat-row">
        <Stat label="API EQUIVALENT" value={money(summary.costUsd)} />
        <Stat label="PER 30D" value={money(perMonth(summary))} hint="at this rate" />
        <Stat
          label="ALLOWANCE USED"
          value={quota === null ? 'n/a' : `${quota.meanSevenDay.toFixed(0)}%`}
          hint="avg of weekly limit"
        />
        <WindowStat label="5H WINDOW" used={summary.windows.five_hour} />
        {/* The desktop app meters Fable on a weekly limit of its own, which no local file reports. */}
        <WindowStat label="7D ALL MODELS" used={summary.windows.seven_day} />
        {summary.windows.spend_limit === null ? null : (
          <WindowStat label="SPEND LIMIT" used={summary.windows.spend_limit} />
        )}
        <Stat label="TOKENS" value={compactTokens(summary.tokens)} />
        <Stat label="REQUESTS" value={compactTokens(summary.requests)} />
        <Stat label="SESSIONS" value={String(summary.sessions)} />
        <Stat label="THINK/OUT" value={percent(summary.thinkingShare)} tone="warn" hint="of output" />
        <Stat label="SPAN" value={span(summary)} />
        <Stat label="MODELS USED" value={String(summary.models)} />
      </div>
      {summary.unpricedTokens === 0 ? null : (
        <p className="note" role="alert">
          {compactTokens(summary.unpricedTokens)} tokens excluded as unpriced
        </p>
      )}
    </Panel>
  );
}
