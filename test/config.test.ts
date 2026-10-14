import { afterEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { planMonthlyUsd, projectsDir } from '@/lib/config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('planMonthlyUsd', () => {
  it('defaults to Max 20x', () => {
    vi.stubEnv('CLAUDE_USAGE_PLAN_USD', '');

    expect(planMonthlyUsd()).toBe(200);
  });

  it('takes another plan from the environment', () => {
    vi.stubEnv('CLAUDE_USAGE_PLAN_USD', '100');

    expect(planMonthlyUsd()).toBe(100);
  });

  it('ignores a value that is not a price', () => {
    vi.stubEnv('CLAUDE_USAGE_PLAN_USD', 'max');

    expect(planMonthlyUsd()).toBe(200);
  });
});

describe('projectsDir', () => {
  it('defaults to ~/projects', () => {
    vi.stubEnv('CLAUDE_USAGE_PROJECTS_DIR', '');

    expect(projectsDir()).toBe(join(homedir(), 'projects'));
  });

  it('takes another folder from the environment', () => {
    vi.stubEnv('CLAUDE_USAGE_PROJECTS_DIR', '/code');

    expect(projectsDir()).toBe('/code');
  });
});
