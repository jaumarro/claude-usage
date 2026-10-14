#!/usr/bin/env node
// Claude Code pipes session JSON on stdin and prints whatever this writes to stdout as the
// status line. Every step is best-effort: a throw here would degrade the user's terminal, so
// nothing in this file is allowed to escape, and something is always printed.

import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const THROTTLE_MS = 60_000;

function usageDir() {
  const override = process.env.CLAUDE_USAGE_DIR;
  if (typeof override === 'string' && override !== '') {
    return override;
  }
  return join(homedir(), '.claude-usage');
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parse(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    return {};
  }
  return {};
}

function obj(value) {
  if (value !== null && typeof value === 'object') {
    return value;
  }
  return {};
}

function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function text(value) {
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  return null;
}

function windowOf(rateLimits, name) {
  const window = obj(obj(rateLimits)[name]);
  return { pct: num(window.used_percentage), resetsAt: num(window.resets_at) };
}

function hitRatio(cache) {
  const reported = num(cache.hit_ratio);
  if (reported !== null) {
    return reported;
  }
  const requests = num(cache.requests);
  const misses = num(cache.misses);
  if (requests === null || misses === null || requests <= 0) {
    return null;
  }
  return (requests - misses) / requests;
}

function flag(value) {
  if (typeof value !== 'boolean') {
    return null;
  }
  return value ? 1 : 0;
}

function sample(payload) {
  const cache = obj(payload.prompt_cache);
  const pr = obj(payload.pr);
  const fiveHour = windowOf(payload.rate_limits, 'five_hour');
  const sevenDay = windowOf(payload.rate_limits, 'seven_day');
  const spend = windowOf(payload.rate_limits, 'spend_limit');

  return {
    t: Date.now(),
    session_id: text(payload.session_id),
    fh_pct: fiveHour.pct,
    fh_resets_at: fiveHour.resetsAt,
    sd_pct: sevenDay.pct,
    sd_resets_at: sevenDay.resetsAt,
    spend_pct: spend.pct,
    spend_resets_at: spend.resetsAt,
    cache_hit_ratio: hitRatio(cache),
    cache_warm: flag(cache.warm),
    pr_number: num(pr.number),
    pr_review_state: text(pr.review_state),
    worktree_branch: text(obj(payload.worktree).branch),
  };
}

function hasWindow(record) {
  return record.fh_pct !== null || record.sd_pct !== null || record.spend_pct !== null;
}

function writtenRecently(path) {
  try {
    return Date.now() - statSync(path).mtimeMs < THROTTLE_MS;
  } catch {
    return false;
  }
}

function capture(record) {
  if (!hasWindow(record)) {
    return;
  }
  try {
    const dir = usageDir();
    const path = join(dir, 'statusline.jsonl');
    if (writtenRecently(path)) {
      return;
    }
    mkdirSync(dir, { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`);
  } catch {
    // A failed capture must not cost the user their status line.
  }
}

function pct(value) {
  return `${Math.round(value)}%`;
}

function line(payload, record) {
  const parts = [];
  const model = text(obj(payload.model).display_name);
  if (model !== null) {
    parts.push(model);
  }
  const branch = record.worktree_branch;
  if (branch !== null) {
    parts.push(branch);
  }
  const context = num(obj(payload.context_window).used_percentage);
  if (context !== null) {
    parts.push(`ctx ${pct(context)}`);
  }
  if (record.fh_pct !== null) {
    parts.push(`5h ${pct(record.fh_pct)}`);
  }
  if (record.sd_pct !== null) {
    parts.push(`7d ${pct(record.sd_pct)}`);
  }
  if (record.spend_pct !== null) {
    parts.push(`spend ${pct(record.spend_pct)}`);
  }
  if (record.pr_number !== null) {
    parts.push(`PR #${record.pr_number}`);
  }
  if (parts.length === 0) {
    return 'claude';
  }
  return parts.join(' · ');
}

function main() {
  let output = 'claude';
  try {
    const payload = parse(readStdin());
    const record = sample(payload);
    output = line(payload, record);
    capture(record);
  } catch {
    // Fall through to the default output.
  }
  process.stdout.write(`${output}\n`);
}

main();
