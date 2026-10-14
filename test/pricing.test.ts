import { describe, expect, it } from 'vitest';
import {
  PRICING_VERSIONS,
  TOKEN_TYPES,
  baseModel,
  costOf,
  ratesFor,
  type PricingVersion,
  type TokenCounts,
} from '@/lib/pricing';

const TODAY = '2026-09-04';

const NOTHING: TokenCounts = {
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
};

describe('pricing table', () => {
  it('prices every model the corpus contains', () => {
    const models = [
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-fable-5',
      'claude-fable-5-1',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ];

    for (const model of models) {
      const rates = ratesFor(model, TODAY);
      expect(rates, model).toBeDefined();
      for (const type of TOKEN_TYPES) {
        expect(rates?.[type], `${model}.${type}`).toBeGreaterThan(0);
      }
    }
  });

  it('carries the published dollars per million tokens for the opus tier', () => {
    expect(ratesFor('claude-opus-5', TODAY)).toEqual({
      input: 5,
      output: 25,
      cacheWrite5m: 6.25,
      cacheWrite1h: 10,
      cacheRead: 0.5,
    });
  });

  it('prices fable 5.1 cache reads at 0.025x input, not the usual 0.1x', () => {
    expect(ratesFor('claude-fable-5-1', TODAY)?.cacheRead).toBe(0.25);
    expect(ratesFor('claude-fable-5', TODAY)?.cacheRead).toBe(1);
  });

  it('prices the sonnet and haiku tiers', () => {
    expect(ratesFor('claude-sonnet-5', TODAY)).toEqual({
      input: 2,
      output: 10,
      cacheWrite5m: 2.5,
      cacheWrite1h: 4,
      cacheRead: 0.2,
    });
    expect(ratesFor('claude-haiku-4-5', TODAY)).toEqual({
      input: 1,
      output: 5,
      cacheWrite5m: 1.25,
      cacheWrite1h: 2,
      cacheRead: 0.1,
    });
  });

  it('resolves a dated model snapshot to its base model', () => {
    expect(baseModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(baseModel('claude-opus-5')).toBe('claude-opus-5');
    expect(ratesFor('claude-haiku-4-5-20251001', TODAY)).toEqual(
      ratesFor('claude-haiku-4-5', TODAY),
    );
  });

  it('prices opus 5.5 from its launch, with cache reads at 0.05x input', () => {
    expect(ratesFor('claude-opus-5-5', '2026-09-22')).toEqual({
      input: 4,
      output: 20,
      cacheWrite5m: 5,
      cacheWrite1h: 8,
      cacheRead: 0.2,
    });
  });

  it('prices sonnet 5.5 from its launch', () => {
    expect(ratesFor('claude-sonnet-5-5', '2026-09-28')).toEqual({
      input: 2,
      output: 10,
      cacheWrite5m: 2.5,
      cacheWrite1h: 4,
      cacheRead: 0.2,
    });
  });

  it('keeps opus 5 on its own rates after the 5.5 launch', () => {
    expect(ratesFor('claude-opus-5', '2026-09-30')).toEqual(ratesFor('claude-opus-5', TODAY));
  });

  it('leaves an unknown model unpriced rather than pricing it at zero', () => {
    expect(ratesFor('claude-unreleased-9', TODAY)).toBeUndefined();
    expect(ratesFor('unknown', TODAY)).toBeUndefined();
    expect(ratesFor('<synthetic>', TODAY)).toBeUndefined();
  });
});

describe('ratesFor by effective date', () => {
  it('stamps every version with an effective date, oldest first', () => {
    const dates = PRICING_VERSIONS.map((version) => version.effectiveFrom);
    expect(dates.length).toBeGreaterThan(0);
    expect([...dates].sort()).toEqual(dates);
  });

  it('keeps a past period on the rates in force at the time', () => {
    const versions = [
      { effectiveFrom: '2026-01-01', source: 'a', rates: { m: { ...NOTHING, input: 3 } } },
      { effectiveFrom: '2026-06-01', source: 'b', rates: { m: { ...NOTHING, input: 7 } } },
    ];

    expect(ratesFor('m', '2026-05-31', versions)?.input).toBe(3);
    expect(ratesFor('m', '2026-06-01', versions)?.input).toBe(7);
    expect(ratesFor('m', '2026-09-04', versions)?.input).toBe(7);
  });

  it('falls back to the oldest version for a day before any version starts', () => {
    const versions = [
      { effectiveFrom: '2026-06-01', source: 'b', rates: { m: { ...NOTHING, input: 7 } } },
    ];

    expect(ratesFor('m', '2026-01-01', versions)?.input).toBe(7);
  });

  it('keeps a rate from an earlier version when a later one does not list the model', () => {
    const versions: PricingVersion[] = [
      { effectiveFrom: '2026-06-01', source: 'a', rates: { m: { ...NOTHING, input: 7 } } },
      { effectiveFrom: '2026-09-01', source: 'b', rates: { n: { ...NOTHING, input: 9 } } },
    ];

    expect(ratesFor('m', '2026-09-30', versions)?.input).toBe(7);
  });

  it("prices a day before a model's first listing at that first listed rate", () => {
    const versions: PricingVersion[] = [
      { effectiveFrom: '2026-06-01', source: 'a', rates: { m: { ...NOTHING, input: 7 } } },
      { effectiveFrom: '2026-09-02', source: 'b', rates: { n: { ...NOTHING, input: 9 } } },
    ];

    expect(ratesFor('n', '2026-08-31', versions)?.input).toBe(9);
  });
});

describe('costOf', () => {
  it('charges each token type at its own rate', () => {
    const rates = ratesFor('claude-opus-5', TODAY);
    expect(rates).toBeDefined();
    if (rates === undefined) {
      return;
    }

    const counts: TokenCounts = {
      input: 2,
      output: 366,
      cacheWrite5m: 100,
      cacheWrite1h: 1000,
      cacheRead: 7000,
    };

    expect(costOf(counts, rates)).toBeCloseTo(0.023285, 12);
  });

  it('charges a cache read at a tenth of the input rate', () => {
    const rates = ratesFor('claude-opus-5', TODAY);
    expect(rates).toBeDefined();
    if (rates === undefined) {
      return;
    }

    const read = costOf({ ...NOTHING, cacheRead: 1_000_000 }, rates);
    const input = costOf({ ...NOTHING, input: 1_000_000 }, rates);

    expect(read).toBeCloseTo(input / 10, 12);
  });

  it('charges a 1h cache write at twice the input rate and a 5m write at 1.25x', () => {
    const rates = ratesFor('claude-fable-5', TODAY);
    expect(rates).toBeDefined();
    if (rates === undefined) {
      return;
    }

    expect(costOf({ ...NOTHING, cacheWrite1h: 1_000_000 }, rates)).toBeCloseTo(20, 12);
    expect(costOf({ ...NOTHING, cacheWrite5m: 1_000_000 }, rates)).toBeCloseTo(12.5, 12);
  });

  it('costs nothing when nothing was consumed', () => {
    const rates = ratesFor('claude-opus-5', TODAY);
    expect(rates).toBeDefined();
    if (rates === undefined) {
      return;
    }

    expect(costOf(NOTHING, rates)).toBe(0);
  });
});
