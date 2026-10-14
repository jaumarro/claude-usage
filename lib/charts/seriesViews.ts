import { createSpec, geom, mapping, pipe, scale, transform } from '@graphysdk/react';
import { wallClock } from '@/lib/charts/wallClock';
import type { Bucket, TimeWindow } from '@/lib/queries/aggregate';

/** Every way a panel can draw its data. The donut is the period's total; the rest run over time. */
export type SeriesView = 'stacked' | 'share' | 'donut';
export type TimeView = Exclude<SeriesView, 'donut'>;

export const TIME_VIEWS: readonly TimeView[] = ['stacked', 'share'];
export const SERIES_VIEWS: readonly SeriesView[] = [...TIME_VIEWS, 'donut'];

export const SERIES_VIEW_LABELS: Record<SeriesView, string> = {
  stacked: 'stacked',
  share: '100%',
  donut: 'donut',
};

/** Areas drawn over one another rather than stacked, which the theme strokes along their tops. */
export const OVERLAP_LAYER = 'overlap';

/** The donut's slices, which the theme fills as it does the stacked bands. */
export const DONUT_LAYER = 'donut';

/** The donut's edges, which the theme leaves unfilled and the donut strokes slice by slice. */
export const DONUT_EDGE_LAYER = 'donut-edge';

/**
 * One segment per session and bucket. A segment spans only the buckets its session was active in, so
 * it never runs along the band beneath at zero, and the theme strokes its top.
 */
export const SESSIONS_LAYER = 'sessions';

/** A point atop each bar of sessions, which the theme hides so only its total's label shows. */
export const SESSION_TOTALS_LAYER = 'session-totals';

type Column = { key: string; label?: string };

/** How a panel's rows name their bucket, their series and the value they plot. */
export type SeriesOf<T> = {
  bucket: (row: T) => string;
  series: (row: T) => string;
  value: (row: T) => number;
};

/**
 * The share view divides each bucket by its total, so an idle bucket has nothing to split and
 * drops every band to zero, every weekend. Those buckets are left out of it and the bands run
 * straight across; the other views keep them as the zeros they are.
 */
function withoutIdleBuckets<T>(rows: readonly T[], of: SeriesOf<T>): T[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(of.bucket(row), (totals.get(of.bucket(row)) ?? 0) + of.value(row));
  }
  return rows.filter((row) => (totals.get(of.bucket(row)) ?? 0) > 0);
}

/** The height a band reaches: its own value on top of every band stacked beneath it. */
function stackTop(values: ReadonlyMap<string, number>, order: readonly string[], rank: number): number {
  return order.slice(0, rank + 1).reduce((sum, series) => sum + (values.get(series) ?? 0), 0);
}

/**
 * Each row's `top`, where its band's edge runs, and `rank`, its band's place in the stack. The
 * engine stacks series in the order the rows first meet them, so the tops are summed in that order.
 */
function withEdges<T extends object>(view: 'stacked' | 'share', rows: readonly T[], of: SeriesOf<T>) {
  const order = [...new Set(rows.map(of.series))];
  const buckets = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const values = buckets.get(of.bucket(row)) ?? new Map<string, number>();
    values.set(of.series(row), of.value(row));
    buckets.set(of.bucket(row), values);
  }
  return rows.map((row) => {
    const values = buckets.get(of.bucket(row)) ?? new Map<string, number>();
    const rank = order.indexOf(of.series(row));
    const height = stackTop(values, order, rank);
    const total = [...values.values()].reduce((sum, value) => sum + value, 0);
    const top = view === 'share' ? height / total : height;
    return { ...row, top, rank };
  });
}

/** A panel's rows as the view draws them: the share view without idle buckets, the stacks with edges. */
export function seriesData<T extends object>(
  view: TimeView,
  data: { columns: readonly Column[]; rows: readonly T[] },
  of: SeriesOf<T>,
) {
  const rows = view === 'share' ? withoutIdleBuckets(data.rows, of) : [...data.rows];
  return { columns: [...data.columns, { key: 'top' }, { key: 'rank' }], rows: withEdges(view, rows, of) };
}

// A band strokes its own top edge, and a later band is drawn over an earlier one: where an upper
// series is zero its edge lies on the band beneath and repaints that band's edge in the wrong hue.
// So the bands are fills only and the edges are lines through each row's precomputed top, drawn
// from the highest band down, so the band that really ends at an edge is the one painted last.
const EDGES_TOP_DOWN = [transform.sort({ variableName: 'rank', direction: 'desc' })];

/**
 * `color` sits on the layers rather than the global mapping: a global one is inherited by every
 * layer, and a reference rule declares no color aesthetic, so each marker would raise
 * UNDECLARED_AESTHETIC.
 */
export function seriesInput(view: TimeView, keys: { x: string; y: string; color: string }, span?: TimeWindow) {
  const position = view === 'stacked' ? 'stack' : 'fill';
  return pipe(
    createSpec(),
    mapping({ x: keys.x, y: keys.y }),
    geom.area({ position, aes: { color: keys.color } }),
    geom.line({ aes: { color: keys.color, y: 'top' }, interactive: false, transforms: EDGES_TOP_DOWN }),
    spanScale(span),
    scale.y(),
  );
}

/**
 * The stacked bars a panel hovers, which give the legend its hues. Their edge layers are drawn over
 * them and cover every segment, so the theme gives them no outline of their own.
 */
export const BARS_LAYER = 'bars';

/** The layer that paints one series' segments of the stacked bars. */
export function barEdgeLayer(series: string): string {
  return `bar-edge:${series}`;
}

/** Bars need a band each, and finer buckets give hundreds of them to one panel. */
export function barsFit(bucket: Bucket): boolean {
  return bucket === 'day' || bucket === 'week';
}

/**
 * Stacked bars with each segment edged in its own hue. Bars stacked on one band share one border,
 * so the stack only carries the hover, and each series is painted over it by a layer of its own:
 * one unstacked bar from the baseline to the top of its segment. They are laid from the top series
 * down, so each segment's own layer is the last to paint it. Bars draw on a band axis, so these
 * read the buckets as categories rather than as dates.
 */
export function barsInput(keys: { x: string; y: string; color: string }, seriesOrder: readonly string[]) {
  return pipe(
    createSpec(),
    mapping({ x: keys.x, y: keys.y }),
    geom.bar({ id: BARS_LAYER, position: 'stack', aes: { color: keys.color } }),
    ...[...seriesOrder].reverse().map((series) =>
      geom.bar({
        id: barEdgeLayer(series),
        position: 'identity',
        aes: { y: 'top' },
        interactive: false,
        transforms: [transform.filter({ variableName: keys.color, operator: 'eq', value: series })],
      }),
    ),
    scale.x.discrete(),
    scale.y(),
  );
}

/** A datetime axis over the dashboard's shared span, or over the data when there is none. */
export function spanScale(span?: TimeWindow) {
  if (span === undefined) {
    return scale.x.datetime();
  }
  const start = span.start === null ? undefined : wallClock(span.start);
  return scale.x.datetime({ domainMin: start, domainMax: wallClock(span.end) });
}
