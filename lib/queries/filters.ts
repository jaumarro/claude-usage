import {
  isRange,
  isSurface,
  sinceFor,
  type QueryFilters,
  type Range,
  type Surface,
} from '@/lib/queries/aggregate';

export const DEFAULT_RANGE: Range = '30d';
export const DEFAULT_SURFACE: Surface = 'all';

type Parsed = { ok: true; filters: QueryFilters; range: Range } | { ok: false; error: string };

/** Reads the two global filters every usage route accepts. */
export function filtersFromParams(params: URLSearchParams): Parsed {
  const range = params.get('range') ?? DEFAULT_RANGE;
  const surface = params.get('surface') ?? DEFAULT_SURFACE;

  if (!isRange(range)) {
    return { ok: false, error: `unknown range: ${range}` };
  }
  if (!isSurface(surface)) {
    return { ok: false, error: `unknown surface: ${surface}` };
  }

  return { ok: true, filters: { since: sinceFor(range), surface }, range };
}

/** Day counts the status route accepts, mirroring the shared range filter. */
export const RANGE_DAYS: Record<Range, number> = {
  // The status route counts whole days, so anything under a day asks for one.
  '3h': 1,
  today: 1,
  '3d': 3,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: 3650,
};
