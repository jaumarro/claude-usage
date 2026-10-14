import { annotation, pipe, geom } from '@graphysdk/react';
import type { ModelMarker } from '@/lib/queries/timeseries';
import { seriesInput, type TimeView } from '@/lib/charts/seriesViews';
import { wallClock } from '@/lib/charts/wallClock';
import type { TimeWindow } from '@/lib/queries/aggregate';

export type TokensByModelRow = {
  day: string;
  model: string;
  tokens: number;
};

export const tokensByModelColumns = [{ key: 'day' }, { key: 'model' }, { key: 'tokens' }];

export function tokensByModelData(rows: TokensByModelRow[]) {
  return { columns: tokensByModelColumns, rows };
}

function tokensByModelBase(view: TimeView, span?: TimeWindow) {
  return seriesInput(view, { x: 'day', y: 'tokens', color: 'model' }, span);
}

export const tokensByModelInput = tokensByModelBase('stacked');

/**
 * `geom.rule` reads exactly one observation, so N markers means N layers and a static const
 * cannot express a variable count. The x constant is epoch milliseconds even though the axis
 * itself is fed ISO strings; passing a Date or ISO string here fails with INVALID_RULE_MAPPING.
 *
 * The rule carries no `label`: the renderer composes a rule pill as `label: value` from the
 * y value, and a vertical rule has none, so the built-in label renders as `sonnet-5: -`.
 * The name is drawn by a text annotation anchored in axis space instead.
 */
/**
 * `claude-fable-5-1` reads as `fable 5.1`: the leading family word, then the version parts
 * joined with dots. Splitting is used rather than a regex because the number of version
 * segments varies (`opus-5`, `opus-4-8`, `fable-5-1`).
 */
function prettyModel(model: string): string {
  const [family, ...version] = model.replace('claude-', '').split('-');
  if (version.length === 0) {
    return family ?? model;
  }
  return `${family} ${version.join('.')}`;
}

function markerName(marker: ModelMarker): string {
  const base = prettyModel(marker.model);
  // A first-use fallback is a different claim from a release date, so it is marked.
  return marker.kind === 'release' ? base : `${base} (first use)`;
}

/** Wide enough for `sonnet 5.5 (first use)` on one line in a half-width panel. */
const NAME_WIDTH = 0.25;

export function tokensByModelInputWithMarkers(
  markers: ModelMarker[],
  view: TimeView = 'stacked',
  span?: TimeWindow,
) {
  return markers.reduce(
    (spec, marker) =>
      pipe(
        spec,
        geom.rule({
          id: `release-${marker.model}`,
          aes: { x: { value: wallClock(marker.at) } },
          dataLabels: { showDataLabels: false },
        }),
        annotation.text({
          id: `release-name-${marker.model}`,
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                attrs: { textAlign: 'left' },
                content: [{ type: 'text', text: markerName(marker) }],
              },
            ],
          },
          at: { anchorType: 'axis', x: marker.bucket, y: 0, offset: { x: 4, y: -4, unit: 'px' } },
          width: NAME_WIDTH,
          align: 'bottom-left',
        }),
      ),
    tokensByModelBase(view, span),
  );
}
