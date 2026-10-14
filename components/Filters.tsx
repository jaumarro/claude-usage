'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BUCKETS,
  BUCKETS_FOR_RANGE,
  RANGES,
  defaultBucketFor,
  isBucketAllowed,
  isLiveBucket,
  isLiveRange,
  timeWindow,
  type Bucket,
  type Range,
  type TimeWindow,
} from '@/lib/queries/aggregate';
import { DEFAULT_RANGE } from '@/lib/queries/filters';
import { RefreshDial } from '@/components/RefreshDial';

export const REFRESH_OPTIONS = ['off', '5s', '10s', '30s', '1m', '5m'] as const;
export type Refresh = (typeof REFRESH_OPTIONS)[number];

const REFRESH_MS: Record<Refresh, number | null> = {
  off: null,
  '5s': 5_000,
  '10s': 10_000,
  '30s': 30_000,
  '1m': 60_000,
  '5m': 300_000,
};

type Filters = {
  range: Range;
  bucket: Bucket;
  refresh: Refresh;
  setRange: (range: Range) => void;
  setBucket: (bucket: Bucket) => void;
  setRefresh: (refresh: Refresh) => void;
  /**
   * Appended to every panel's fetch, so one control moves the whole dashboard. The poll
   * counter is deliberately NOT in here: a changing url means the user moved a filter and
   * the panel should show a loading state, while a tick should swap data silently.
   */
  query: string;
  tick: number;
  /** The one span every time chart draws, recut on each poll so its end keeps up with now. */
  span: TimeWindow;
  intervalMs: number | null;
  /** False until the page-load log sync settles, so no panel reads the stale snapshot first. */
  synced: boolean;
  /** Re-reads the session logs, then refetches every panel for the range and bucket as they are. */
  refreshNow: () => void;
  refreshing: boolean;
};

const FiltersContext = createContext<Filters | null>(null);

export function useFilters(): Filters {
  const filters = useContext(FiltersContext);
  if (filters === null) {
    throw new Error('useFilters must be used inside FiltersProvider');
  }
  return filters;
}

const STORAGE_KEY = 'claude-usage.filters';

type Stored = { range?: string; bucket?: string; refresh?: string };

/**
 * Read on mount rather than in a useState initializer: the initializer also runs during
 * SSR, where localStorage does not exist, and a differing first client render is a
 * hydration mismatch. Every access is guarded because a browser set to block site data
 * throws on the property itself, not just on read.
 */
function readStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    return parsed as Stored;
  } catch {
    return null;
  }
}

/** One turn of the refresh icon, matching its `spin` animation duration in the stylesheet. */
const REFRESH_SPIN_MS = 600;

/**
 * Pulls what Claude Code appended to its session logs into the database; nothing else does.
 * A failed sync still resolves, and the panels show what the database already holds.
 */
function syncLogs(): Promise<void> {
  return fetch('/api/ingest', { method: 'POST' }).then(
    () => undefined,
    () => undefined,
  );
}

function writeStored(value: Stored): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A remembered filter is a convenience; losing it must never break the dashboard.
  }
}

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const [bucket, setBucket] = useState<Bucket>(defaultBucketFor(DEFAULT_RANGE));
  const [refresh, setRefresh] = useState<Refresh>('off');
  const [tick, setTick] = useState(0);
  const [synced, setSynced] = useState(false);
  const intervalMs = REFRESH_MS[refresh];

  useEffect(() => {
    let live = true;
    void syncLogs().then(() => {
      if (live) {
        setSynced(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (intervalMs === null) {
      return;
    }
    const id = setInterval(() => {
      void syncLogs().then(() => {
        setTick((previous) => previous + 1);
      });
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs]);

  useEffect(() => {
    const stored = readStored();
    if (stored === null) {
      return;
    }
    const storedRange = RANGES.find((option) => option === stored.range);
    const storedBucket = BUCKETS.find((option) => option === stored.bucket);
    const storedRefresh = REFRESH_OPTIONS.find((option) => option === stored.refresh);
    if (storedRange !== undefined) {
      setRange(storedRange);
    }
    if (storedBucket !== undefined) {
      setBucket(storedBucket);
    }
    if (storedRefresh !== undefined) {
      setRefresh(storedRefresh);
    }
  }, []);

  useEffect(() => {
    writeStored({ range, bucket, refresh });
  }, [range, bucket, refresh]);

  useEffect(() => {
    if (!isBucketAllowed(range, bucket)) {
      setBucket(defaultBucketFor(range));
    }
  }, [range, bucket]);

  // Hiding the control is not enough: the interval must actually stop, or a range or
  // bucket change leaves a timer polling a chart that cannot visibly move.
  useEffect(() => {
    const live = isLiveRange(range) && isLiveBucket(bucket);
    if (!live && refresh !== 'off') {
      setRefresh('off');
    }
  }, [range, bucket, refresh]);

  // A range opens on its finest bucket; the bucket control coarsens it from there.
  const chooseRange = useCallback((next: Range) => {
    setRange(next);
    setBucket(defaultBucketFor(next));
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const refreshNow = useCallback(() => {
    setRefreshing(true);
    const started = Date.now();
    void syncLogs().then(() => {
      setTick((previous) => previous + 1);
      // A sync takes a fraction of a second; one full turn reads as feedback, a blink does not.
      const remaining = Math.max(0, REFRESH_SPIN_MS - (Date.now() - started));
      setTimeout(() => {
        setRefreshing(false);
      }, remaining);
    });
  }, []);

  const value = useMemo<Filters>(() => {
    const query = `range=${encodeURIComponent(range)}`;
    return {
      range,
      bucket,
      refresh,
      setRange: chooseRange,
      setBucket,
      setRefresh,
      query,
      tick,
      span: timeWindow(range, bucket, Date.now()),
      intervalMs,
      synced,
      refreshNow,
      refreshing,
    };
  }, [range, bucket, refresh, chooseRange, tick, intervalMs, synced, refreshNow, refreshing]);

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

const RANGE_LABELS: Record<Range, string> = {
  '3h': 'last 3h',
  today: 'today',
  '3d': 'last 3d',
  '7d': 'last 7d',
  '30d': 'last 30d',
  '90d': 'last 90d',
  all: 'all time',
};

function Select<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels?: Record<T, string>;
  onChange: (next: T) => void;
}) {
  return (
    <label className="filter">
      <span>{label}</span>
      <select
        className="seg"
        value={value}
        onChange={(event) => {
          const next = options.find((option) => option === event.target.value);
          if (next !== undefined) {
            onChange(next);
          }
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels === undefined ? option : labels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterBar() {
  const {
    range,
    bucket,
    refresh,
    setRange,
    setBucket,
    setRefresh,
    tick,
    intervalMs,
    refreshNow,
    refreshing,
  } = useFilters();
  const refreshClass = refreshing ? 'seg refresh busy' : 'seg refresh';

  return (
    <div className="filter-bar">
      <Select label="range" value={range} options={RANGES} labels={RANGE_LABELS} onChange={setRange} />
      <Select label="bucket" value={bucket} options={BUCKETS_FOR_RANGE[range]} onChange={setBucket} />
      {isLiveRange(range) && isLiveBucket(bucket) ? (
        <Select label="live" value={refresh} options={REFRESH_OPTIONS} onChange={setRefresh} />
      ) : null}
      {intervalMs === null ? null : (
        <span className="dial-slot" title={`refreshing every ${refresh}`}>
          <RefreshDial intervalMs={intervalMs} cycle={tick} />
        </span>
      )}
      <button
        type="button"
        className={refreshClass}
        title="refresh data"
        aria-label="refresh data"
        disabled={refreshing}
        onClick={refreshNow}
      >
        <span className="refresh-icon" aria-hidden="true">
          ↻
        </span>
      </button>
    </div>
  );
}
