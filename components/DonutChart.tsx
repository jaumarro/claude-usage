'use client';

import { style, styles } from '@graphysdk/react';
import { Chart } from '@/components/Chart';
import { useColorScheme } from '@/components/useColorScheme';
import {
  donutData,
  donutEdgeLayer,
  donutInput,
  donutSlices,
  shareColorOverrides,
  type DonutSlice,
  type ShareTotal,
} from '@/lib/charts/categoryShare';
import { PALETTE_ID, chartTheme, type ColorScheme } from '@/lib/charts/theme';

/**
 * A bar maps colour to its fill alone, so each slice's edge layer is stroked by hand in the hue
 * the colour scale gives the slice, and left unfilled.
 */
function edgeStrokes(slices: DonutSlice[], seriesOrder: readonly string[], scheme: ColorScheme) {
  const theme = chartTheme(scheme);
  const hues = theme.palettes?.[PALETTE_ID] ?? [];
  const categories = slices.map((slice) => slice.category);
  const overrides = shareColorOverrides(categories, seriesOrder, theme.neutral);
  return styles({
    overrides: categories.map((category, index) => {
      const override = overrides[index + 1];
      const hue = override !== undefined && 'id' in override ? hues.find((entry) => entry.id === override.id) : undefined;
      const stroke = hue?.hex ?? theme.neutral;
      return style.geom.bar({ fillAlpha: 0, stroke, strokeWidth: 1.5 }, { layer: donutEdgeLayer(category) });
    }),
  });
}

/** The period's total as a donut, each slice in the hue the panel's series views give it. */
export function DonutChart({
  totals,
  seriesOrder,
  order,
}: {
  totals: ShareTotal[];
  seriesOrder: readonly string[];
  /** The categories' own order, when they have one; largest first otherwise. */
  order?: readonly string[];
}) {
  const scheme = useColorScheme();
  const slices = donutSlices(totals, order);

  return (
    <Chart
      categoricalColor={false}
      donut
      data={donutData(slices)}
      input={donutInput(slices, seriesOrder, chartTheme(scheme).neutral)}
      paint={edgeStrokes(slices, seriesOrder, scheme)}
    />
  );
}
