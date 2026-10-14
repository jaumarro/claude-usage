# Claude Usage Dashboard: Design

Date: 2026-09-04
Status: approved, not yet implemented

## Problem

I pay $200/month for Claude Max 20x across Claude Code in the terminal, Claude Code in
the desktop app, and Claude desktop chat. Nothing tells me where that consumption goes
or whether the tier is right. Existing tools each cover one surface and stop.

This project answers three questions in one place: where the tokens go, what they would
cost at API rates, and how close each rate-limit window runs.

## Coverage

"Full Claude" means every surface appears, each measured with the best signal that
actually exists for it.

| Surface | Signal | Unit |
| --- | --- | --- |
| Claude Code, terminal (`entrypoint: cli`) | session jsonl | tokens, exact |
| Claude Code, desktop app (`entrypoint: claude-desktop`) | session jsonl | tokens, exact |
| Desktop chat and claude.ai | quota deltas with no concurrent Code activity | share of quota, estimated |
| All surfaces combined | `rate_limits` and `plan-usage-history.json` | quota percentage, exact |

Measured over 2026-08-25 to 2026-09-04, the desktop app is 97.4% of Code tokens and the
terminal 2.6%, so the desktop-versus-terminal split is a real axis, not a footnote.

Token figures cover Claude Code only and are always labelled as such. Quota figures
cover everything. The two are never summed into one number.

## Data sources

Verified by inspecting the machine on 2026-09-04.

### 1. Session logs, `~/.claude/projects/**/*.jsonl`

510 files, 1.1 GB. Each assistant record carries `message.model`, `message.usage`,
`timestamp`, `cwd`, `gitBranch`, `sessionId`, `requestId`, `uuid`, `version`, `effort`,
`entrypoint` and `isSidechain`. Usage breaks down into input, output,
`output_tokens_details.thinking_tokens`, `cache_read_input_tokens`, and
`cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`.

`apiBlockIndex` indexes API calls within a turn (observed 0, 1, 2). It is not a
rate-limit window and is unused here.

### 2. Statusline collector (opt-in, not installed)

**Status: built but deliberately not enabled.** Installing it means adding a `statusLine`
entry to `~/.claude/settings.json`, which changes Claude Code itself for every session on
the machine and couples the status bar to this repo's path. That is a bigger footprint than
a usage dashboard should ask for, so it stays off by default and the app degrades to source
3 below. The script is kept because the tradeoff is the user's to revisit, not because the
app assumes it.

Consequences while it is off: no exact `resets_at`, so the status panel says the reset time
is unknown; no `prompt_cache` stats; and no `pr.number`, so cost per merged PR (S11) cannot
be exact and must either fall back to a git-log join or be dropped.


Claude Code passes JSON on stdin to any configured statusline command. Relevant fields:

- `rate_limits.five_hour.used_percentage` and `.resets_at` (Unix epoch seconds)
- `rate_limits.seven_day.used_percentage` and `.resets_at`
- `rate_limits.spend_limit.*` when behind a Claude apps gateway
- `prompt_cache` (hit ratio, misses, warm)
- `pr.number`, `pr.review_state`
- `worktree.name`, `worktree.branch`
- `context_window.*`, `session_id`, `version`

`resets_at` gives exact window boundaries, so no boundary inference is needed anywhere
in this design. `rate_limits` appears only for Pro and Max subscribers and only after
the first API response in a session, and Claude Code drops a window once its `resets_at`
passes, so every field is read defensively.

No statusline is currently configured on this machine, so this source starts empty and
accumulates from install.

### 3. `~/Library/Application Support/Claude/plan-usage-history.json`

Account-wide quota samples: `fh` (5-hour %) and `sd` (7-day %), currently 854 samples
from 2026-08-06, sampled roughly every 5 to 18 minutes. Behaves as a rolling buffer, so
snapshotting it into SQLite is what accumulates history. This is the only signal that
sees desktop chat, and it only updates while the desktop app runs.

### What does not exist

Desktop chat token counts. The claude.ai IndexedDB and Local Storage leveldb under the
Claude app hold conversation text cache only; a scan for `input_tokens`, `output_tokens`
and `usage` keys returns nothing. Desktop chat is therefore represented as a share of
quota, never as tokens.

The Anthropic Console usage API is out of scope: it reports only usage billed to
organization API keys and cannot see subscription consumption.

## Baseline

From the current data, to be superseded once the app runs:

- Peak `fh` 97%, peak `sd` 60%. The binding constraint is burst rate, not the weekly cap.
- Model mix: Opus 5 55.5%, Fable 5.1 23.6%, Opus 4.8 11.5%, Fable 5 9.3%, Sonnet 5 0.0%.
- Effort mix: high 85.9%, max 10.7%, low 0.0%. Thinking is 24.1% of all output tokens.
- Token mix: cache read 96.5%, cache creation 3.2%, output 0.4%.
- Session-start `cache_creation`: median 31k, p90 89k, max 912k tokens.
- 68.1% of `requestId`s appear on more than one line.
- Sidechain traffic: 0%. Subagent attribution is deliberately not built.

## Architecture

Next.js App Router, route handlers for file work, better-sqlite3 for storage,
`@graphysdk/react` for charts. One `pnpm dev`.

```
jsonl ingester  ─┐
statusline log  ─┼─> SQLite ─> dedup-correct queries ─> API routes ─> dashboard
quota snapshot  ─┘
```

Lean by construction: three ingesters, four library modules, six routes, one page.
Anything already solved well elsewhere and not load-bearing here is left out.

## Modules

### `ingest/code.ts`

Streams the jsonl line by line; 1.1 GB rules out whole-file parsing. Keeps records with
`type === "assistant"` and a `message.usage`. Per-file resume state (path, size, mtime,
byte offset) means re-runs read only appended bytes.

Storage is lossless, keyed on `uuid`, which is unique per line. Deduplication happens at
query time, because a `requestId` legitimately spans several lines when a request is
retried or streamed in iterations, and 68.1% of requests in the current corpus do. Every
aggregation collapses to one row per `requestId` first, taking the maximum per token
field, then sums across requests. PR 1 measures the real multiplicity and asserts the
rule against fixtures before anything else is built on it.

### `ingest/statusline.ts`

A small script installed as the `statusLine` command in `~/.claude/settings.json`. It
prints the status line the user sees and appends the interesting fields to a JSONL log
as a side effect. The reader ingests that log into SQLite.

The script must be fast and must never fail the status line: it writes best-effort,
swallows its own errors, and prints regardless.

### `ingest/quota.ts`

Reads `plan-usage-history.json` and upserts samples by timestamp.

### `lib/pricing.ts`

Per model, per token type, in dollars per million tokens: input, output, cache write 5m,
cache write 1h, cache read. Rates are taken from the `claude-api` skill at implementation
time rather than written from memory, and version-stamped with an effective date so past
periods keep the rates they were priced at.

### `lib/attribution.ts`

Splits consumption by surface. Terminal and desktop Code come straight from
`entrypoint`. For other surfaces, a rise in quota across an interval containing zero
Code events is attributed to desktop chat. Summed over a period this yields the share of
quota that non-Code usage consumes, which is the closest measurable answer to "how much
is desktop chat costing me".

### `lib/overhead.ts`

Session-start `cache_creation` is the system prompt, tool definitions and skill listings,
paid once per session (median 31k, p90 89k tokens here). This module tracks that baseline
over time and correlates it against the MCP servers enabled in
`claude_desktop_config.json` and `~/.claude/settings.json`, so a server that is
configured but dead or unauthenticated shows up as recurring cost. Output is a per-session
overhead figure and a ranked list of what is inflating it.

### `lib/caps.ts`

Pairs Code tokens in a window against the quota percentage at that moment and regresses
across windows to estimate the cap in token units. Windows that `attribution.ts` marks as
contaminated by non-Code usage are excluded. Reports r², sample count and a confidence
band, and declines to state a cap when too few clean windows exist rather than guessing.

Per-tier limits do not scale linearly with the advertised multiplier. Claude Code Usage
Monitor's published calibration is roughly 19k tokens for Pro, 88k for Max 5x and 220k
for Max 20x per 5-hour window: ratios of 4.6x and 2.5x, making Max 20x about 11.6x Pro
rather than 20x. This module seeds itself with those empirical ratios and replaces them
with locally derived values as clean windows accumulate. The UI states which of the two
is in use.

## Schema

```sql
usage_events(
  uuid TEXT PRIMARY KEY, request_id TEXT, ts INTEGER, model TEXT,
  entrypoint TEXT, effort TEXT, session_id TEXT, project TEXT, git_branch TEXT,
  input INTEGER, output INTEGER, thinking INTEGER,
  cache_create_5m INTEGER, cache_create_1h INTEGER, cache_read INTEGER,
  service_tier TEXT, cc_version TEXT
)

statusline_samples(
  t INTEGER PRIMARY KEY, session_id TEXT,
  fh_pct REAL, fh_resets_at INTEGER, sd_pct REAL, sd_resets_at INTEGER,
  spend_pct REAL, spend_resets_at INTEGER,
  cache_hit_ratio REAL, cache_warm INTEGER,
  pr_number INTEGER, pr_review_state TEXT, worktree_branch TEXT
)

quota_samples(t INTEGER PRIMARY KEY, org TEXT, fh_pct INTEGER, sd_pct INTEGER)

ingest_files(path TEXT PRIMARY KEY, size INTEGER, mtime INTEGER, offset INTEGER)
```

Indexes on `usage_events(ts, model, project, entrypoint)`.

## API routes

| Route | Returns |
| --- | --- |
| `GET /api/status` | current 5h and 7-day state with exact reset times, headroom, staleness |
| `GET /api/usage/timeseries?bucket=&by=` | tokens bucketed by day or week, split by model, effort or surface |
| `GET /api/usage/breakdown?by=` | totals grouped by project, branch, surface or model |
| `GET /api/usage/cache` | cache read against 5m write, 1h write and fresh input |
| `GET /api/overhead` | per-session overhead trend and the ranked MCP contributors |
| `GET /api/plan` | API-equivalent cost against $200, derived caps, per-tier fit |
| `POST /api/ingest` | incremental ingest across all three sources |

## Charts

Charting is a primary goal, not a presentation layer bolted on. All charts use
`@graphysdk/react`. The `graphy-charts` skill is invoked at the start of implementation
to install the SDK and to confirm each chart below is expressible before the set is
locked; anything the SDK cannot do well is redesigned rather than approximated.

| Chart | Intent |
| --- | --- |
| Quota over time, 5h and 7-day, with reset markers and a 100% threshold | the headline: how close to the wall, how often |
| Tokens over time, stacked by model | where consumption goes |
| Same series split by surface (terminal, desktop Code, other) | the full-Claude view |
| Same series split by effort level | 86% high effort, is it earning it |
| Cache composition over time | read against 5m write, 1h write, fresh input |
| Project and branch breakdown, drilling to sessions | which work costs what |
| Session-start overhead trend, annotated with MCP config changes | the fixed tax per session |
| Derived cap fit: tokens against quota percentage, with confidence band | shows the estimate's quality rather than asserting a number |
| Cost per PR, from `pr.number` | tokens per unit of shipped work |

## Reuse from prior art

Five comparable tools exist. All are MIT licensed, so borrowing is permitted with
attribution, recorded in a `CREDITS.md` naming each project and what was taken.

| Source | What we take | Why not write it |
| --- | --- | --- |
| [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) (MIT, Python) | empirical per-tier caps (~19k Pro, ~88k Max 5x, ~220k Max 20x per 5h window) and the P90 cap-derivation approach | those constants represent calibration across many users' history that we cannot reproduce from one machine |
| [658jjh/claude-usage-tracker](https://github.com/658jjh/claude-usage-tracker) (MIT, JS) | per-model pricing map, cross-checked against the `claude-api` skill | a second maintained source catches drift in a table that silently goes stale |
| [ccusage](https://github.com/ccusage/ccusage) (MIT, Rust) | the jsonl edge cases it handles: truncated lines, schema drift across Claude Code versions | reading its handling is cheaper than rediscovering each break; the code itself is Rust and not portable here |
| [pepperonas/claude-token-tracker](https://github.com/pepperonas/claude-token-tracker) (MIT, JS) | per-token-type cost breakdown structure | a solved shape, no reason to redesign it |

Nothing is vendored wholesale. Constants and pricing tables are copied with attribution;
algorithms are reimplemented in TypeScript against our own tests.

Deliberately not taken: their dashboards and charting, which is the part this project
exists to do differently, and their window handling, which infers boundaries we get
exactly from `resets_at`.

## Testing

Test-driven. Committed jsonl and statusline fixtures cover: streaming parse of
well-formed and truncated lines; a `requestId` spanning multiple lines asserting no
double count; incremental resume after a file grows; pricing arithmetic per model and
per token type including both cache write rates; absent and partial `rate_limits`
objects; surface attribution where quota rises with no Code events; cap regression
against a synthetic series with a known slope.

## Delivery

Four pull requests, none stacked, each standalone on trunk.

| # | Scope | Rough size |
| --- | --- | --- |
| 1 | schema, three ingesters, statusline script, dedup rule verified against real logs | ~300 |
| 2 | queries, pricing, attribution, overhead, caps, API routes | ~300 |
| 3 | dashboard shell, status panel, Graphy setup via the skill | ~250 |
| 4 | remaining charts and drill-downs | ~300 |

PRs 1 and 2 land server-side with no UI consuming them yet.

## Out of scope

- Anthropic Console usage API. Cannot see subscription consumption.
- A proxy or daemon to capture desktop chat tokens. Fragile against app updates, recovers
  no history, and `attribution.ts` answers the question well enough.
- Subagent attribution. Zero sidechain traffic in the measured window.
- Burn-rate prediction as a modelled feature. `/api/status` reports a simple trailing rate
  against the exact `resets_at`; anything more is already covered by existing monitors.
- Multi-account, multi-machine, and deployment. This reads files under the home directory
  and runs locally.

## Known limitations

1. Token and cost figures exclude desktop chat and are a floor, not a total.
2. Desktop chat consumption is an attributed estimate, accurate only in proportion to how
   cleanly quota rises separate from Code activity.
3. Derived caps depend on having enough uncontaminated windows; with too few the app
   states no cap.
4. Per-tier limits start from another project's published calibration, which is empirical
   and may be stale or wrong for this account, until enough clean local windows replace it.
5. `rate_limits` is absent before a session's first API response and after a window
   expires, and `plan-usage-history.json` only updates while the desktop app runs, so
   status carries a staleness timestamp rather than implying real time.
6. Statusline history starts at install. Everything before that is jsonl and quota
   snapshots only.
