export const TOKEN_TYPES = [
  'input',
  'output',
  'cacheWrite5m',
  'cacheWrite1h',
  'cacheRead',
] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];

/** Dollars per million tokens. */
export type Rates = Record<TokenType, number>;

export type TokenCounts = Record<TokenType, number>;

export type PricingVersion = {
  effectiveFrom: string;
  source: string;
  rates: Record<string, Rates>;
};

/**
 * Ordered oldest first. A version lists only the models whose rates it sets, and a launch or
 * a price change appends one rather than editing an earlier one, so every day keeps the
 * rates that were in force on it.
 */
export const PRICING_VERSIONS: PricingVersion[] = [
  {
    effectiveFrom: '2026-09-04',
    source: 'platform.claude.com/docs/en/about-claude/pricing',
    rates: {
      'claude-fable-5-1': {
        input: 10,
        output: 50,
        cacheWrite5m: 12.5,
        cacheWrite1h: 20,
        cacheRead: 0.25,
      },
      'claude-fable-5': {
        input: 10,
        output: 50,
        cacheWrite5m: 12.5,
        cacheWrite1h: 20,
        cacheRead: 1,
      },
      'claude-opus-5': {
        input: 5,
        output: 25,
        cacheWrite5m: 6.25,
        cacheWrite1h: 10,
        cacheRead: 0.5,
      },
      'claude-opus-4-8': {
        input: 5,
        output: 25,
        cacheWrite5m: 6.25,
        cacheWrite1h: 10,
        cacheRead: 0.5,
      },
      'claude-opus-4-7': {
        input: 5,
        output: 25,
        cacheWrite5m: 6.25,
        cacheWrite1h: 10,
        cacheRead: 0.5,
      },
      'claude-sonnet-5': {
        input: 2,
        output: 10,
        cacheWrite5m: 2.5,
        cacheWrite1h: 4,
        cacheRead: 0.2,
      },
      'claude-haiku-4-5': {
        input: 1,
        output: 5,
        cacheWrite5m: 1.25,
        cacheWrite1h: 2,
        cacheRead: 0.1,
      },
    },
  },
  {
    effectiveFrom: '2026-09-22',
    source: 'platform.claude.com/docs/en/about-claude/pricing',
    rates: {
      'claude-opus-5-5': {
        input: 4,
        output: 20,
        cacheWrite5m: 5,
        cacheWrite1h: 8,
        cacheRead: 0.2,
      },
    },
  },
  {
    effectiveFrom: '2026-09-28',
    source: 'platform.claude.com/docs/en/about-claude/pricing',
    rates: {
      'claude-sonnet-5-5': {
        input: 2,
        output: 10,
        cacheWrite5m: 2.5,
        cacheWrite1h: 4,
        cacheRead: 0.2,
      },
    },
  },
];

const DATED_SNAPSHOT = /-\d{8}$/;

/** Session logs carry dated snapshots such as `claude-haiku-4-5-20251001`, priced as the base. */
export function baseModel(model: string): string {
  return model.replace(DATED_SNAPSHOT, '');
}

/**
 * The latest version in force on `day` that lists the model. A day before its first listing
 * falls back to that listing: it is the earliest price known, and a week bucket that starts
 * the Monday before a launch still has to be priced.
 */
export function ratesFor(
  model: string,
  day: string,
  versions: PricingVersion[] = PRICING_VERSIONS,
): Rates | undefined {
  const base = baseModel(model);
  const listing = versions.filter((version) => version.rates[base] !== undefined);
  const inForce = listing.filter((version) => version.effectiveFrom <= day);
  return (inForce.at(-1) ?? listing.at(0))?.rates[base];
}

export function costOf(counts: TokenCounts, rates: Rates): number {
  const micros = TOKEN_TYPES.reduce((sum, type) => sum + counts[type] * rates[type], 0);
  return micros / 1_000_000;
}
