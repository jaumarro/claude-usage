import { createSpec, pipe, mapping, geom, scale, transform } from '@graphysdk/react';
import { SESSIONS_LAYER, SESSION_TOTALS_LAYER, spanScale } from '@/lib/charts/seriesViews';
import { seriesHues, type ColorScheme } from '@/lib/charts/theme';
import { wallClockIso } from '@/lib/charts/wallClock';
import type { TimeWindow } from '@/lib/queries/aggregate';

/** A bucket a session sent at least one request in. */
export type SessionBlock = {
  /** Epoch milliseconds the bucket opens at. */
  from: number;
  /** Epoch milliseconds the next bucket opens at. */
  to: number;
  session: string;
  /** The folder the session started in: a worktree's own name, or the repository's. */
  project: string;
  /** The branch most of the session's requests were sent from, if any was checked out. */
  branch: string | null;
  /** Tokens the session spent in this bucket. */
  spent: number;
};

export type SessionsRow = {
  t: string;
  /** The middle of the segment's bucket, where its bar's total is labelled. */
  mid: string;
  session: string;
  bar: string;
  spent: number;
};

export const sessionsColumns = [{ key: 't' }, { key: 'mid' }, { key: 'session' }, { key: 'bar' }, { key: 'spent' }];

/** The branch says what the session worked on, so it comes first; the tooltip cuts the rest short. */
function sessionLabel(block: SessionBlock): string {
  if (block.branch === null) {
    return block.project;
  }
  return `${block.branch} · ${block.project}`;
}

/** The tooltip names a session by its label, so two that read the same need telling apart. */
function labeller() {
  const labels = new Map<string, string>();
  const taken = new Set<string>();
  return (block: SessionBlock): string => {
    const known = labels.get(block.session);
    if (known !== undefined) {
      return known;
    }
    const base = sessionLabel(block);
    let label = base;
    for (let copy = 2; taken.has(label); copy += 1) {
      label = `${base} #${copy}`;
    }
    taken.add(label);
    labels.set(block.session, label);
    return label;
  };
}

/** The share of each bucket left empty between one bar and the next. */
const BAR_GAP = 0.2;

/**
 * Each session is a segment of its bucket's bar, as tall as the tokens it spent there. The engine
 * draws bars only on a band axis, which would take this chart off the time axis every other chart
 * shares, so a segment is an area of two points inset from its bucket's edges, in a group of its
 * own so it joins no other.
 *
 * The blocks arrive ordered by session start, and the stack piles groups in the order it meets
 * them, so the oldest session sits at the bottom.
 */
export function sessionsData(blocks: SessionBlock[]) {
  const labelOf = labeller();
  const rows = blocks.flatMap((block, index): SessionsRow[] => {
    const inset = ((block.to - block.from) * BAR_GAP) / 2;
    const segment = {
      mid: wallClockIso((block.from + block.to) / 2),
      session: labelOf(block),
      bar: String(index),
      spent: block.spent,
    };
    return [
      { t: wallClockIso(block.from + inset), ...segment },
      { t: wallClockIso(block.to - inset), ...segment },
    ];
  });
  return { columns: sessionsColumns, rows };
}

/** Every bar's sessions from the bottom up. A bar's segments all open at the same instant. */
function stacks(rows: SessionsRow[]): string[][] {
  const bars = new Map<string, string[]>();
  const counted = new Set<string>();
  for (const row of rows) {
    if (!counted.has(row.bar)) {
      counted.add(row.bar);
      const stack = bars.get(row.t) ?? [];
      stack.push(row.session);
      bars.set(row.t, stack);
    }
  }
  return [...bars.values()];
}

/** Each session in a stack with the one directly beneath it. */
function adjacentPairs(stack: readonly string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  let beneath: string | undefined;
  for (const session of stack) {
    if (beneath !== undefined) {
      pairs.push([beneath, session]);
    }
    beneath = session;
  }
  return pairs;
}

function neighbours(rows: SessionsRow[]): Map<string, Set<string>> {
  const touching = new Map<string, Set<string>>();
  const link = (one: string, other: string) => {
    touching.set(one, (touching.get(one) ?? new Set<string>()).add(other));
  };
  for (const [beneath, above] of stacks(rows).flatMap(adjacentPairs)) {
    link(beneath, above);
    link(above, beneath);
  }
  return touching;
}

/**
 * There are far more sessions than hues, so hues repeat; what matters is that two sessions stacked
 * against each other never wear the same one. Hues are handed out in turn, skipping any a
 * neighbour already wears, so all of them get used rather than the first few.
 */
function huesBySession(rows: SessionsRow[], hueCount: number): Map<string, number> {
  const touching = neighbours(rows);
  const hueOf = new Map<string, number>();
  let next = 0;
  for (const session of new Set(rows.map((row) => row.session))) {
    const worn = new Set([...(touching.get(session) ?? [])].map((other) => hueOf.get(other)));
    const step = Array.from({ length: hueCount }, (_, offset) => offset).find(
      (offset) => !worn.has((next + offset) % hueCount),
    );
    const hue = (next + (step ?? 0)) % hueCount;
    hueOf.set(session, hue);
    next = hue + 1;
  }
  return hueOf;
}

/**
 * Every session gets its own entry rather than the house palette's: the palette pins a colour to
 * each of its eight slots, and a ninth session would cycle back to the first whatever it was given.
 */
function sessionColors(rows: SessionsRow[], scheme: ColorScheme) {
  const hues = seriesHues(scheme);
  const hueOf = huesBySession(rows, hues.length);
  return scale.color.discrete({
    domain: [...hueOf.keys()],
    range: [...hueOf.values()].map((hue) => hues[hue] ?? ''),
  });
}

/**
 * The engine labels stack totals on bars alone, so each bar's total is a hidden point at its top:
 * one row per segment, then the segments of a bucket summed.
 */
const barTotals = geom.point({
  id: SESSION_TOTALS_LAYER,
  aes: { x: 'mid', y: 'total', color: undefined, group: undefined },
  interactive: false,
  dataLabels: { showDataLabels: true },
  transforms: [
    transform.aggregate({ groupby: ['mid', 'bar'], operations: [{ op: 'max', variableName: 'spent', as: 'segment' }] }),
    transform.aggregate({ groupby: ['mid'], operations: [{ op: 'sum', variableName: 'segment', as: 'total' }] }),
  ],
});

export function sessionsInputFor(rows: SessionsRow[], scheme: ColorScheme, span?: TimeWindow) {
  return pipe(
    createSpec(),
    mapping({ x: 't', y: 'spent', color: 'session', group: 'bar' }),
    geom.area({ id: SESSIONS_LAYER, position: 'stack' }),
    barTotals,
    spanScale(span),
    scale.y.continuous({ domainMin: 0 }),
    sessionColors(rows, scheme),
  );
}
