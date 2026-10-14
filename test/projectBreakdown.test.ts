import { describe, expect, it } from 'vitest';
import { createCompiler } from '@graphysdk/viz-engine';
import { projectBreakdownData, projectBreakdownInput } from '@/lib/charts/projectBreakdown';

const ROWS = [
  { label: 'claude-usage', full: '/Users/j/projects/claude-usage', tokens: 900 },
  { label: 'worktrees/monorepo/feat-overlay', full: '/Users/j/projects/wt/feat', tokens: 400 },
  { label: 'notes', full: '/Users/j/projects/notes', tokens: 120 },
];

describe('projectBreakdown spec', () => {
  it('compiles a bar layer', () => {
    const result = createCompiler().compile({
      spec: projectBreakdownInput,
      data: projectBreakdownData(ROWS),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scene.layers).toHaveLength(1);
    expect(result.scene.layers[0].geom).toBe('bar');
  });

  it('flips the coordinate system so long project names read horizontally', () => {
    const result = createCompiler().compile({
      spec: projectBreakdownInput,
      data: projectBreakdownData(ROWS),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const coordSystem = result.scene.coordSystem;
    expect(coordSystem.type).toBe('cartesian');
    if (coordSystem.type !== 'cartesian') {
      return;
    }
    expect(coordSystem.mainAxis).toBe('y');
  });

  it('carries the full path alongside the shortened label', () => {
    expect(projectBreakdownData(ROWS).columns).toEqual([
      { key: 'label' },
      { key: 'full' },
      { key: 'tokens' },
    ]);
  });
});

describe('projectBreakdown labels', () => {
  it('lines the values up at the right edge, clear of the names', () => {
    const rows = [
      { label: 'monorepo', full: '/Users/x/projects/monorepo', tokens: 900 },
      { label: 'world-gen', full: '/Users/x/projects/world-gen', tokens: 120 },
    ];
    const result = createCompiler().compile({
      spec: projectBreakdownInput,
      data: projectBreakdownData(rows),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const labels = result.scene.layers[0]?.dataLabels;
    expect(labels?.justify).toBe('panel-end');
    expect(result.warnings).toEqual([]);
  });

  it('carries the project name on the bar itself', () => {
    const rows = [
      { label: 'monorepo', full: '/Users/x/projects/monorepo', tokens: 900 },
      { label: 'world-gen', full: '/Users/x/projects/world-gen', tokens: 120 },
    ];
    const result = createCompiler().compile({
      spec: projectBreakdownInput,
      data: projectBreakdownData(rows),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Long worktree paths would otherwise spend most of a half-width panel on the axis.
    const labels = result.scene.layers[0]?.dataLabels;
    expect(labels?.showCategoryLabels).toBe(true);
    expect(labels?.categoryPosition).toBe('inside');
    expect(result.warnings).toEqual([]);
  });
});

describe('projectBreakdown axis', () => {
  it('maps the category to x, which coord.flip renders on the left', () => {
    const rows = [{ label: 'monorepo', full: '/a/monorepo', tokens: 900 }];
    const result = createCompiler().compile({
      spec: projectBreakdownInput,
      data: projectBreakdownData(rows),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Guards the axis the panel switches off: hiding `y` instead does nothing at all.
    expect(result.scene.scales.x?.domain).toEqual(['monorepo']);
    expect(result.scene.scales.x?.spec?.scaleType).toBe('discrete');
  });
});
