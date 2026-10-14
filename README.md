# claude-usage

A local dashboard for where your Claude subscription goes: tokens and API-equivalent cost by
model, effort, project and session, how close the five-hour and weekly limits run, and whether
the plan pays for itself.

Everything runs on your machine. It reads the logs Claude Code already writes, keeps its own
SQLite database in `~/.claude-usage`, and serves on `127.0.0.1` only. Nothing is sent anywhere.

## Run it

Needs Node 24 or later (for the built-in `node:sqlite`) and pnpm.

```bash
pnpm install
pnpm dev
```

Then open http://127.0.0.1:3000. The first load reads every session log under
`~/.claude/projects`, which can take a few seconds on a long history; later loads only read
what changed.

## What it shows

| Panel | Question it answers |
| --- | --- |
| `plan_efficiency` | API-equivalent spend against the subscription, payback, live limit usage |
| `tokens_by_model` | Tokens over time per model, with model release markers |
| `quota_windows` | Five-hour and weekly limit usage over time, with the weekly reset marked |
| `cost_by_model` | API-equivalent cost per model |
| `cost_by_kind` | Cost split into cache reads, cache writes, input, output and thinking |
| `tokens_by_project` | Which projects and worktrees spent the tokens |
| `tokens_by_effort` | Tokens per effort level |
| `activity_by_hour` | When in the week the work happens |
| `tokens_by_session` | Each bucket's sessions, by branch and folder, as stacked bars of tokens |

Most series panels switch between stacked, 100% and donut views. Range and bucket size are set
at the top; short ranges can refresh live.

## Where the numbers come from

- **Tokens and cost** come from Claude Code's session logs (`~/.claude/projects/**/*.jsonl`),
  so they cover Claude Code in the terminal and in the desktop app, not desktop chat. A request
  logged over several lines is counted once. Cost is what the tokens would cost at API list
  prices (`lib/pricing.ts`), not what you are billed.
- **Limit usage** comes from the desktop app's `plan-usage-history.json`, so it only exists on
  macOS with the Claude desktop app installed, only covers the time the app was open, and the
  app keeps about 30 days of it. The dashboard archives what it reads, so history builds up from
  the first run.
- The weekly reset day and time are set in the `quota_windows` header and remembered by the
  browser.

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `CLAUDE_USAGE_PLAN_USD` | `200` | Monthly plan price the value figures are measured against |
| `CLAUDE_USAGE_PROJECTS_DIR` | `~/projects` | Folder project names are shortened relative to |
| `CLAUDE_USAGE_DIR` | `~/.claude-usage` | Where the database lives |

## Optional: live limit readings from Claude Code

`scripts/statusline.mjs` is a Claude Code status line that also records the limit percentages
Claude Code reports on every turn, which fills the gaps when the desktop app is closed. It is
off by default because enabling it changes your Claude Code settings. To try it, point
`statusLine` in `~/.claude/settings.json` at it:

```json
{ "statusLine": { "type": "command", "command": "node /path/to/claude-usage/scripts/statusline.mjs" } }
```

## Development

```bash
pnpm test
pnpm typecheck
```

`CONVENTIONS.md` covers how the code is laid out and the quirks of the charting SDK.

## License

MIT for this repository. Charts are drawn with the Graphy SDK (`@graphysdk/react`), which is
installed from npm under its own license: free for noncommercial use and for small businesses.
