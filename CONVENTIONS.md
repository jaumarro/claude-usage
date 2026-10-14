# Conventions

Fixed by S0. Follow these; do not invent alternatives. If a slice needs a convention that
is not here, stop and ask rather than inventing one.

## Stack

Next.js App Router, React 19, TypeScript strict, Vitest, `node:sqlite` (Node 24 built-in,
so there is no native dependency to build). `@graphysdk/react` for every chart.

## Graphy SDK

The SDK has no stable release: the only non-beta version published is `0.0.1`, and the
`latest` tag points at a beta. Both packages are pinned exactly to
`2.0.0-beta.1788435388461`. Do not widen the range or bump without saying so.

Five things cost time to discover once. They are settled:

1. **`createCompiler` is not exported from `@graphysdk/react`.** It comes from
   `@graphysdk/viz-engine`, installed as a pinned devDependency for exactly this reason.
   Charts import from `@graphysdk/react`; spec tests import the compiler from
   `@graphysdk/viz-engine`.
2. **The viz-engine dist emits extension-less deep imports** (`lodash-es/clamp`) that
   Node's ESM resolver rejects. `vitest.config.ts` sets
   `server.deps.inline: [/@graphysdk/]` so Vite's resolver handles them. Leave it in place.
3. **Scale builders are callable objects, not chains.** `scale.x.datetime()` is correct;
   `scale.x().datetime()` throws. Bare `scale.x()` infers the type.
4. **`compile()` returns a discriminated union**, `{ ok, compiled, warnings }`. There is no
   `errors` key on success, so narrow on `result.ok` before touching `result.compiled`.
   The `graphy-charts` skill's `validate-spec.mjs` passes `ctx: {}`; the TypeScript types
   reject it, so omit it.
5. **pnpm 11 blocks the postinstall scripts** for `@graphysdk/viz-engine` and `esbuild`.
   `pnpm-workspace.yaml` sets `allowBuilds` for both. Without it, install fails the run.
6. **Time values are not interchangeable across builders.** `scale.x.datetime()` rejects
   numeric epochs and needs ISO strings, but a `geom.rule` x constant needs epoch
   **milliseconds** and fails on an ISO string or `Date` with `INVALID_RULE_MAPPING`. A
   chart with both a datetime axis and vertical rule markers therefore carries both forms.
7. **`geom.rule` reads exactly one observation.** N reference lines mean N layers, which a
   static const spec cannot express. A chart needing a variable number of markers exports
   a builder function alongside the const, e.g. `quotaOverTimeInputWithResets(resets)`.
   This is the one sanctioned exception to the three-export chart module shape below.

Sizing is responsive by default and fills the parent, so every chart wrapper needs a real
height or it renders at zero height.

## House style

Terminal aesthetic: near-black ground, monospace throughout, a faint grid wash behind the
masthead, phosphor green for healthy figures, amber for approaching a limit, pink for at
or over it. Panel titles are lowercase snake_case, like command names.

`components/Chart.tsx` applies the whole chart style itself, piping `terminalStyles`,
`terminalPalette` and `terminalConfig` onto whatever spec it is given and setting
`colorScheme="dark"`. **Spec modules therefore contain no paint**: no colors, no fonts, no
`styles()`, no `config()`. Just mapping, geoms and scales. A spec that paints itself will
fight the house style and lose in confusing ways.

The stylesheet already paints `geom.rule` as a dashed `--danger` line, which is the
threshold-line treatment. Do not restyle rules per chart.

Page structure comes from `components/Shell.tsx`, which exports `Shell`, `Panel` and
`Stat`. Compose pages from those rather than raw markup:

```tsx
<Shell meta="...">
  <Panel title="tokens_by_model">
    <div className="stat-row"><Stat label="TOTAL" value="..." tone="accent" /></div>
    <div className="chart"><Chart data={...} input={...} /></div>
  </Panel>
</Shell>
```

Panels carry no coverage badge. Token and dollar panels cover Claude Code only; the quota
panel covers every surface.

`.chart` sets the height that responsive sizing requires. CSS custom properties live in
`app/globals.css`: `--bg --surface --border --chrome --text --dim --accent --warn
--danger --mono`.

## Verifying a chart in the browser

A screenshot taken immediately after `navigate` captures the page mid-layout, and the
chart looks collapsed or truncated when it is fine. This has produced two false bug
reports already. Wait a second before screenshotting, and confirm against the DOM (compare
the area path's bounding box to the SVG width) before concluding anything is broken.

## Cell grids: use `geom.tile`

The SDK ships a `tile` geom that the skill's reference does not mention. `geom.tile()` with
`scale.x.discrete()`, `scale.y.discrete()` and a `scale.color.continuous()` compiles clean
with no warnings and no plugin. Heatmaps and waffles are both tile grids, so neither needs
a custom geom via `defineGeomRenderer`.

## Annotations

A `geom.rule` pill is composed by the renderer as `label: value`, taking the value from the
**y** axis. A vertical rule (mapped on x) has no y value, so its built-in label renders as
`name: -`.

**A vertical rule still uses the pill, with the value written into the label** (`fable 5.1:
Sep 2`). The pill reads better than floating text, and the alternative does not work: a
text annotation has no `backgroundColor` in the installed beta, so its text sits directly
on the marks. The rule's own value column compiles as `numeric/decimal` even when the axis
is `datetime`, so the renderer cannot format a date into the value slot itself. Composing
the whole string in `label` is the only way to get `name: date`.

Three things that silently break an annotation, all of them warnings rather than errors, so
the label just vanishes:

1. An `axis` anchor's `x` must be **the bucket string the rows carry** (`'2026-09-01'`). A
   full ISO string or an epoch number fails to map, raising `ANNOTATION_ANCHOR_UNRESOLVED`.
   The same marker therefore travels as both an epoch (for the rule) and a bucket label
   (for the annotation).
2. A `color` on the **global** mapping is inherited by every layer, and `geom.rule` declares
   no color aesthetic, so each rule raises `UNDECLARED_AESTHETIC`. Scope `color` to the
   layer that uses it; `color: null` does not typecheck.
3. Two markers on the same bucket overlap exactly. Stagger them.

Because these fail soft, **every chart with annotations asserts `result.warnings` is empty**
in its compile test. Without that assertion the test passes with every label missing.

An annotation's `backgroundColor` is the one paint permitted in a spec module: transparent
text over a filled area chart is unreadable, so it is legibility, not decoration.

## Chart modules

One file per chart under `lib/charts/`, exporting three things and importing no React:

```ts
export type <Name>Row = { ... };
export function <name>Data(rows: <Name>Row[]) { return { columns, rows }; }
export const <name>Input = pipe(createSpec(), mapping({ ... }), geom.x(), scale.x..., scale.y());
```

Keeping the spec free of React is what makes it testable headlessly. Rendering goes
through `components/Chart.tsx`, which owns `GraphProvider` and `GraphRenderer`.

Column references use the column `key`, never the label. Reshaping belongs in
`transform.*` inside the spec, not in hand-written row preprocessing.

## Chart tests

Every chart gets a headless compile test in `test/`. Assert `result.ok`, then the layer
count, geom and position. No screenshot assertions.

```ts
const result = createCompiler().compile({ input: <name>Input, data: <name>Data(ROWS) });
expect(result.ok).toBe(true);
```

## Database

`lib/db.ts` owns the connection and migrations. Call `openDb()`; do not open
`DatabaseSync` anywhere else. Migrations are append-only statements in the `MIGRATIONS`
array, each written `IF NOT EXISTS`. The database lives at `~/.claude-usage/usage.db`,
outside the repo.

**`CLAUDE_USAGE_DIR` relocates every file the app owns** (database, statusline log). Tests
must set it to a temp dir, or `pnpm test` writes to the real database. The statusline
collector reads the same variable, so one override moves everything consistently.

**The app does not modify anything under `~/.claude`.** It reads the session logs and the
desktop app's quota file; it never writes to either, and it does not install itself into
`settings.json`. The statusline collector exists in `scripts/` but is off: enabling it is a
change to Claude Code, not to this app, and is the user's decision each time. Never add a
`statusLine` entry, a hook, or any other Claude config as a side effect of a task here.
Code that depends on statusline data must degrade cleanly when none exists, because by
default none does.

## Query rule, non-negotiable

60.7% of requests in the real corpus span more than one log line (21,668 of 35,729 across
512 files; one request spans 63 lines). Summing raw rows inflates the total by **90.6%**:
20.92b tokens naive against 10.97b deduped. That is not a rounding concern, it is nearly
double.

Every aggregation collapses to one row per request, keyed `COALESCE(request_id, uuid)`
because a few records carry no `requestId`, taking the maximum per token field, before
summing across requests. Thinking tokens are already inside `output` and must not be added
again. A query that sums raw rows is wrong even when it looks right, so any new
aggregation ships with a fixture proving a multi-line request counts once.

Exclude `model = '<synthetic>'`: those records carry no tokens and only waste a legend
slot.

## Routes

Route handlers return chart-ready `{ columns, rows }` so a chart module can consume the
response without reshaping.

## Testing and style

TDD: test first. `pnpm test` and `pnpm typecheck` must both pass before a slice is done.
No `any`, no disabled lint or TypeScript errors. Brace every control-flow body. Comments
only where the code cannot say it itself, and never narrating history.

## Commits

Conventional commits, title only, no body, no co-author lines, under 72 characters. One
logical change per commit. Never bypass hooks.
