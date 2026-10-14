'use client';

import { GraphProvider, GraphRenderer, config, pipe, type styles } from '@graphysdk/react';
import type { ComponentProps } from 'react';
import { useColorScheme } from '@/components/useColorScheme';
import { chartTheme, terminalConfig, terminalPalette } from '@/lib/charts/theme';

type ProviderProps = ComponentProps<typeof GraphProvider>;

/**
 * The renderer plays no animation above 1500 geoms. A line or area counts once, but every bar, tile
 * and point counts on its own, so all-time daily cost bars across eight models drew without one.
 */
const ANIMATION: ComponentProps<typeof GraphRenderer>['animation'] = {
  maxAnimatedGeoms: 40_000,
};

type Props = {
  data: ProviderProps['data'];
  input: ProviderProps['spec'];
  /** False when the spec declares its own colour scale, e.g. a sequential heatmap ramp. */
  categoricalColor?: boolean;
  /** True when the marks carry their own category labels and the axis would repeat them. */
  hideCategoryAxis?: boolean;
  /** True for a donut, whose radius and angle carry no scale worth an axis. */
  donut?: boolean;
  /** True when the engine's legend would misdescribe the marks. */
  hideLegend?: boolean;
  /** Paint that hangs on the data, stacked above the house style. */
  paint?: ReturnType<typeof styles>;
};

const NO_CATEGORY_AXIS = config({ axes: { x: { isVisible: false } } });
const NO_LEGEND = config({ legend: { position: 'none' } });
// A top legend gets the round plot's width and folds all but two names into "+N"; a column
// beside it fits the eight slices a donut can hold. The period's total sits in the hole.
const DONUT_LAYOUT = config({
  legend: { position: 'right' },
  axes: { x: { isVisible: false }, y: { isVisible: false, grid: { isVisible: false } } },
  headline: { show: 'total', position: 'center' },
  numberFormat: { decimals: 1 },
});

/**
 * The house style is applied here rather than in each spec module, so every chart inherits
 * it and spec files stay free of paint.
 *
 * `terminalPalette` is opt-out. A later scale replaces an earlier one for the same
 * aesthetic, so piping the categorical palette unconditionally overwrote the sequential
 * ramp a heatmap declares for itself, turning 168 magnitudes into 7 cycling hues. A chart
 * whose colour encodes magnitude rather than identity passes `categoricalColor={false}`.
 */
export function Chart({
  data,
  input,
  categoricalColor = true,
  hideCategoryAxis = false,
  donut = false,
  hideLegend = false,
  paint,
}: Props) {
  const scheme = useColorScheme();

  // A quiet range is a real answer, but the engine rejects a dataset with no rows even when
  // its columns are declared, and paints its error in place of the chart.
  if (data.rows.length === 0) {
    return <p className="note">nothing in this range</p>;
  }

  const theme = chartTheme(scheme);
  const base = categoricalColor
    ? pipe(input, theme.stylesheet, terminalPalette, terminalConfig)
    : pipe(input, theme.stylesheet, terminalConfig);
  // Piped after the house config, because a later config item wins. It is the `x` axis
  // that carries the category: `coord.flip()` moves it to the left edge but the aesthetic
  // it was mapped to does not change, so hiding `y` here silently does nothing.
  let themed = base;
  if (donut) {
    themed = pipe(base, DONUT_LAYOUT);
  } else if (hideCategoryAxis) {
    themed = pipe(base, NO_CATEGORY_AXIS);
  }
  if (hideLegend) {
    themed = pipe(themed, NO_LEGEND);
  }
  if (paint !== undefined) {
    themed = pipe(themed, paint);
  }

  return (
    <GraphProvider
      data={data}
      spec={themed}
      colorScheme={scheme}
      customPalettes={theme.palettes}
    >
      <GraphRenderer animation={ANIMATION} />
    </GraphProvider>
  );
}
