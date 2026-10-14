const UNITS = [
  { limit: 1e12, suffix: 't' },
  { limit: 1e9, suffix: 'b' },
  { limit: 1e6, suffix: 'm' },
  { limit: 1e3, suffix: 'k' },
];

export function compactTokens(tokens: number): string {
  const unit = UNITS.find((candidate) => tokens >= candidate.limit);
  if (unit === undefined) {
    return String(tokens);
  }
  return `${(tokens / unit.limit).toFixed(2)}${unit.suffix}`;
}

export function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** The plan is pro-rated over 30-day months, the same month the value ratio is measured in. */
const HOURS_PER_MONTH = 30 * 24;

/** How much of the period's average usage it takes to cover one month of the plan. */
export function payback(valueRatio: number): string {
  if (valueRatio <= 0) {
    return 'n/a';
  }
  if (valueRatio < 1) {
    return 'never';
  }
  const hours = HOURS_PER_MONTH / valueRatio;
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }
  if (hours < 48) {
    return `${Math.round(hours)}h`;
  }
  return `${(hours / 24).toFixed(1)}d`;
}
