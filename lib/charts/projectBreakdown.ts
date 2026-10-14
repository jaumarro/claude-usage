import { createSpec, pipe, mapping, geom, scale, coord } from '@graphysdk/react';

export type ProjectBreakdownRow = {
  label: string;
  full: string;
  tokens: number;
};

export const projectBreakdownColumns = [{ key: 'label' }, { key: 'full' }, { key: 'tokens' }];

export function projectBreakdownData(rows: ProjectBreakdownRow[]) {
  return { columns: projectBreakdownColumns, rows };
}

export const projectBreakdownInput = pipe(
  createSpec(),
  mapping({ x: 'label', y: 'tokens' }),
  // Project paths are long and the panel is half width, so a category axis would spend
  // most of the plot on labels. The name rides inside its own bar instead, and the values line
  // up at the plot's right edge: placed at a short bar's end, a value lands on the name that
  // overflows it. The axis itself is switched off by the panel.
  geom.bar({
    dataLabels: {
      showCategoryLabels: true,
      categoryPosition: 'inside',
      categoryJustify: 'start',
      categoryAlign: 'center',
      showDataLabels: true,
      position: 'outside',
      justify: 'panel-end',
    },
  }),
  coord.flip(),
  scale.x.discrete(),
  scale.y(),
);
