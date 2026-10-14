import { annotation, createSpec, pipe, mapping, geom, scale } from '@graphysdk/react';

/** Bright enough to read over the area fill, which is the only lever available here. */
const MARKER_LABEL_COLOR = '#D6DEE8';

export type CumulativeCostRow = {
  day: string;
  cost: number;
};

export const cumulativeCostColumns = [
  { key: 'day', label: 'Bucket' },
  { key: 'cost', label: 'API equivalent' },
];

export function cumulativeCostData(rows: CumulativeCostRow[]) {
  return { columns: cumulativeCostColumns, rows };
}

export const cumulativeCostInput = pipe(
  createSpec(),
  mapping({ x: 'day', y: 'cost' }),
  geom.area({ position: 'identity' }),
  scale.x.datetime(),
  scale.y(),
);

export type SubscriptionLine = {
  /** Dollars the subscription costs over the plotted span. */
  thresholdUsd: number;
  /** Epoch milliseconds of the crossing bucket, or null while the curve is below the line. */
  crossingAt: number | null;
  /** The same bucket as the label the rows carry, which is what an axis anchor matches on. */
  crossingDay: string | null;
};

function crossingLabel(day: string) {
  return annotation.text({
    id: 'paid-for-itself-label',
    at: {
      anchorType: 'axis',
      x: day,
      y: 0,
      align: 'bottom-left',
      offset: { x: 3, y: -14, unit: 'px' },
    },
    width: 0.16,
    align: 'bottom-left',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'left' },
          content: [
            {
              type: 'text',
              text: 'paid for itself',
              marks: [{ type: 'textStyle', attrs: { color: MARKER_LABEL_COLOR, fontSize: 9 } }],
            },
          ],
        },
      ],
    },
  });
}

/**
 * The threshold moves with the plotted span, so it cannot be a constant in the spec.
 *
 * The crossing marker is a vertical rule, whose x constant is epoch milliseconds even though
 * the axis itself is fed the bucket labels. It carries no `label`: the renderer composes a
 * rule pill as `label: value` from the y value, and a vertical rule has none, so the built-in
 * label would render as `paid for itself: -`. The text comes from an axis-anchored
 * annotation instead, which matches on the bucket label rather than the epoch.
 */
export function cumulativeCostInputWithSubscription({
  thresholdUsd,
  crossingAt,
  crossingDay,
}: SubscriptionLine) {
  const withLine = pipe(
    cumulativeCostInput,
    geom.rule({
      id: 'subscription',
      aes: { y: { value: thresholdUsd } },
      params: { label: 'subscription' },
    }),
  );

  if (crossingAt === null || crossingDay === null) {
    return withLine;
  }

  return pipe(
    withLine,
    geom.rule({ id: 'paid-for-itself', aes: { x: { value: crossingAt } } }),
    crossingLabel(crossingDay),
  );
}
