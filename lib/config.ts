import { homedir } from 'node:os';
import { join } from 'node:path';

/** Max 20x. Value captured and payback are measured against it. */
const DEFAULT_PLAN_USD = 200;

/** What the subscription costs per month in dollars: `CLAUDE_USAGE_PLAN_USD`, or Max 20x's $200. */
export function planMonthlyUsd(): number {
  const override = Number(process.env.CLAUDE_USAGE_PLAN_USD);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_PLAN_USD;
}

/** The folder project paths are named relative to: `CLAUDE_USAGE_PROJECTS_DIR`, or `~/projects`. */
export function projectsDir(): string {
  const override = process.env.CLAUDE_USAGE_PROJECTS_DIR;
  if (typeof override === 'string' && override !== '') {
    return override;
  }
  return join(homedir(), 'projects');
}
