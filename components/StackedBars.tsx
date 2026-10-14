'use client';

import { style, styles } from '@graphysdk/react';
import { Chart } from '@/components/Chart';
import { useColorScheme } from '@/components/useColorScheme';
import { barEdgeLayer, seriesData, type SeriesOf } from '@/lib/charts/seriesViews';
import { lightFill, seriesHues, type ColorScheme } from '@/lib/charts/theme';
import type { ComponentProps } from 'react';

type Data<T> = { columns: { key: string }[]; rows: T[] };

/**
 * A bar maps colour to its fill alone, so each series' layer is painted by hand: the faint fill
 * under an edge in full, in the hue the palette hands that series in the panel's other views.
 */
function segmentPaint(seriesOrder: readonly string[], scheme: ColorScheme) {
  const hues = seriesHues(scheme);
  return styles({
    overrides: seriesOrder.map((series, index) => {
      const hue = hues[index % hues.length];
      return style.geom.bar({ fill: lightFill(scheme, hue), stroke: hue, strokeWidth: 1.5 }, { layer: barEdgeLayer(series) });
    }),
  });
}

/** The panel's series as stacked bars, each segment filled and edged in its own hue. */
export function StackedBars<T extends object>({
  data,
  of,
  input,
}: {
  data: Data<T>;
  of: SeriesOf<T>;
  input: (seriesOrder: readonly string[]) => ComponentProps<typeof Chart>['input'];
}) {
  const scheme = useColorScheme();
  const seriesOrder = [...new Set(data.rows.map(of.series))];
  return (
    <Chart data={seriesData('stacked', data, of)} input={input(seriesOrder)} paint={segmentPaint(seriesOrder, scheme)} />
  );
}
