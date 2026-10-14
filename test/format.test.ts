import { describe, expect, it } from 'vitest';
import { compactTokens, payback, percent } from '@/lib/format';

describe('compactTokens', () => {
  it('leaves a figure under a thousand alone', () => {
    expect(compactTokens(842)).toBe('842');
  });

  it('scales through k, m, b and t', () => {
    expect(compactTokens(1_500)).toBe('1.50k');
    expect(compactTokens(2_400_000)).toBe('2.40m');
    expect(compactTokens(10_970_000_000)).toBe('10.97b');
    expect(compactTokens(3_000_000_000_000)).toBe('3.00t');
  });
});

describe('payback', () => {
  it('turns the value ratio into the usage time that covers a month of the plan', () => {
    expect(payback(50.85)).toBe('14h');
    expect(payback(10)).toBe('3.0d');
    expect(payback(1_000)).toBe('43m');
  });

  it('says never when the usage is worth less than the plan', () => {
    expect(payback(0.5)).toBe('never');
  });

  it('has nothing to say without usage', () => {
    expect(payback(0)).toBe('n/a');
  });
});

describe('percent', () => {
  it('renders a fraction to one decimal place', () => {
    expect(percent(0.241)).toBe('24.1%');
    expect(percent(0)).toBe('0.0%');
  });
});
