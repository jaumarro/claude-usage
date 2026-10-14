import type { DatabaseSync } from 'node:sqlite';
import { projectsDir } from '@/lib/config';
import type { ProjectBreakdownRow } from '@/lib/charts/projectBreakdown';
import { perRequest, ALL_TIME_ALL_SURFACES, type QueryFilters } from '@/lib/queries/aggregate';

export const BREAKDOWN_DIMENSIONS = ['project'] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export const DEFAULT_PROJECT_LIMIT = 15;

/**
 * A request that spans several log lines is collapsed to one row at the maximum of each
 * token field before anything is summed. Thinking is already inside output.
 */
const TOKENS = 'SUM(input + output + cache_read + cache_create_5m + cache_create_1h)';

function projectSql(filters: QueryFilters): string {
  return `${perRequest(filters)}
  SELECT COALESCE(project, 'unknown') AS project, ${TOKENS} AS tokens
  FROM per_request
  GROUP BY project
  ORDER BY tokens DESC, project
  LIMIT ?`;
}

export function isBreakdownDimension(value: string): value is BreakdownDimension {
  return BREAKDOWN_DIMENSIONS.some((dimension) => dimension === value);
}

/** Worktree checkouts share a project root, so the remainder of the path is the identity. */
export function shortenProject(path: string): string {
  const root = `${projectsDir()}/`;
  if (!path.startsWith(root)) {
    return path;
  }
  return path.slice(root.length);
}

/** Wide enough for a worktree name, narrow enough to sit inside a bar in a half-width panel. */
const LABEL_MAX = 40;

/**
 * A long path keeps its first segment and as many trailing ones as fit, since the tail is what
 * tells worktrees apart. A path with no room for that keeps its end.
 */
export function ellipsizePath(path: string, max: number = LABEL_MAX): string {
  if (path.length <= max) {
    return path;
  }
  const segments = path.split('/');
  const head = segments[0] ?? '';
  let tail = segments[segments.length - 1] ?? '';
  for (let index = segments.length - 2; index > 0; index -= 1) {
    const longer = `${segments[index]}/${tail}`;
    if (`${head}/…/${longer}`.length > max) {
      break;
    }
    tail = longer;
  }
  const kept = `${head}/…/${tail}`;
  if (segments.length > 1 && kept.length <= max) {
    return kept;
  }
  return `…${path.slice(-(max - 1))}`;
}

export function projectTotals(
  db: DatabaseSync,
  limit: number = DEFAULT_PROJECT_LIMIT,
  filters: QueryFilters = ALL_TIME_ALL_SURFACES,
): ProjectBreakdownRow[] {
  return db
    .prepare(projectSql(filters))
    .all(limit)
    .map((row) => {
      const full = String(row.project);
      return { label: ellipsizePath(shortenProject(full)), full, tokens: Number(row.tokens) };
    });
}
