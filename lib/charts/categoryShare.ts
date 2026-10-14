import { coord, createSpec, pipe, mapping, geom, scale, transform } from '@graphysdk/react';
import { DONUT_EDGE_LAYER, DONUT_LAYER } from '@/lib/charts/seriesViews';
import { PALETTE_ID, SERIES_IDS } from '@/lib/charts/theme';

/** Past one category per hue the palette would repeat itself, so the smallest fold into one. */
const NAMED_MAX = SERIES_IDS.length - 1;
export const OTHER = 'other';

export type ShareTotal = { category: string; value: number };

export function totalsBy<T>(
  rows: readonly T[],
  category: (row: T) => string,
  value: (row: T) => number,
): ShareTotal[] {
  const sums = new Map<string, number>();
  for (const row of rows) {
    sums.set(category(row), (sums.get(category(row)) ?? 0) + value(row));
  }
  return [...sums].map(([key, sum]) => ({ category: key, value: sum }));
}

/** First appearance in the rows, which is the order the palette hands the series views their hues. */
export function seriesOrderOf<T>(rows: readonly T[], category: (row: T) => string): string[] {
  return [...new Set(rows.map(category))];
}

function foldSmallest(totals: ShareTotal[]): ShareTotal[] {
  const ranked = [...totals].sort((left, right) => right.value - left.value);
  if (ranked.length <= SERIES_IDS.length) {
    return ranked;
  }
  const rest = ranked.slice(NAMED_MAX).reduce((sum, total) => sum + total.value, 0);
  return [...ranked.slice(0, NAMED_MAX), { category: OTHER, value: rest }];
}

type ColorOverride = { id: string } | { hex: string };

/**
 * The palette hands out hues in the order a chart meets its groups. A share chart meets them by
 * size and the panel's series views in data order, so each group is pinned to the hue its
 * category has there, keeping one entity one colour across views.
 */
export function shareColorOverrides(
  categories: readonly string[],
  seriesOrder: readonly string[],
  neutral: string,
): Record<number, ColorOverride> {
  return Object.fromEntries(
    categories.map((category, index) => {
      const position = seriesOrder.indexOf(category);
      const override: ColorOverride =
        position === -1 ? { hex: neutral } : { id: SERIES_IDS[position % SERIES_IDS.length] ?? '' };
      return [index + 1, override];
    }),
  );
}

/** `ring` is the one band every slice shares: stacking groups by a column, not by a constant. */
export type DonutSlice = { ring: string; category: string; value: number; end: number };

export const donutColumns = [{ key: 'ring' }, { key: 'category' }, { key: 'value' }, { key: 'end' }];

/** Under this share a slice is a sliver, and the engine prints its label outside, over the next. */
const SLIVER = 0.005;

/**
 * Two or more slivers fold into other, so the ring prints one label for them rather than one
 * each on top of one another. A lone sliver keeps its name: it has no label to collide with.
 */
function foldSlivers(totals: ShareTotal[]): ShareTotal[] {
  const sum = totals.reduce((total, entry) => total + entry.value, 0);
  const folds = (entry: ShareTotal) => entry.category === OTHER || entry.value / sum < SLIVER;
  const slivers = totals.filter((entry) => entry.category !== OTHER && folds(entry));
  if (slivers.length < 2) {
    return totals;
  }
  const rest = totals.filter(folds).reduce((total, entry) => total + entry.value, 0);
  return [...totals.filter((entry) => !folds(entry)), { category: OTHER, value: rest }];
}

/** A category the order does not name, other among them, goes after the ones it does. */
function byOrder(order: readonly string[]) {
  const rank = (category: string) => {
    const index = order.indexOf(category);
    return index === -1 ? order.length : index;
  };
  return (left: ShareTotal, right: ShareTotal) => rank(left.category) - rank(right.category);
}

/**
 * The period's total by category with the smallest folded into other: largest first, or in
 * `order` for categories that have one of their own, such as effort levels.
 */
export function donutSlices(totals: ShareTotal[], order?: readonly string[]): DonutSlice[] {
  const present = foldSlivers(foldSmallest(totals.filter((total) => total.value > 0)));
  const placed = order === undefined ? present : [...present].sort(byOrder(order));
  const sum = placed.reduce((total, entry) => total + entry.value, 0);
  return placed.map((total, index) => {
    const end = placed.slice(0, index + 1).reduce((reached, entry) => reached + entry.value, 0) / sum;
    return { ring: 'total', ...total, end };
  });
}

export function donutData(slices: DonutSlice[]) {
  return { columns: donutColumns, rows: slices };
}

/** The hole, as a share of the radius. */
const DONUT_HOLE = 0.6;

/** The layer that edges one slice, which the donut strokes in that slice's hue. */
export function donutEdgeLayer(category: string): string {
  return `${DONUT_EDGE_LAYER}:${category}`;
}

/**
 * Bars sharing a band share one border, so a slice cannot be edged in its own hue. Each slice's
 * edge is a layer of its own: one unstacked wedge from twelve o'clock to where the slice ends,
 * unfilled. They are laid largest first, so the wedge that really ends a stretch of rim paints it
 * last.
 */
function edgeLayers(slices: DonutSlice[]) {
  return [...slices]
    .sort((left, right) => right.end - left.end)
    .map((slice) =>
      geom.bar({
        id: donutEdgeLayer(slice.category),
        position: 'identity',
        aes: { y: 'end' },
        interactive: false,
        transforms: [transform.filter({ variableName: 'category', operator: 'eq', value: slice.category })],
      }),
    );
}

/**
 * Every slice on one ring: bars filled to one whole on a single band, swept round by their share.
 * The colour scale is the house palette with per-slice overrides, which is why a panel draws it
 * with its own colour scale rather than the one the chart wrapper pipes on.
 */
export function donutInput(slices: DonutSlice[], seriesOrder: readonly string[], neutral: string) {
  return pipe(
    createSpec(),
    mapping({ x: 'ring', y: 'value', color: 'category' }),
    geom.bar({ id: DONUT_LAYER, position: 'fill', dataLabels: { showDataLabels: true, format: 'percentage' } }),
    ...edgeLayers(slices),
    coord.polar({ theta: 'y', innerRadius: DONUT_HOLE }),
    scale.color.palette({
      palette: { type: 'custom', id: PALETTE_ID },
      overrides: shareColorOverrides(
        slices.map((slice) => slice.category),
        seriesOrder,
        neutral,
      ),
    }),
  );
}
